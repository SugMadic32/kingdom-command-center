-- Leader notes about a member (free time, Truegold count, anything else). Leaders only; not part of the member's inventory.
CREATE TABLE member_notes (
  user_id    INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  free_time  TEXT NOT NULL DEFAULT '',
  truegold   BIGINT CHECK (truegold IS NULL OR truegold >= 0),
  note       TEXT NOT NULL DEFAULT '',
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
