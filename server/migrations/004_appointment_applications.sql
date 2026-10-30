-- Game-style appointments: members apply for a slot, the King (or a manager) approves one applicant.
ALTER TABLE appointment_schedules ADD COLUMN mode TEXT NOT NULL DEFAULT 'apply' CHECK (mode IN ('apply','first_come'));

CREATE TABLE appointment_applications (
  id          SERIAL PRIMARY KEY,
  schedule_id INT NOT NULL REFERENCES appointment_schedules(id) ON DELETE CASCADE,
  position_id INT NOT NULL REFERENCES appointment_positions(id) ON DELETE CASCADE,
  slot_start  TIMESTAMPTZ NOT NULL,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, position_id, slot_start, user_id)
);
CREATE INDEX appointment_applications_cell_idx ON appointment_applications (schedule_id, position_id, slot_start);

-- The six Minister positions from the in-game Appointment screen. Edit or delete them in the website.
INSERT INTO appointment_positions (name, buff, sort) VALUES
  ('Chief Minister', 'Construction Speed +10%, Research Speed +10%, Training Speed +10%', 1),
  ('Minister of Justice', '', 2),
  ('Minister of the Interior', '', 3),
  ('Field Commander', '', 4),
  ('Marshal', '', 5),
  ('Noble Advisor', '', 6)
ON CONFLICT (name) DO NOTHING;
