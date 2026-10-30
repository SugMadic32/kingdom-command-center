-- KingShot Kingdom Command Center — initial schema
-- Reference data, member data, events and permissions are kept in separate tables.

CREATE TABLE users (
  id               SERIAL PRIMARY KEY,
  email            TEXT UNIQUE,
  password_hash    TEXT,
  display_name     TEXT NOT NULL,
  ingame_name      TEXT,
  kingdom_role     TEXT NOT NULL DEFAULT 'member' CHECK (kingdom_role IN ('member','officer','admin')),
  time_zone        TEXT NOT NULL DEFAULT 'UTC',
  language         TEXT NOT NULL DEFAULT 'en',
  share_inventory  BOOLEAN NOT NULL DEFAULT FALSE,   -- with own alliance leaders only
  share_buildings  BOOLEAN NOT NULL DEFAULT FALSE,
  notify_site      BOOLEAN NOT NULL DEFAULT TRUE,
  notify_push      BOOLEAN NOT NULL DEFAULT FALSE,
  notify_discord   BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_minutes INT NOT NULL DEFAULT 30 CHECK (reminder_minutes BETWEEN 5 AND 1440),
  discord_user_id  TEXT UNIQUE,
  discord_link_code TEXT,
  discord_link_expires TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE password_resets (
  token_hash  TEXT PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by  INT REFERENCES users(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

-- Narrow permissions granted on top of kingdom_role
CREATE TABLE user_permissions (
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL CHECK (permission IN
               ('event_manager','data_curator','alliance_manager','announcement_manager','integration_manager')),
  granted_by  INT REFERENCES users(id),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE alliances (
  id          SERIAL PRIMARY KEY,
  tag         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A player belongs to at most one alliance
CREATE TABLE alliance_members (
  user_id     INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  alliance_id INT NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  rank        TEXT NOT NULL DEFAULT 'R1' CHECK (rank IN ('R1','R2','R3','R4','R5')),
  power       BIGINT,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Game reference data ----------
CREATE TABLE resource_types (
  key         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort        INT NOT NULL DEFAULT 0,
  verified    BOOLEAN NOT NULL DEFAULT FALSE,
  deferred    BOOLEAN NOT NULL DEFAULT FALSE  -- e.g. Truegold: not used in calculations yet
);

CREATE TABLE game_buildings (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  max_level   INT NOT NULL CHECK (max_level > 0),
  notes       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE dataset_versions (
  id           SERIAL PRIMARY KEY,
  label        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  notes        TEXT NOT NULL DEFAULT '',
  created_by   INT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

-- One row = the cost of upgrading a building from (level - 1) to level
CREATE TABLE building_levels (
  id                 SERIAL PRIMARY KEY,
  dataset_version_id INT NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  building_id        INT NOT NULL REFERENCES game_buildings(id) ON DELETE CASCADE,
  level              INT NOT NULL CHECK (level > 0),
  costs              JSONB NOT NULL DEFAULT '{}',   -- {"wood": 1200, ...}
  duration_seconds   INT,
  prerequisites      JSONB NOT NULL DEFAULT '[]',   -- [{"building":"town_center","level":5}]
  source_url         TEXT,
  source_checked_at  DATE,
  game_version       TEXT,
  status             TEXT NOT NULL DEFAULT 'single_source' CHECK (status IN
                      ('in_game_confirmed','cross_checked','single_source','conflicting','missing')),
  notes              TEXT NOT NULL DEFAULT '',
  updated_by         INT REFERENCES users(id),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dataset_version_id, building_id, level)
);

-- ---------- Member-owned data ----------
CREATE TABLE member_inventory (
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_key TEXT NOT NULL REFERENCES resource_types(key) ON UPDATE CASCADE,
  amount       BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, resource_key)
);

CREATE TABLE member_buildings (
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  building_id INT NOT NULL REFERENCES game_buildings(id) ON DELETE CASCADE,
  level       INT NOT NULL CHECK (level >= 0),
  notes       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, building_id)
);

CREATE TABLE upgrade_plans (
  id                   SERIAL PRIMARY KEY,
  owner_id             INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  items                JSONB NOT NULL DEFAULT '[]',  -- [{"building_id":1,"from":5,"to":8}]
  assumptions          JSONB NOT NULL DEFAULT '{}',  -- {"speed_bonus_pct":10,"speedup_minutes":0}
  dataset_version_id   INT REFERENCES dataset_versions(id) ON DELETE SET NULL,
  result               JSONB,
  shared_with_alliance BOOLEAN NOT NULL DEFAULT FALSE,
  share_token          TEXT UNIQUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE goals (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  due_date    DATE,
  done        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- KVK ----------
CREATE TABLE kvk_seasons (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ,
  notes       TEXT NOT NULL DEFAULT '',
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kvk_phases (
  id          SERIAL PRIMARY KEY,
  season_id   INT NOT NULL REFERENCES kvk_seasons(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE kvk_checklist_items (
  id          SERIAL PRIMARY KEY,
  season_id   INT NOT NULL REFERENCES kvk_seasons(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort        INT NOT NULL DEFAULT 0
);

CREATE TABLE member_checklist (
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id     INT NOT NULL REFERENCES kvk_checklist_items(id) ON DELETE CASCADE,
  done        BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

-- ---------- Events & scheduling ----------
CREATE TABLE events (
  id               SERIAL PRIMARY KEY,
  scope            TEXT NOT NULL CHECK (scope IN ('kingdom','alliance')),
  alliance_id      INT REFERENCES alliances(id) ON DELETE CASCADE,
  type             TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('castle','kvk','alliance','other')),
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','proposed','published','cancelled')),
  starts_at        TIMESTAMPTZ,              -- canonical time, stored in UTC
  duration_minutes INT NOT NULL DEFAULT 60,
  poll_open        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by       INT REFERENCES users(id),
  approved_by      INT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((scope = 'alliance') = (alliance_id IS NOT NULL))
);

CREATE TABLE event_slots (
  id        SERIAL PRIMARY KEY,
  event_id  INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE availability (
  event_id     INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  slot_id      INT NOT NULL REFERENCES event_slots(id) ON DELETE CASCADE,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (slot_id, user_id)
);

CREATE TABLE attendance (
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'going' CHECK (status IN ('going','maybe','not_going','attended','absent')),
  assignment  TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE announcements (
  id          SERIAL PRIMARY KEY,
  scope       TEXT NOT NULL CHECK (scope IN ('kingdom','alliance')),
  alliance_id INT REFERENCES alliances(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  pinned      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((scope = 'alliance') = (alliance_id IS NOT NULL))
);

-- ---------- Notifications ----------
CREATE TABLE notifications (
  id            SERIAL PRIMARY KEY,
  user_id       INT REFERENCES users(id) ON DELETE CASCADE,   -- NULL for Discord channel posts
  channel       TEXT NOT NULL CHECK (channel IN ('site','push','discord')),
  kind          TEXT NOT NULL,          -- reminder, event_published, event_changed, event_cancelled, announcement
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  link          TEXT,
  event_id      INT REFERENCES events(id) ON DELETE CASCADE,
  dedupe_key    TEXT UNIQUE,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  error         TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_pending_idx ON notifications (status, scheduled_for);

CREATE TABLE push_subscriptions (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  keys       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Non-secret integration settings only. Tokens live in environment variables.
CREATE TABLE integration_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    INT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id   TEXT,
  alliance_id INT,
  summary     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

-- ---------- Seed reference rows ----------
-- Names are unverified until a data curator confirms them in-game.
INSERT INTO resource_types (key, name, sort, verified, deferred) VALUES
  ('bread', 'Bread', 1, FALSE, FALSE),
  ('wood',  'Wood',  2, FALSE, FALSE),
  ('stone', 'Stone', 3, FALSE, FALSE),
  ('iron',  'Iron',  4, FALSE, FALSE),
  ('truegold', 'Truegold', 10, FALSE, TRUE),
  ('tempered_truegold', 'Tempered Truegold', 11, FALSE, TRUE);
