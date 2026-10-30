-- King's Castle appointments: positions members can book in time slots.
ALTER TABLE user_permissions DROP CONSTRAINT user_permissions_permission_check;
ALTER TABLE user_permissions ADD CONSTRAINT user_permissions_permission_check CHECK (permission IN
  ('event_manager','data_curator','alliance_manager','announcement_manager','integration_manager','appointment_manager'));

-- Reusable list of positions the King can appoint (names and buffs are editable, nothing hard-coded)
CREATE TABLE appointment_positions (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  buff        TEXT NOT NULL DEFAULT '',
  sort        INT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One term of appointments, e.g. after winning the King's Castle
CREATE TABLE appointment_schedules (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  starts_at       TIMESTAMPTZ NOT NULL,          -- UTC
  ends_at         TIMESTAMPTZ NOT NULL,
  slot_minutes    INT NOT NULL CHECK (slot_minutes BETWEEN 5 AND 1440),
  max_per_member  INT CHECK (max_per_member IS NULL OR max_per_member >= 1),   -- NULL = no limit
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  notes           TEXT NOT NULL DEFAULT '',
  created_by      INT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE appointment_schedule_positions (
  schedule_id INT NOT NULL REFERENCES appointment_schedules(id) ON DELETE CASCADE,
  position_id INT NOT NULL REFERENCES appointment_positions(id) ON DELETE CASCADE,
  PRIMARY KEY (schedule_id, position_id)
);

CREATE TABLE appointment_bookings (
  id          SERIAL PRIMARY KEY,
  schedule_id INT NOT NULL REFERENCES appointment_schedules(id) ON DELETE CASCADE,
  position_id INT NOT NULL REFERENCES appointment_positions(id) ON DELETE CASCADE,
  slot_start  TIMESTAMPTZ NOT NULL,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booked_by   INT REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, position_id, slot_start),   -- one holder per position per slot
  UNIQUE (schedule_id, user_id, slot_start)        -- one position per person per slot
);
CREATE INDEX appointment_bookings_slot_idx ON appointment_bookings (slot_start);
