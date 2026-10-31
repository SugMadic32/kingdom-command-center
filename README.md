# KingShot Kingdom Command Center

A kingdom-wide planning site for KingShot players: personal resources and upgrade plans, a building cost calculator, KVK preparation, castle and event scheduling, announcements, and website / browser / Discord reminders. Built for Alliance GTO first, with room for every alliance in the kingdom.

> Fan-made tool. Not affiliated with Century Games. It never asks for or stores game passwords.

## Stack

- **web/** — React 18 + TypeScript + Vite. Dark navy/gold theme with a light option.
- **server/** — Node 22 + Express + TypeScript (run with `tsx`), PostgreSQL 16.
- **Discord bot** — runs inside the server process when a token is set.

## Quick start (local)

1. Install Node 22 and PostgreSQL 16, then create a database:
   `createdb kingdom`
2. Copy `.env.example` to `.env` and set `DATABASE_URL`.
3. Install: `npm run install:all`
4. Start the API: `npm run dev:api` (runs migrations automatically on start)
5. Start the web app: `npm run dev:web`, then open http://localhost:5173
6. **Register the first account.** The first account becomes the kingdom admin. Use mamamiya's account.

## Deploy (one server)

- `docker compose up -d --build` → site on port 4000. Put it behind HTTPS (Caddy, Nginx, or your host's proxy).
- Set `APP_URL` to the public https URL and `NODE_ENV=production`.
- Managed hosting also works: build `web/`, run `server/` with `npm start`. The server serves `web/dist` automatically.
- Run `scripts/backup.sh` daily from cron and copy the backups off the server. `scripts/restore.sh` restores one.

## Deploy on Oracle Cloud Always Free (or any Linux server)

Uses `docker-compose.prod.yml`, which adds Caddy for automatic HTTPS. Step-by-step:

1. Create an Ubuntu VM (Ampere A1, within the free limits), open TCP 80 and 443 in the subnet's Security List, and on the VM:
   `sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save`
2. Install Docker: `curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER` (log out and back in).
3. Point a domain at the VM's public IP (free: duckdns.org).
4. `git clone` the repository, `cp .env.example .env`, set `SITE_DOMAIN`, `APP_URL=https://<domain>`, `POSTGRES_PASSWORD`.
5. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
6. Updates: `./deploy/update.sh`. Backups: add `deploy/backup.sh` to crontab and copy `backups/` off the server.

Oracle may reclaim Always Free VMs it considers idle. Keep backups off the server.

## First-time setup checklist (admin)

1. **Admin console → Members & roles:** make trusted players *Officer*, then give each one only the permissions they need.
2. **Alliances:** add GTO and the other alliances, then set each alliance's R5.
3. **Game data library:** add buildings → create a draft version → import audited costs from CSV → check the coverage report → publish.
4. **KVK preparation:** add the season, phases and checklist once the in-game dates are known.
5. **Optional:** set up Discord and browser push (see below).

## Roles and permissions

| Who | Can do |
| --- | --- |
| Member | Own inventory, buildings, plans, goals, settings. Answer polls, RSVP, view published info. |
| R4 / R5 | Manage their own alliance: members (R4: R1–R3; R5 can also appoint R4), alliance events and announcements, and see data members chose to share. Can *propose* kingdom events. |
| Officer | Nothing extra until granted: `event_manager`, `announcement_manager`, `data_curator`, `alliance_manager`, `integration_manager`, `appointment_manager`. |
| Admin | Everything, including roles. At least one admin must always exist. |

- Every check runs on the server. Hiding a button is never the only protection.
- Important actions are written to **Audit history**.

## Game data rules

- One CSV row = the cost to upgrade *to* that level from the level below.
- Columns: see `scripts/building-data-template.csv`.
- Status values: `in_game_confirmed`, `cross_checked`, `single_source`, `conflicting`, `missing`.
- A source URL is required unless the record is in-game confirmed.
- Import is all-or-nothing: one bad row means nothing is saved, and the error lists the row.
- Published versions are locked. To fix data, create a new draft (copy the published one), edit, and publish.
- The calculator never fills gaps. Missing or conflicting levels are excluded and the result is marked **incomplete**.
- Saved plans record the dataset version they used.
- **No real building costs are included.** The audit has to be done first, using the sources listed in the spec.
- **Truegold tiers:** levels above 30 are TG tiers (31 = TG1 … 36 = TG6). CSV files can use `TG1`–`TG6` in the level column.
- **Truegold and Tempered Truegold are calculated** (switched on in migration 002). They only apply from TG1. An admin can switch any resource out of calculations in the Game data library.
- **A blank cost means "not recorded", never zero.** If a TG row has Truegold but no Bread/Wood/Stone/Iron, the calculator shows those totals with a `+` and marks the result incomplete. Enter `0` once you have confirmed a resource is not needed.
- **Resource names** (Bread, Wood, Stone, Iron) are marked *unverified*. A curator confirms them in game and marks them verified.

## Editing your data

Everything the site shows is entered by your own officers. Nothing is pre-filled except the resource names.

- **KVK:** Edit season (name, dates, notes), Delete season, edit or delete each phase and checklist item.
- **Events:** Edit, reschedule, cancel. Members are notified about time changes.
- **Announcements:** Edit, pin, delete.
- **Alliances:** Edit name and description (R4/R5). The tag can only be changed by an alliance manager or admin.
- **King's appointments:** edit positions (name, buff, on/off, delete if unused) and schedules (name, times, slot length, limit, notes).
- **Game data:** edit buildings (name, max level, notes), rename dataset versions, edit level records in a draft.
- Every change is saved in **Audit history**.

## Member planning

- **Who:** the kingdom admin and alliance managers see every member. R4/R5 see their own alliance.
- **What:** each member's shared resources, Town Center level and last update. Members who don't share show "Not shared".
- **Plan for a member:** click **Plan**, choose buildings and levels, then **Calculate** using their resources, then **Send plan**. It appears in the member's Saved plans, tagged with who made it, and they get a notification.
- **Turn on sharing for everyone:** Member planning → button in the notice (admin and alliance managers). Members who never chose get sharing on and a notification explaining how to turn it off. Members who turned it off themselves are skipped. There is also a per-member *Turn on sharing* button.
- **Sharing default:** Admin console → Members & roles → *Sharing default*. When on, new members share with leaders (the sign-up page tells them) and can turn it off in Settings. Existing members turn it on themselves.
- **Delete old datasets:** Game data library → pick a draft or archived version → Delete. The published one can't be deleted.

## Email notifications

Railway's Hobby plan blocks SMTP, so email goes through an HTTPS email API. Set these Railway variables and redeploy:

| Variable | Value |
|---|---|
| `EMAIL_PROVIDER` | `resend` or `brevo` |
| `EMAIL_API_KEY` | API key from that service |
| `EMAIL_FROM` | Sender address (a domain or sender you verified with the service) |
| `EMAIL_FROM_NAME` | Optional, e.g. `GTO Command Center` |

Then **Admin console → Integrations → Send test email to me**.

- **Admin:** Admin console → Members & roles → *Turn on for everyone*, or the Email switch per member. *Defaults for new members* turns email on for new sign-ups (they are told).
- **Members:** Settings → Notifications → Email on/off. If a member turns it off themselves, admin switches skip them. Failed sends appear in the Delivery log with the reason.

## Typing amounts

Resource boxes accept `295M`, `1.5B`, `250K`, `2T`, `1,5B`, `3억`, `500만`. The exact number is shown under the box before saving.

## King's appointments

After the King's Castle is won, members book time slots for the positions the King can appoint.

- **Who runs it:** the admin, or an officer with the `appointment_manager` permission (Admin console → Permissions).
- **Positions:** the six in-game Ministers (Chief Minister, Minister of Justice, Minister of the Interior, Field Commander, Marshal, Noble Advisor) are added automatically. Chief Minister has its buffs filled in; add the others' buffs under **Positions**. Separate buffs with commas to show them as a list.
- **Two modes per schedule:** *Members apply, the King chooses* (default, like the game) or *First come, first served*.
- **Apply mode:** members tap **Apply** on 30-minute slots; everyone sees how many applied. The King or a manager taps **Choose**, then **Appoint** on one applicant. Members only see their own applications, not other applicants' names.
- **By position** view looks like the game: a card per Minister with the current holder and a live countdown. **All positions** shows the full table.
- **Each term:** **New schedule** → start, end, slot length, which positions, optional max slots per member → **Open booking**.
- **Members** click **Book** on a free cell. The server blocks double-booking, holding two positions at the same time, booking past slots and going over the limit.
- **Managers** can **Assign** any member to a slot, or remove anyone. The member is notified.
- **Reminders** are sent before each slot, using the member's reminder setting, in their language. Discord command: `/appointments`.
- **Copy schedule** gives a UTC (game time) text list to paste in game chat or Discord. **CSV** downloads the same data.
- **Close booking** freezes changes for members. Managers can still edit.

## Ready-made data files (scripts/data)

- `gto-all-building-costs-import.csv`: everything below in one file (130 rows). Import it into a draft version with **Add buildings…** ticked, then publish.
- `gto-building-costs-import.csv`: Town Center 1–29, Academy 1–30, Storehouse 1–29 from the GTO starter workbook (single source, community reference).
- `gto-truegold-tiers-import.csv`: TG1–TG6 Truegold totals for Town Center, Embassy, Command Center, Infirmary, Barracks, Stable and Range (in-game screenshots).

## Languages

- English, Korean (한국어), French (Français) and Indonesian (Bahasa Indonesia).
- The switcher is in the top bar, on the sign-in page and in Settings. The choice is saved to the account.
- Notifications and Discord direct messages are written in each member's language. Posts in the shared Discord channel stay in English.
- Building names and the names curators type in are shown as entered.
- Translations live in `web/src/lib/dict.ts`. After adding UI text, run `python3 scripts/i18n-keys.py --missing` to list strings that still need translating.
- **Ask native speakers in the kingdom to review the wording**, especially in-game terms (resource and building names), which may differ from the official game translation.

## Notifications

- **Website:** always available. Members can switch it off.
- **Browser push:** run `npx web-push generate-vapid-keys`, set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, then members turn it on in Settings.
- **Discord:**
  1. Create an application at discord.com/developers → Bot → copy the token.
  2. Set `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID` and `DISCORD_GUILD_ID` in `.env`, then restart.
  3. Invite the bot with the scopes `bot` and `applications.commands`. It needs only **Send Messages** and **View Channel**.
  4. In **Admin console → Integrations**, enter the announcement channel ID and turn posts on.
  5. Members link their accounts in Settings, which gives them a code for `/link`.
  - Commands: `/events`, `/castle`, `/kvk`, `/appointments` and `/resources` (private replies), `/link`.
- Failed deliveries show in **Admin console → Delivery log** with the reason and a retry button. Nothing is reported as sent unless it was.
- Run only one API instance with `RUN_JOBS=true`, so reminders are not sent twice.

## Privacy

- Inventory and building levels are private by default. Sharing goes to the member's own alliance R4/R5 only, and can be switched off at any time.
- Read-only plan links show costs, never the member's inventory.
- Members can download all their data (JSON) or delete their account from Settings.
- Password reset: an admin creates a single-use link that lasts 24 hours and sends it privately. The site has no email sending yet.

## Tests

```
createdb kingdom_test
TEST_DATABASE_URL=postgres://USER:PASS@localhost:5432/kingdom_test npm test
```

- 173 end-to-end checks cover permissions, privacy, the calculator, Truegold tiers, events, King's appointments, reminders, languages, audit and account deletion.
- **Warning:** the test wipes the test database. Never point it at production.

## Known limits (honest list)

- Building data covers 3 buildings for levels 1–29/30 and 7 buildings for TG1–TG6 (Truegold only). Town Center and Storehouse level 30, other buildings' normal levels, TG build times and TG base resources are still missing.
- No email: password recovery goes through admin reset links.
- Google/Discord sign-in is not built. Login is email and password.
- Not load-tested. It is sized for one kingdom, a few hundred players.
- Screenshot-assisted data entry is deferred, as in the spec.
