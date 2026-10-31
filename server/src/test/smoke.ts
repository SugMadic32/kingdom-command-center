export {};
/**
 * End-to-end checks against a real PostgreSQL database.
 * WARNING: wipes the database in TEST_DATABASE_URL. Never point it at production.
 *   TEST_DATABASE_URL=postgres://kc:kc@localhost:5432/kingdom_test npm test
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://kc:kc@localhost:5432/kingdom_test';
const { pool } = await import('../lib/db.js');
const { migrate } = await import('../migrate.js');
const { createApp } = await import('../index.js');
const { runReminderCycle } = await import('../jobs/reminders.js');

await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await migrate();
const server = createApp().listen(0);
const port = (server.address() as any).port;
const base = `http://127.0.0.1:${port}/api`;

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}`, detail ?? ''); }
}

class Client {
  cookie = '';
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = { 'X-Requested-With': 'kc' }) {
    const r = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', Cookie: this.cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await r.text();
    let json: any; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json };
  }
}

const admin = new Client(), leader = new Client(), member = new Client(), outsider = new Client();
const reg = (c: Client, email: string, name: string) =>
  c.req('POST', '/auth/register', { email, password: 'correct-horse-1', display_name: name, ingame_name: name });

console.log('Accounts');
check('first account registers', (await reg(admin, 'owner@example.com', 'mamamiya')).status === 201);
check('first account is admin', (await admin.req('GET', '/auth/me')).body.user.kingdom_role === 'admin');
await reg(leader, 'leader@example.com', 'LeaderR5');
await reg(member, 'member@example.com', 'MemberR1');
await reg(outsider, 'other@example.com', 'OtherAlliance');
check('second account is member', (await member.req('GET', '/auth/me')).body.user.kingdom_role === 'member');
check('missing CSRF header is rejected', (await member.req('PUT', '/me/inventory', { wood: 1 }, {})).status === 403);
check('wrong password rejected', (await new Client().req('POST', '/auth/login', { email: 'member@example.com', password: 'nope-nope-nope' })).status === 401);

console.log('Alliances');
const gto = (await admin.req('POST', '/alliances', { tag: 'GTO', name: 'GTO', description: 'Initial alliance' })).body.alliance;
const xyz = (await admin.req('POST', '/alliances', { tag: 'XYZ', name: 'Other' })).body.alliance;
check('member cannot create alliance', (await member.req('POST', '/alliances', { tag: 'BAD', name: 'Bad' })).status === 403);
const ids: Record<string, number> = {};
for (const [c, k] of [[leader, 'leader'], [member, 'member'], [outsider, 'outsider']] as const) ids[k] = (await c.req('GET', '/auth/me')).body.user.id;
check('admin adds R5', (await admin.req('POST', `/alliances/${gto.id}/members`, { user_id: ids.leader, rank: 'R5' })).status === 201);
check('R5 adds R1 member', (await leader.req('POST', `/alliances/${gto.id}/members`, { user_id: ids.member, rank: 'R1' })).status === 201);
check('R5 cannot create another R5', (await leader.req('PATCH', `/alliances/${gto.id}/members/${ids.member}`, { rank: 'R5' })).status === 403);
check('R5 cannot manage other alliance', (await leader.req('POST', `/alliances/${xyz.id}/members`, { user_id: ids.outsider })).status === 403);
await admin.req('POST', `/alliances/${xyz.id}/members`, { user_id: ids.outsider, rank: 'R1' });
check('member cannot change ranks', (await member.req('PATCH', `/alliances/${gto.id}/members/${ids.leader}`, { rank: 'R1' })).status === 403);

console.log('Game data & calculator');
const tc = (await admin.req('POST', '/game/buildings', { key: 'town_center', name: 'Town Center', max_level: 5 })).body.building;
const bar = (await admin.req('POST', '/game/buildings', { key: 'barracks', name: 'Barracks', max_level: 5 })).body.building;
check('member cannot add buildings', (await member.req('POST', '/game/buildings', { key: 'x_x', name: 'X', max_level: 3 })).status === 403);
const v1 = (await admin.req('POST', '/game/versions', { label: 'Test dataset' })).body.version;
// TEST FIXTURE values only — not real game data
const csv = [
  'building,level,bread,wood,stone,iron,duration_seconds,prerequisites,status,source_url,source_checked_at',
  'town_center,2,0,100,0,0,60,,in_game_confirmed,,2026-10-01',
  'town_center,3,0,200,50,0,120,barracks:2,cross_checked,https://example.com/a,2026-10-01',
  'town_center,4,0,400,100,0,240,,single_source,https://example.com/b,2026-10-01',
].join('\n');
check('CSV import succeeds', (await admin.req('POST', `/game/versions/${v1.id}/import`, { csv })).body.imported === 3);
const badCsv = 'building,level,wood,status\nnope,2,1,cross_checked\n';
const badImport = await admin.req('POST', `/game/versions/${v1.id}/import`, { csv: badCsv });
check('bad CSV rejected with row detail', badImport.status === 400 && /unknown building/.test(badImport.body.details?.[0]));
check('calculator blocked until a version is published',
  (await member.req('POST', '/plans/calculate', { items: [{ building_id: tc.id, from: 1, to: 3 }] })).status === 400);
check('member cannot publish data', (await member.req('POST', `/game/versions/${v1.id}/publish`)).status === 403);
await admin.req('POST', `/game/versions/${v1.id}/publish`);
check('published data is locked', (await admin.req('PUT', `/game/versions/${v1.id}/levels`, {
  building_id: tc.id, level: 5, costs: { wood: 1 }, status: 'in_game_confirmed' })).status === 400);

await member.req('PUT', '/me/inventory', { wood: 250, stone: 10 });
await member.req('PUT', '/me/buildings', [{ building_id: tc.id, level: 1 }]);
let r = (await member.req('POST', '/plans/calculate', { items: [{ building_id: tc.id, from: 1, to: 3 }] })).body.result;
check('totals add up', r.totals.wood === 300 && r.totals.stone === 50, r.totals);
check('shortage computed', r.shortage.wood === 50 && r.shortage.stone === 40, r.shortage);
check('affordable level is 2', r.items[0].affordable_level === 2, r.items[0].affordable_level);
check('unmet prerequisite reported', r.items[0].unmet_prerequisites[0]?.building === 'barracks');
check('verified range is authoritative', r.authoritative === true && r.quality === 'verified');
check('no Truegold flagged on regular levels', !r.warnings.some((w: any) => w.type === 'unrecorded'));
check('base duration summed', r.base_duration_seconds === 180);
r = (await member.req('POST', '/plans/calculate', { items: [{ building_id: tc.id, from: 1, to: 5 }], assumptions: { speed_bonus_pct: 20 } })).body.result;
check('missing level flagged, not guessed', r.authoritative === false && r.items[0].levels.find((l: any) => l.level === 5).status === 'missing');
check('warning names missing level', r.warnings.some((w: any) => w.type === 'missing' && w.levels.includes(5)));
check('quality reported as incomplete', r.quality === 'incomplete');
check('no time estimate when durations are incomplete', r.estimate === null && r.base_duration_seconds === null);

console.log('Truegold tiers');
const tgCsv = [
  'building,level,wood,truegold,tempered_truegold,status,source_checked_at',
  'town_center,TG1,,660,,in_game_confirmed,2026-10-29',
  'town_center,TG2,,790,,in_game_confirmed,2026-10-29',
  'embassy,TG1,,165,,in_game_confirmed,2026-10-29',
].join('\n');
const v2 = (await admin.req('POST', '/game/versions', { label: 'With TG', copy_from: v1.id })).body.version;
check('TG rows rejected when buildings are too small', (await admin.req('POST', `/game/versions/${v2.id}/import`, { csv: tgCsv })).status === 400);
check('TG import with add_buildings', (await admin.req('POST', `/game/versions/${v2.id}/import`, { csv: tgCsv, add_buildings: true })).body.imported === 3);
const blds = (await admin.req('GET', '/game/buildings')).body.buildings;
check('embassy created, TC raised to TG2 (32)', blds.some((b: any) => b.key === 'embassy') && blds.find((b: any) => b.key === 'town_center').max_level === 32);
await admin.req('POST', `/game/versions/${v2.id}/publish`);
await admin.req('PUT', `/game/versions/${v2.id}/levels`, { building_id: tc.id, level: 5, costs: { wood: 1 }, status: 'in_game_confirmed' }); // locked, ignored
r = (await member.req('POST', '/plans/calculate', { items: [{ building_id: tc.id, from: 30, to: 32 }] })).body.result;
check('Truegold totalled for TG1–TG2', r.totals.truegold === 1450, r.totals);
check('TG levels labelled', r.items[0].levels.map((l: any) => l.label).join() === 'TG1,TG2');
check('unrecorded resources flagged, not zero', r.warnings.some((w: any) => w.type === 'unrecorded' && w.resources.includes('bread')) && r.quality === 'incomplete');
check('wood not recorded on TG rows is excluded', r.unrecorded_resources.includes('wood') && r.totals.wood === 0);
check('member cannot switch resources on/off', (await member.req('PATCH', '/game/resources/truegold', { deferred: true })).status === 403);
const exp2 = await admin.req('GET', `/game/versions/${v2.id}/export.csv`);
check('export uses TG labels', typeof exp2.body === 'string' && exp2.body.includes('"TG1"'));

console.log('Languages');
check('language set to Korean', (await member.req('PATCH', '/me/profile', { language: 'ko' })).status === 200 && (await member.req('GET', '/auth/me')).body.user.language === 'ko');
check('unknown language rejected', (await member.req('PATCH', '/me/profile', { language: 'xx' })).status === 400);

console.log('Plans & privacy');
const plan = (await member.req('POST', '/plans', { name: 'TC push', items: [{ building_id: tc.id, from: 1, to: 3 }] })).body.plan;
check('plan stores dataset version', plan.dataset_version_id === v2.id);
check('another user cannot read plan', (await outsider.req('GET', `/plans/${plan.id}`)).status === 404);
check('another user cannot delete plan', (await outsider.req('DELETE', `/plans/${plan.id}`)).status === 404);
await member.req('PATCH', '/me/profile', { share_inventory: false, share_buildings: false });
check('leader sees nothing before sharing', (await leader.req('GET', `/alliances/${gto.id}/shared`)).body.inventory.length === 0);
await member.req('PATCH', '/me/profile', { share_inventory: true });
await member.req('POST', `/plans/${plan.id}/sharing`, { alliance: true, link: true });
const shared = (await leader.req('GET', `/alliances/${gto.id}/shared`)).body;
check('leader sees shared inventory and plan', shared.inventory.length > 0 && shared.plans.length === 1);
check('member cannot view leader-only shared data', (await member.req('GET', `/alliances/${gto.id}/shared`)).status === 403);
check('other alliance leader blocked', (await outsider.req('GET', `/alliances/${gto.id}/shared`)).status === 403);
const token = (await member.req('GET', `/plans/${plan.id}`)).body.plan.share_token;
const pub = await new Client().req('GET', `/shared/plans/${token}`);
check('read-only share link works without login', pub.status === 200 && pub.body.plan.result.shortage === undefined);
const exp = await member.req('GET', `/plans/${plan.id}/export.csv`);
check('CSV export works', typeof exp.body === 'string' && exp.body.includes('Town Center'));

console.log('Events');
const future = new Date(Date.now() + 20 * 60_000).toISOString();
check('member cannot create kingdom event', (await member.req('POST', '/events', { scope: 'kingdom', type: 'castle', title: 'Castle', starts_at: future })).status === 403);
const prop = (await leader.req('POST', '/events', { scope: 'kingdom', type: 'castle', title: 'Castle battle', starts_at: future })).body.event;
check('R5 kingdom event becomes a proposal', prop.status === 'proposed');
check('R5 cannot publish kingdom event', (await leader.req('POST', `/events/${prop.id}/publish`)).status === 403);
check('member cannot see unpublished proposal', (await member.req('GET', `/events/${prop.id}`)).status === 404);
check('admin publishes kingdom event', (await admin.req('POST', `/events/${prop.id}/publish`)).body.event?.status === 'published');
check('member cannot reschedule published event', (await member.req('PATCH', `/events/${prop.id}`, { starts_at: future })).status === 403);
check('member cannot cancel published event', (await member.req('POST', `/events/${prop.id}/cancel`, {})).status === 403);
check('member RSVPs', (await member.req('PUT', `/events/${prop.id}/attendance`, { status: 'going' })).status === 200);

const ally = (await leader.req('POST', '/events', { scope: 'alliance', type: 'alliance', title: 'GTO rally' })).body.event;
await leader.req('POST', `/events/${ally.id}/slots`, { starts_at: [future, new Date(Date.now() + 86400_000).toISOString()] });
const det = (await member.req('GET', `/events/${ally.id}`)).body;
check('alliance member sees open poll', det.slots?.length === 2);
check('member submits availability', (await member.req('PUT', `/events/${ally.id}/availability`, { slot_ids: [det.slots[0].id] })).status === 200);
check('other alliance cannot see poll', (await outsider.req('GET', `/events/${ally.id}`)).status === 404);
check('other alliance cannot answer poll', (await outsider.req('PUT', `/events/${ally.id}/availability`, { slot_ids: [det.slots[0].id] })).status === 404);
await leader.req('POST', `/events/${ally.id}/confirm-slot`, { slot_id: det.slots[0].id });
check('leader publishes alliance event', (await leader.req('POST', `/events/${ally.id}/publish`)).body.event?.status === 'published');

console.log('Notifications & reminders');
const n1 = (await member.req('GET', '/me/notifications')).body;
check('member notified of published events', n1.notifications.some((n: any) => n.kind === 'event_published'));
check('notification written in member language (Korean)', n1.notifications.some((n: any) => n.title.startsWith('새 왕국 이벤트')), n1.notifications.map((n: any) => n.title));
await member.req('PATCH', '/me/profile', { reminder_minutes: 30 });
await runReminderCycle();
await runReminderCycle();
const reminders = (await member.req('GET', '/me/notifications')).body.notifications.filter((n: any) => n.kind === 'reminder');
check('reminder queued exactly once per event', reminders.length === 2, reminders.length);
await member.req('PATCH', '/me/profile', { notify_push: true });
await admin.req('POST', '/kingdom/announcements', { scope: 'kingdom', title: 'Test', body: 'Hello' });
await runReminderCycle();
const failedPush = await pool.query(`SELECT error FROM notifications WHERE channel = 'push' AND status = 'failed' LIMIT 1`);
check('unconfigured push is logged as failed, not claimed sent', failedPush.rowCount === 1, failedPush.rows);

console.log('Announcements, KVK, admin');
check('member cannot post kingdom announcement', (await member.req('POST', '/kingdom/announcements', { scope: 'kingdom', title: 'Hi', body: 'x' })).status === 403);
check('R5 posts alliance announcement', (await leader.req('POST', '/kingdom/announcements', { scope: 'alliance', title: 'GTO news', body: 'x' })).status === 201);
check('member cannot create KVK season', (await member.req('POST', '/kingdom/kvk/seasons', { name: 'S1', starts_at: future })).status === 403);
const season = (await admin.req('POST', '/kingdom/kvk/seasons', { name: 'KVK S1', starts_at: future })).body.season;
const item = (await admin.req('POST', `/kingdom/kvk/seasons/${season.id}/checklist`, { title: 'Stock speedups' })).body.item;
check('member ticks own checklist', (await member.req('PUT', `/kingdom/kvk/checklist/${item.id}/mine`, { done: true })).status === 200);
check('member cannot change roles', (await member.req('PATCH', `/admin/users/${ids.member}/role`, { role: 'admin' })).status === 403);
check('member cannot read audit log', (await member.req('GET', '/admin/audit')).status === 403);
check('R5 reads alliance audit only', (await leader.req('GET', '/admin/audit')).body.scope === 'alliance');
check('cannot grant permission to plain member', (await admin.req('PUT', `/admin/users/${ids.leader}/permissions`, { permissions: ['data_curator'] })).status === 400);
await admin.req('PATCH', `/admin/users/${ids.leader}/role`, { role: 'officer' });
check('officer granted data_curator', (await admin.req('PUT', `/admin/users/${ids.leader}/permissions`, { permissions: ['data_curator'] })).status === 200);
check('curator can now add buildings', (await leader.req('POST', '/game/buildings', { key: 'farm', name: 'Farm', max_level: 3 })).status === 201);
check('curator still cannot publish kingdom events', (await leader.req('POST', '/events', { scope: 'kingdom', type: 'kvk', title: 'KVK rally', starts_at: future })).body.event?.status === 'proposed');
check('admin cannot demote last admin', (await admin.req('PATCH', `/admin/users/${(await admin.req('GET', '/auth/me')).body.user.id}/role`, { role: 'member' })).status === 400);
const audits = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action IN ('publish','set_permissions','propose')`);
check('important actions are audited', audits.rows[0].n >= 5);
const reset = (await admin.req('POST', `/admin/users/${ids.member}/reset-link`)).body;
const resetToken = new URL(reset.url).searchParams.get('token');
check('reset link resets password', (await new Client().req('POST', '/auth/reset-password', { token: resetToken, password: 'brand-new-pass-1' })).status === 200);
check('reset link is single-use', (await new Client().req('POST', '/auth/reset-password', { token: resetToken, password: 'brand-new-pass-2' })).status === 400);

console.log("King's appointments");
await member.req('POST', '/auth/login', { email: 'member@example.com', password: 'brand-new-pass-1' });
const HOUR = 3600_000;
const apBase = new Date(Math.ceil(Date.now() / HOUR) * HOUR + HOUR);   // next whole hour + 1h
const at = (i: number) => new Date(apBase.getTime() + i * HOUR).toISOString();
check('member cannot create positions', (await member.req('POST', '/appointments/positions', { name: 'Builder' })).status === 403);
const pA = (await admin.req('POST', '/appointments/positions', { name: 'Construction buff', buff: '+construction speed' })).body.position;
const pB = (await admin.req('POST', '/appointments/positions', { name: 'Training buff' })).body.position;
check('misaligned window rejected', (await admin.req('POST', '/appointments/schedules', { name: 'Bad', starts_at: at(0), ends_at: new Date(apBase.getTime() + 90 * 60000).toISOString(), slot_minutes: 60, position_ids: [pA.id] })).status === 400);
const sch = (await admin.req('POST', '/appointments/schedules', { name: 'Term 1', starts_at: at(0), ends_at: at(4), slot_minutes: 60, max_per_member: 2, position_ids: [pA.id, pB.id], mode: 'first_come' })).body.schedule;
check('schedule created with 4 slots', (await admin.req('GET', `/appointments/schedules/${sch.id}`)).body.slots?.length === 4);
check('draft hidden from members', (await member.req('GET', `/appointments/schedules/${sch.id}`)).status === 404);
check('member cannot book a draft', (await member.req('POST', `/appointments/schedules/${sch.id}/bookings`, { position_id: pA.id, slot_start: at(0) })).status === 404 ||
  (await member.req('POST', `/appointments/schedules/${sch.id}/bookings`, { position_id: pA.id, slot_start: at(0) })).status === 400);
await admin.req('PATCH', `/appointments/schedules/${sch.id}`, { status: 'open' });
check('member books a slot', (await member.req('POST', `/appointments/schedules/${sch.id}/bookings`, { position_id: pA.id, slot_start: at(0) })).status === 201);
const dupe = await leader.req('POST', `/appointments/schedules/${sch.id}/bookings`, { position_id: pA.id, slot_start: at(0) });
check('slot cannot be double-booked', dupe.status === 400 && /already booked/.test(dupe.body.error));
const two = await member.req('POST', `/appointments/schedules/${sch.id}/bookings`, { position_id: pB.id, slot_start: at(0) });
check('member cannot hold two positions at once', two.status === 400 && /another position/.test(two.body.error));
check('off-grid time rejected', (await member.req('POST', `/appointments/schedules/${sch.id}/bookings`, { position_id: pA.id, slot_start: new Date(apBase.getTime() + 30 * 60000).toISOString() })).status === 400);
check('member books second slot', (await member.req('POST', `/appointments/schedules/${sch.id}/bookings`, { position_id: pA.id, slot_start: at(1) })).status === 201);
check('booking limit enforced', (await member.req('POST', `/appointments/schedules/${sch.id}/bookings`, { position_id: pA.id, slot_start: at(2) })).status === 400);
check('member cannot book for someone else', (await member.req('POST', `/appointments/schedules/${sch.id}/bookings`, { position_id: pB.id, slot_start: at(3), user_id: ids.leader })).status === 403);
check('manager assigns a member', (await admin.req('POST', `/appointments/schedules/${sch.id}/bookings`, { position_id: pB.id, slot_start: at(3), user_id: ids.leader })).status === 201);
const leaderNotes = (await leader.req('GET', '/me/notifications')).body.notifications;
check('assigned member is notified', leaderNotes.some((n: any) => n.kind === 'appointment_assigned'));
const apDet = (await member.req('GET', `/appointments/schedules/${sch.id}`)).body;
const leaderBk = apDet.bookings.find((b: any) => b.user_id === ids.leader);
check('member cannot cancel another booking', (await member.req('DELETE', `/appointments/bookings/${leaderBk.id}`)).status === 403);
const mineBk = apDet.bookings.find((b: any) => b.user_id === ids.member && b.slot_start === at(1));
check('member cancels own booking', (await member.req('DELETE', `/appointments/bookings/${mineBk.id}`)).status === 200);
check('timing change that breaks bookings is blocked', (await admin.req('PATCH', `/appointments/schedules/${sch.id}`, { slot_minutes: 120 })).status === 400);
check('my upcoming appointments listed', (await member.req('GET', '/appointments/mine')).body.bookings.length === 1);
const apptCsv = await member.req('GET', `/appointments/schedules/${sch.id}/export.csv`);
check('schedule CSV export', typeof apptCsv.body === 'string' && apptCsv.body.includes('Construction buff'));
await member.req('PATCH', '/me/profile', { reminder_minutes: 120 });
await runReminderCycle();
check('appointment reminder sent in member language', (await member.req('GET', '/me/notifications')).body.notifications.some((n: any) => n.kind === 'appointment_reminder' && n.title.includes('분')));
check('appointment changes are audited', (await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE record_type = 'appointment_schedule'`)).rows[0].n >= 5);

console.log('Game-style applications');
const posList = (await admin.req('GET', '/appointments/positions')).body.positions;
check('six in-game Minister positions are pre-filled', ['Chief Minister', 'Minister of Justice', 'Minister of the Interior', 'Field Commander', 'Marshal', 'Noble Advisor']
  .every((n) => posList.some((p: any) => p.name === n)));
const chief = posList.find((p: any) => p.name === 'Chief Minister');
const HALF = 30 * 60000;
const gBase = new Date(Math.ceil(Date.now() / HALF) * HALF + 2 * HALF);
const g = (i: number) => new Date(gBase.getTime() + i * HALF).toISOString();
const gs = (await admin.req('POST', '/appointments/schedules', { name: 'Castle S2', starts_at: g(0), ends_at: g(4), slot_minutes: 30, position_ids: [chief.id] })).body.schedule;
check('new schedules default to apply mode', gs.mode === 'apply');
await admin.req('PATCH', `/appointments/schedules/${gs.id}`, { status: 'open' });
check('direct booking blocked in apply mode', (await member.req('POST', `/appointments/schedules/${gs.id}/bookings`, { position_id: chief.id, slot_start: g(0) })).status === 400);
check('member applies', (await member.req('POST', `/appointments/schedules/${gs.id}/applications`, { position_id: chief.id, slot_start: g(0) })).status === 201);
check('applying twice is blocked', (await member.req('POST', `/appointments/schedules/${gs.id}/applications`, { position_id: chief.id, slot_start: g(0) })).status === 400);
check('second member applies for the same slot', (await leader.req('POST', `/appointments/schedules/${gs.id}/applications`, { position_id: chief.id, slot_start: g(0) })).status === 201);
const memberView = (await member.req('GET', `/appointments/schedules/${gs.id}`)).body;
check('members see applicant count but not names of others', memberView.application_counts[0]?.n === 2 && memberView.applications.length === 1);
const kingView = (await admin.req('GET', `/appointments/schedules/${gs.id}`)).body;
check('King sees every applicant', kingView.applications.length === 2);
const leaderApp = kingView.applications.find((x: any) => x.user_id === ids.leader);
check('member cannot approve', (await member.req('POST', `/appointments/applications/${leaderApp.id}/approve`)).status === 403);
check('King approves one applicant', (await admin.req('POST', `/appointments/applications/${leaderApp.id}/approve`)).status === 200);
const memberApp = kingView.applications.find((x: any) => x.user_id === ids.member);
check('cannot approve a second person for a held slot', (await admin.req('POST', `/appointments/applications/${memberApp.id}/approve`)).status === 400);
check('approved member notified', (await leader.req('GET', '/me/notifications')).body.notifications.filter((n: any) => n.kind === 'appointment_assigned').length >= 2);
check('cannot apply for a held slot', (await outsider.req('POST', `/appointments/schedules/${gs.id}/applications`, { position_id: chief.id, slot_start: g(0) })).status >= 400);
check('member withdraws application', (await member.req('POST', `/appointments/schedules/${gs.id}/applications`, { position_id: chief.id, slot_start: g(1) })).status === 201 &&
  (await member.req('DELETE', `/appointments/applications/${(await member.req('GET', `/appointments/schedules/${gs.id}`)).body.applications.find((x: any) => x.slot_start === g(1)).id}`)).status === 200);
check('my applications listed', Array.isArray((await member.req('GET', '/appointments/mine')).body.applications));

console.log('Manual editing');
const ph = (await admin.req('POST', `/kingdom/kvk/seasons/${season.id}/phases`, { name: 'Prep', starts_at: future })).body.phase;
check('season renamed to S2', (await admin.req('PATCH', `/kingdom/kvk/seasons/${season.id}`, { name: 'KVK S2' })).status === 200 &&
  (await member.req('GET', '/kingdom/kvk')).body.season?.name === 'KVK S2');
check('phase edited', (await admin.req('PATCH', `/kingdom/kvk/phases/${ph.id}`, { name: 'Preparation' })).status === 200);
check('checklist item edited', (await admin.req('PATCH', `/kingdom/kvk/checklist/${item.id}`, { title: 'Stock speedups (7 days)' })).status === 200);
check('member cannot edit phases', (await member.req('PATCH', `/kingdom/kvk/phases/${ph.id}`, { name: 'x' })).status === 403);
check('dataset version renamed', (await admin.req('PATCH', `/game/versions/${v1.id}`, { label: 'Audit Oct 2026' })).status === 200);
check('alliance tag changed by admin', (await admin.req('PATCH', `/alliances/${xyz.id}`, { tag: 'xyz2' })).status === 200);
check('R5 cannot change tag', (await leader.req('PATCH', `/alliances/${gto.id}`, { tag: 'NEW' })).status === 403);
check('R5 can edit description', (await leader.req('PATCH', `/alliances/${gto.id}`, { description: 'GTO home' })).status === 200);
check('position with bookings cannot be deleted', (await admin.req('DELETE', `/appointments/positions/${pA.id}`)).status === 400);
const pC = (await admin.req('POST', '/appointments/positions', { name: 'Unused' })).body.position;
check('unused position deleted', (await admin.req('DELETE', `/appointments/positions/${pC.id}`)).status === 200);
check('season deleted', (await admin.req('DELETE', `/kingdom/kvk/seasons/${season.id}`)).status === 200);

console.log('Member planning & dataset delete');
check('cannot delete published dataset', (await admin.req('DELETE', `/game/versions/${v2.id}`)).status === 400);
check('archived dataset deleted', (await admin.req('DELETE', `/game/versions/${v1.id}`)).status === 200);
check('member cannot open member planning', (await member.req('GET', '/planning/members')).status === 403);
const plan1 = (await admin.req('GET', '/planning/members')).body;
check('admin sees all members', plan1.members.length >= 3 && plan1.kingdom_wide === true);
const mRow = plan1.members.find((x: any) => x.id === ids.member);
check('shared inventory visible to admin', mRow.inventory && mRow.inventory.wood === 250);
await member.req('PATCH', '/me/profile', { share_inventory: false, share_buildings: false });
const plan2 = (await admin.req('GET', '/planning/members')).body.members.find((x: any) => x.id === ids.member);
check('not-shared member shows no numbers', plan2.inventory === null && plan2.town_center === null);
check('cannot plan for non-sharing member', (await admin.req('POST', `/planning/members/${ids.member}/calculate`, { items: [{ building_id: tc.id, from: 1, to: 3 }] })).status === 403);
await member.req('PATCH', '/me/profile', { share_inventory: true, share_buildings: true });
const calcFor = (await admin.req('POST', `/planning/members/${ids.member}/calculate`, { items: [{ building_id: tc.id, from: 1, to: 3 }] })).body.result;
check('calculation uses member inventory', calcFor && calcFor.shortage.wood === 50);
const made = await admin.req('POST', `/planning/members/${ids.member}/plans`, { name: 'TC push from King', items: [{ building_id: tc.id, from: 1, to: 3 }], note: 'Do this before KVK' });
check('plan made for member', made.status === 201);
const mine2 = (await member.req('GET', '/plans')).body.plans.find((p: any) => p.id === made.body.plan.id);
check('member sees plan in own list with maker', mine2 && mine2.created_by_name === 'mamamiya');
check('member notified of plan', (await member.req('GET', '/me/notifications')).body.notifications.some((n: any) => n.kind === 'plan_from_leader'));
check('R5 limited to own alliance', (await leader.req('GET', '/planning/members')).body.members.every((x: any) => x.alliance_id === gto.id));
await admin.req('PUT', '/admin/kingdom-settings', { share_default: false });
const nc = new Client(); await nc.req('POST', '/auth/register', { email: 'new1@example.com', password: 'correct-horse-1', display_name: 'Newbie' });
check('share default off respected for new members', (await nc.req('GET', '/me/profile')).body.profile.share_inventory === false);
await admin.req('PUT', '/admin/kingdom-settings', { share_default: true });
const nc2 = new Client(); await nc2.req('POST', '/auth/register', { email: 'new2@example.com', password: 'correct-horse-1', display_name: 'Newbie2' });
check('share default on for new members', (await nc2.req('GET', '/me/profile')).body.profile.share_inventory === true);

console.log('Speedups');
const invRows = (await member.req('GET', '/me/inventory')).body.inventory;
check('5 speedup types in inventory', invRows.filter((r: any) => r.kind === 'speedup').length === 5);
check('speedups saved in minutes', (await member.req('PUT', '/me/inventory', { speedup_construction: 1440 * 3 + 90 })).status === 200 &&
  (await member.req('GET', '/me/inventory')).body.inventory.find((r: any) => r.key === 'speedup_construction').amount === 4410);
const rS = (await member.req('POST', '/plans/calculate', { items: [{ building_id: tc.id, from: 30, to: 32 }] })).body.result;
check('speedups never appear in building costs', !Object.keys(rS.totals).some((k) => k.startsWith('speedup')));
check('leaders see member speedups', (await admin.req('GET', '/planning/members')).body.members.find((x: any) => x.id === ids.member).inventory.speedup_construction === 4410);
check('speedup keys rejected as building costs', (await admin.req('PUT', `/game/versions/${(await admin.req('POST', '/game/versions', { label: 'sp' })).body.version.id}/levels`, { building_id: tc.id, level: 2, costs: { speedup_general: 5 }, status: 'in_game_confirmed' })).status === 400);

console.log('Leader edits & email');
check('admin fills in member resources', (await admin.req('PUT', `/planning/members/${ids.member}/inventory`, { wood: 295000000, speedup_general: 600 })).status === 200);
check('member sees value entered by leader', (await member.req('GET', '/me/inventory')).body.inventory.find((r: any) => r.key === 'wood').amount === 295000000);
check('member told who updated it', (await member.req('GET', '/me/notifications')).body.notifications.some((n: any) => n.kind === 'data_updated_by_leader'));
check('detail shows who updated last', (await admin.req('GET', `/planning/members/${ids.member}`)).body.last_update?.by_name === 'mamamiya');
check('admin sets member building levels', (await admin.req('PUT', `/planning/members/${ids.member}/buildings`, [{ building_id: tc.id, level: 3 }])).status === 200);
check('member cannot edit another member', (await member.req('PUT', `/planning/members/${ids.leader}/inventory`, { wood: 1 })).status === 403);
await member.req('PATCH', '/me/profile', { share_inventory: false });
check('leader cannot edit when member does not share', (await admin.req('PUT', `/planning/members/${ids.member}/inventory`, { wood: 1 })).status === 403);
await member.req('PATCH', '/me/profile', { share_inventory: true });
const prof = (await member.req('GET', '/me/profile')).body;
check('profile reports email not configured; new members start with email on', prof.email_configured === false && prof.profile.notify_email === true);
check('email toggle saves', (await member.req('PATCH', '/me/profile', { notify_email: true })).status === 200);
check('no email queued while email is not set up', (await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE channel = 'email'`)).rows[0].n === 0);
check('email test explains missing setup', /not set up/.test((await admin.req('POST', '/admin/integrations/email-test')).body.error ?? ''));

console.log('Admin email control');
await member.req('PATCH', '/me/profile', { notify_email: false });
check('admin cannot override a member who chose off', (await admin.req('PUT', `/admin/users/${ids.member}/notify-email`, { on: true })).status === 400);
check('admin turns email on for a member', (await admin.req('PUT', `/admin/users/${ids.leader}/notify-email`, { on: true })).status === 200);
check('admin turns email off for a member', (await admin.req('PUT', `/admin/users/${ids.leader}/notify-email`, { on: false })).status === 200);
const bulk = (await admin.req('POST', '/admin/notify-email/all', { on: true })).body;
check('bulk on skips members who chose off', bulk.skipped >= 1 && (await member.req('GET', '/me/profile')).body.profile.notify_email === false);
check('bulk on turns on the rest', (await leader.req('GET', '/me/profile')).body.profile.notify_email === true);
check('member can still turn it off', (await leader.req('PATCH', '/me/profile', { notify_email: false })).status === 200);
check('member cannot use admin switch', (await member.req('POST', '/admin/notify-email/all', { on: true })).status === 403);
check('email default setting saves', (await admin.req('PUT', '/admin/kingdom-settings', { email_default: false })).status === 200 &&
  (await admin.req('GET', '/admin/kingdom-settings')).body.email_default === false && (await admin.req('GET', '/admin/kingdom-settings')).body.share_default === true);
await admin.req('PUT', '/admin/kingdom-settings', { email_default: true });

console.log('Admin sharing control');
await pool.query(`UPDATE users SET share_inventory = FALSE, share_buildings = FALSE, share_user_choice = NULL WHERE id = $1`, [ids.leader]);
await member.req('PATCH', '/me/profile', { share_inventory: false, share_buildings: false });
check('R5 cannot turn on sharing for everyone', (await leader.req('POST', '/planning/sharing/all')).status === 403);
const sh = (await admin.req('POST', '/planning/sharing/all')).body;
check('sharing turned on for members who never chose', sh.changed >= 1 && (await leader.req('GET', '/me/profile')).body.profile.share_inventory === true);
check('member who chose off is skipped', sh.skipped >= 1 && (await member.req('GET', '/me/profile')).body.profile.share_inventory === false);
check('member notified that sharing was turned on', (await leader.req('GET', '/me/notifications')).body.notifications.some((n: any) => n.kind === 'sharing_turned_on'));
check('admin cannot override a member who chose off', (await admin.req('POST', `/planning/members/${ids.member}/sharing`)).status === 400);
await member.req('PATCH', '/me/profile', { share_inventory: true, share_buildings: true });

console.log('Account deletion');
const del = new Client();
await del.req('POST', '/auth/login', { email: 'other@example.com', password: 'correct-horse-1' });
check('delete requires confirmation', (await del.req('POST', '/me/delete-account', { password: 'correct-horse-1', confirm: 'yes' })).status === 400);
check('account deletes', (await del.req('POST', '/me/delete-account', { password: 'correct-horse-1', confirm: 'DELETE' })).status === 200);
check('deleted account cannot log in', (await new Client().req('POST', '/auth/login', { email: 'other@example.com', password: 'correct-horse-1' })).status === 401);

console.log(`\n${passed} passed, ${failed} failed`);
server.close();
await pool.end();
process.exit(failed ? 1 : 0);
