import { useEffect, useState, type FormEvent } from 'react';
import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { FormModal, type FormSpec } from '../components/FormModal';
import { api, download, fmtDate, fmtDuration, fmtNum } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { levelLabel, resName, t } from '../lib/i18n';
import { LevelSelect } from './Plans';
import { Async, Button, Empty, Field, Input, Modal, Note, PageHeader, Panel, StatusMark, Tag, statusOptions, useAction, useConfirm } from '../components/ui';

export function DataLibrary() {
  const { has, isAdmin } = useSession();
  const curator = has('data_curator');
  const versions = useLoad<any>('/game/versions');
  const buildings = useLoad<any>('/game/buildings');
  const resources = useLoad<any>('/game/resources');
  const [vid, setVid] = useState<number | null>(null);
  const [buildingId, setBuildingId] = useState<number | null>(null);
  const [edit, setEdit] = useState<FormSpec | null>(null);
  const [modal, setModal] = useState<null | 'building' | 'version' | 'import' | { level?: any }>(null);
  const { busy, run } = useAction();
  const { confirm, node } = useConfirm();

  useEffect(() => {
    if (versions.data && vid == null && versions.data.versions.length) {
      const pub = versions.data.versions.find((v: any) => v.status === 'published');
      setVid((pub ?? versions.data.versions[0]).id);
    }
  }, [versions.data, vid]);

  const version = versions.data?.versions.find((v: any) => v.id === vid);
  const coverage = useLoad<any>(vid ? `/game/versions/${vid}/coverage` : null, [vid]);
  const levels = useLoad<any>(vid && buildingId ? `/game/versions/${vid}/levels?building_id=${buildingId}` : null, [vid, buildingId]);
  const editable = curator && version?.status === 'draft';
  const reloadAll = () => { versions.reload(); coverage.reload(); levels.reload(); buildings.reload(); };

  async function publish() {
    if (!(await confirm(t('Publish this dataset?'), t('Calculations will switch to {label}. The current published version is archived and can no longer be edited. Check the coverage report first.', { label: version.label }), t('Publish dataset')))) return;
    if (await run(() => api(`/game/versions/${vid}/publish`, { method: 'POST' }), t('Dataset published'))) reloadAll();
  }

  return (
    <>
      {node}
      {edit && <FormModal {...edit} onClose={() => setEdit(null)} />}
      <PageHeader title={t('Game data library')} lead={t('Every cost record shows where it came from and how well it is verified.')}
        actions={curator && <>
          <Button icon={<Plus size={16} />} onClick={() => setModal('building')}>{t('Add building')}</Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setModal('version')}>{t('New draft version')}</Button>
        </>} />
      <div className="stack">
      <Note>{t('These values come from community references and in-game checks. They are not an official Century Games source. Each record shows how well it is verified, and the calculator says when a total is incomplete.')}</Note>

      <Async state={versions}>{(vd) => vd.versions.length ? (
        <div className="stack">
          <div className="version-bar">
            <Field label={t('Dataset version')}>
              <select className="input" value={vid ?? ''} onChange={(e) => { setVid(Number(e.target.value)); setBuildingId(null); }}>
                {vd.versions.map((v: any) => <option key={v.id} value={v.id}>{v.label} · {t(v.status)} · {t('{n} records', { n: v.record_count })}</option>)}
              </select>
            </Field>
            {version && <div className="row-actions">
              <Tag tone={version.status === 'published' ? 'ok' : version.status === 'draft' ? 'gold' : 'muted'}>{t(version.status)}</Tag>
              {curator && <Button icon={<Pencil size={16} />} onClick={() => setEdit({
                title: t('Rename dataset version'),
                fields: [
                  { name: 'label', label: t('Label'), value: version.label, required: true, max: 80 },
                  { name: 'notes', label: t('Notes'), value: version.notes, type: 'textarea', max: 1000 },
                ],
                submit: async (v) => { const ok = await run(() => api(`/game/versions/${vid}`, { method: 'PATCH', body: v }), t('Saved')); if (ok) versions.reload(); return !!ok; },
              })}>{t('Rename')}</Button>}
              <Button icon={<Download size={16} />} onClick={() => download(`/game/versions/${vid}/export.csv`)}>{t('Export CSV')}</Button>
              {editable && <Button icon={<Upload size={16} />} onClick={() => setModal('import')}>{t('Import CSV')}</Button>}
              {editable && <Button variant="primary" busy={busy} onClick={publish}>{t('Publish')}</Button>}
              {curator && version.status !== 'published' && <Button variant="danger" icon={<Trash2 size={16} />} onClick={async () => {
                if (!(await confirm(t('Delete this dataset version?'), t('{label} and its {n} records are deleted. The published version is not affected.', { label: version.label, n: version.record_count }), t('Delete')))) return;
                if (await run(() => api(`/game/versions/${vid}`, { method: 'DELETE' }), t('Dataset version deleted'))) { setVid(null); reloadAll(); }
              }}>{t('Delete')}</Button>}
            </div>}
          </div>
          {version?.notes && <p className="muted">{version.notes}</p>}

          <Panel title={t('Coverage report')}>
            <Async state={coverage}>{(cd) => cd.coverage.length ? (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>{t('Building')}</th><th className="num">{t('Max level')}</th>
                  {statusOptions().map(([k]) => <th key={k} className="num"><StatusMark status={k} /></th>)}<th /></tr></thead>
                <tbody>{cd.coverage.map((c: any) => (
                  <tr key={c.id} className={buildingId === c.id ? 'selected' : ''}>
                    <td><b>{c.name}</b></td><td className="num">{levelLabel(c.max_level)}</td>
                    <td className="num">{c.in_game_confirmed || '—'}</td><td className="num">{c.cross_checked || '—'}</td>
                    <td className="num">{c.single_source || '—'}</td><td className="num">{c.conflicting || '—'}</td>
                    <td className={`num ${c.missing > 0 ? 'neg' : ''}`}>{c.missing || '—'}</td>
                    <td className="row-actions"><Button variant="quiet" onClick={() => setBuildingId(c.id)}>{t('View levels')}</Button>
                      {curator && <Button variant="quiet" icon={<Pencil size={15} />} aria-label={t('Edit {name}', { name: c.name })} onClick={() => {
                        const b = buildings.data?.buildings.find((x: any) => x.id === c.id);
                        setEdit({
                          title: t('Edit building'),
                          fields: [
                            { name: 'name', label: t('Name'), value: c.name, required: true, max: 60 },
                            { name: 'max_level', label: t('Maximum level'), value: c.max_level, type: 'number', required: true, min: 1, max: 1000, hint: t('30 for normal levels. 36 if the building has TG1–TG6.') },
                            { name: 'notes', label: t('Notes'), value: b?.notes ?? '', type: 'textarea', max: 500 },
                          ],
                          submit: async (v) => { const ok = await run(() => api(`/game/buildings/${c.id}`, { method: 'PATCH', body: v }), t('Building saved')); if (ok) reloadAll(); return !!ok; },
                        });
                      }} />}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <Empty title={t('No buildings yet')}>{curator ? t('Add the buildings first, then import or enter their levels.') : ''}</Empty>}</Async>
          </Panel>

          {buildingId && (
            <Panel title={t('{building} levels', { building: buildings.data?.buildings.find((b: any) => b.id === buildingId)?.name ?? '' })}
              actions={editable && <Button icon={<Plus size={16} />} onClick={() => setModal({})}>{t('Add level')}</Button>}>
              <Async state={levels}>{(ld) => ld.levels.length ? (
                <div className="table-wrap"><table className="table table-tight">
                  <thead><tr><th>{t('Level')}</th><th>{t('Status')}</th><th>{t('Costs')}</th><th className="num">{t('Time')}</th><th>{t('Requires')}</th><th>{t('Source')}</th><th>{t('Checked')}</th><th /></tr></thead>
                  <tbody>{ld.levels.map((l: any) => (
                    <tr key={l.id}>
                      <td>{levelLabel(l.level)}</td><td><StatusMark status={l.status} /></td>
                      <td className="small">{Object.entries(l.costs).map(([k, v]) => `${resName(k)} ${fmtNum(v as number)}`).join(' · ') || '—'}</td>
                      <td className="num">{fmtDuration(l.duration_seconds)}</td>
                      <td className="small">{l.prerequisites.map((p: any) => `${p.building} ${levelLabel(p.level)}`).join(', ') || '—'}</td>
                      <td>{l.source_url ? <a href={l.source_url} target="_blank" rel="noreferrer noopener">{t('Link')}</a> : l.status === 'in_game_confirmed' ? t('In game') : '—'}</td>
                      <td className="small">{l.source_checked_at ? fmtDate(l.source_checked_at) : '—'}{l.game_version && <> · v{l.game_version}</>}</td>
                      <td className="row-actions">{editable && <>
                        <Button variant="quiet" icon={<Pencil size={15} />} aria-label={t('Edit level {level}', { level: levelLabel(l.level) })} onClick={() => setModal({ level: l })} />
                        <Button variant="quiet" icon={<Trash2 size={15} />} aria-label={t('Delete level {level}', { level: levelLabel(l.level) })} onClick={async () => {
                          if (await confirm(t('Delete level {level}?', { level: levelLabel(l.level) }), t('The level will count as missing in this version.'), t('Delete record')) &&
                            await run(() => api(`/game/versions/${vid}/levels/${l.id}`, { method: 'DELETE' }), t('Record deleted'))) reloadAll();
                        }} />
                      </>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <Empty title={t('No level records for this building in this version')} />}</Async>
              {!editable && curator && <p className="muted small">{t('Published and archived versions are read-only. Create a draft version (copying this one) to make corrections.')}</p>}
            </Panel>
          )}
        </div>
      ) : <Empty title={t('No datasets yet')}>{curator ? t('Create the first draft version, then import costs (the import can add the buildings for you).') : t('A data curator will publish building data after the audit.')}</Empty>}</Async>

      <Async state={resources}>{(rd) => (
        <Panel title={t('Resource types')}>
          <ul className="chips">{rd.resources.map((r: any) => (
            <li key={r.key}>
              {resName(r.key, r.name)}
              {r.deferred ? <Tag tone="muted">{t('Switched off')}</Tag> : r.verified ? <Tag tone="ok">{t('Name verified')}</Tag> : <Tag tone="danger">{t('Name unverified')}</Tag>}
              {r.applies_from_level > 1 && <Tag>{t('from {level}', { level: levelLabel(r.applies_from_level) })}</Tag>}
              {curator && !r.deferred && <Button variant="quiet" onClick={async () => {
                if (await run(() => api(`/game/resources/${r.key}`, { method: 'PATCH', body: { verified: !r.verified } }))) resources.reload();
              }}>{r.verified ? t('Mark unverified') : t('Mark verified')}</Button>}
              {isAdmin && <Button variant="quiet" onClick={async () => {
                if (await run(() => api(`/game/resources/${r.key}`, { method: 'PATCH', body: { deferred: !r.deferred } }), r.deferred ? t('Now used in calculations') : t('Left out of calculations'))) resources.reload();
              }}>{r.deferred ? t('Use in calculations') : t('Switch off')}</Button>}
            </li>
          ))}</ul>
          <p className="muted small">{t('Levels after 30 are Truegold tiers: TG1, TG2 and so on. Truegold and Tempered Truegold are only expected from TG1.')}</p>
        </Panel>
      )}</Async>
      </div>

      {modal === 'building' && <BuildingForm onClose={() => setModal(null)} onSaved={reloadAll} />}
      {modal === 'version' && <VersionForm versions={versions.data?.versions ?? []} onClose={() => setModal(null)} onSaved={(id) => { setVid(id); reloadAll(); }} />}
      {modal === 'import' && vid && <ImportForm vid={vid} resources={resources.data?.resources ?? []} onClose={() => setModal(null)} onSaved={reloadAll} />}
      {modal && typeof modal === 'object' && vid && buildingId && (
        <LevelForm vid={vid} buildingId={buildingId} existing={modal.level} resources={resources.data?.resources ?? []}
          buildings={buildings.data?.buildings ?? []} onClose={() => setModal(null)} onSaved={reloadAll} />
      )}
    </>
  );
}

function BuildingForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (await run(() => api('/game/buildings', { body: { key: f.get('key'), name: f.get('name'), max_level: Number(f.get('max_level')), notes: f.get('notes') } }), t('Building added'))) { onSaved(); onClose(); }
  }
  return (
    <Modal title={t('Add building')} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Field label={t('Name')}><Input name="name" required /></Field>
        <Field label={t('Key')} hint={t('Lowercase id used in CSV files, e.g. town_center.')}><Input name="key" required pattern="[a-z0-9_]{2,40}" /></Field>
        <Field label={t('Maximum level')} hint={t('30 for normal levels. 36 if the building has TG1–TG6.')}><Input name="max_level" type="number" min={1} required defaultValue={30} /></Field>
        <Field label={t('Notes')}><textarea className="input" name="notes" rows={2} /></Field>
        <Button variant="primary" busy={busy} type="submit">{t('Add building')}</Button>
      </form>
    </Modal>
  );
}

function VersionForm({ versions, onClose, onSaved }: { versions: any[]; onClose: () => void; onSaved: (id: number) => void }) {
  const { busy, run } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const copy = Number(f.get('copy_from'));
    const r: any = await run(() => api('/game/versions', { body: { label: f.get('label'), notes: f.get('notes'), ...(copy ? { copy_from: copy } : {}) } }), t('Draft created'));
    if (r) { onSaved(r.version.id); onClose(); }
  }
  return (
    <Modal title={t('New draft version')} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Field label={t('Label')} hint={t('e.g. Audit 2026-11, or the game patch it reflects.')}><Input name="label" required maxLength={80} /></Field>
        <Field label={t('Start from')}>
          <select className="input" name="copy_from" defaultValue={versions.find((v) => v.status === 'published')?.id ?? ''}>
            <option value="">{t('Empty')}</option>
            {versions.map((v) => <option key={v.id} value={v.id}>{t('Copy of {label}', { label: v.label })}</option>)}
          </select>
        </Field>
        <Field label={t('Notes')}><textarea className="input" name="notes" rows={3} /></Field>
        <Button variant="primary" busy={busy} type="submit">{t('Create draft')}</Button>
      </form>
    </Modal>
  );
}

function ImportForm({ vid, resources, onClose, onSaved }: { vid: number; resources: any[]; onClose: () => void; onSaved: () => void }) {
  const [csv, setCsv] = useState('');
  const [addBuildings, setAddBuildings] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const { busy, run } = useAction();
  const header = ['building', 'level', ...resources.map((r) => r.key), 'duration_seconds', 'prerequisites', 'status', 'source_url', 'source_checked_at', 'game_version', 'notes'].join(',');
  async function submit() {
    setErrors([]);
    try {
      const r: any = await api(`/game/versions/${vid}/import`, { body: { csv, add_buildings: addBuildings } });
      await run(async () => r, t('Imported {n} records', { n: r.imported }));
      onSaved(); onClose();
    } catch (e: any) { setErrors([e.message, ...(e.details ?? [])]); }
  }
  return (
    <Modal title={t('Import CSV')} onClose={onClose} footer={<Button variant="primary" busy={busy} disabled={!csv} onClick={submit}>{t('Import')}</Button>}>
      <div className="stack">
        <p className="muted small">{t('Columns (header row required):')}</p>
        <code className="codeblock">{header}</code>
        <p className="muted small">{t('Status is one of: in_game_confirmed, cross_checked, single_source, conflicting, missing. Level can be a number or TG1–TG6. A blank cost means not recorded, not zero. Every row is checked first; if any row fails, nothing is saved.')}</p>
        <Input type="file" accept=".csv,text/csv" onChange={async (e) => setCsv(await e.target.files?.[0]?.text() ?? '')} aria-label={t('CSV file')} />
        <label className="radio"><input type="checkbox" checked={addBuildings} onChange={(e) => setAddBuildings(e.target.checked)} /> {t('Add buildings that are not in the library yet, and raise max levels to fit the file')}</label>
        {errors.length > 0 && <ul className="warnings">{errors.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      </div>
    </Modal>
  );
}

function LevelForm({ vid, buildingId, existing, resources, buildings, onClose, onSaved }:
  { vid: number; buildingId: number; existing?: any; resources: any[]; buildings: any[]; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const costs: Record<string, number> = {};
    for (const r of resources) { const v = String(f.get(`cost_${r.key}`) ?? '').replace(/[, ]/g, ''); if (v !== '') costs[r.key] = Number(v); }
    const lvl = existing?.level ?? newLevel;
    const prereq = String(f.get('prerequisites') ?? '').split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [building, level] = s.split(':'); return { building: building.trim(), level: Number(level) };
    });
    const dur = String(f.get('duration_seconds') ?? '');
    const body = {
      building_id: buildingId, level: lvl, costs, prerequisites: prereq,
      duration_seconds: dur === '' ? null : Number(dur), status: f.get('status'),
      source_url: f.get('source_url') || null, source_checked_at: f.get('source_checked_at') || null,
      game_version: f.get('game_version') || null, notes: f.get('notes') ?? '',
    };
    if (await run(() => api(`/game/versions/${vid}/levels`, { method: 'PUT', body }), t('Record saved'))) { onSaved(); onClose(); }
  }
  const b = buildings.find((x) => x.id === buildingId);
  const [newLevel, setNewLevel] = useState(1);
  return (
    <Modal title={existing ? t('Edit level {level}', { level: levelLabel(existing.level) }) : t('Add level to {building}', { building: b?.name })} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <div className="row">
          <Field label={t('Level')} hint={t('Cost to upgrade from the level below to this one.')}>{existing ? <Input readOnly value={levelLabel(existing.level)} /> : <LevelSelect label={t('Level')} min={1} max={b?.max_level ?? 30} value={newLevel} onChange={setNewLevel} />}</Field>
          <Field label={t('Status')}><select className="input" name="status" defaultValue={existing?.status ?? 'single_source'}>{statusOptions().map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
        <div className="row wrap">
          {resources.map((r) => (
            <Field key={r.key} label={resName(r.key, r.name) + (r.deferred ? ` (${t('stored only')})` : '')} hint={t('Blank = not recorded')}>
              <Input name={`cost_${r.key}`} inputMode="numeric" defaultValue={existing?.costs?.[r.key] ?? ''} />
            </Field>
          ))}
        </div>
        <div className="row">
          <Field label={t('Base time (seconds)')}><Input name="duration_seconds" type="number" min={0} defaultValue={existing?.duration_seconds ?? ''} /></Field>
          <Field label={t('Requires')} hint="key:level;key:level"><Input name="prerequisites" defaultValue={existing?.prerequisites?.map((p: any) => `${p.building}:${p.level}`).join(';')} /></Field>
        </div>
        <Field label={t('Source URL')} hint={t('Required unless confirmed in game.')}><Input name="source_url" type="url" defaultValue={existing?.source_url ?? ''} /></Field>
        <div className="row">
          <Field label={t('Checked on')}><Input name="source_checked_at" type="date" defaultValue={existing?.source_checked_at ?? ''} /></Field>
          <Field label={t('Game version')}><Input name="game_version" defaultValue={existing?.game_version ?? ''} /></Field>
        </div>
        <Field label={t('Notes')}><textarea className="input" name="notes" rows={2} defaultValue={existing?.notes} /></Field>
        <Button variant="primary" busy={busy} type="submit">{t('Save record')}</Button>
      </form>
    </Modal>
  );
}
