-- Leaders' notes list: plain rows (name, alliance, Truegold, free time, note). Not tied to accounts,
-- so players who have not registered can be listed too. Registered players are linked by name when shown.
CREATE TABLE roster_notes (
  id           SERIAL PRIMARY KEY,
  alliance_tag TEXT NOT NULL DEFAULT '',
  name         TEXT NOT NULL,
  truegold     BIGINT CHECK (truegold IS NULL OR truegold >= 0),
  free_time    TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  sort         INT NOT NULL DEFAULT 0,
  created_by   INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Bring over notes saved with the previous version
INSERT INTO roster_notes (alliance_tag, name, truegold, free_time, note, created_by, updated_by, created_at, updated_at)
SELECT COALESCE(a.tag, ''), COALESCE(u.ingame_name, u.display_name), n.truegold, n.free_time, n.note, n.updated_by, n.updated_by, n.updated_at, n.updated_at
  FROM member_notes n JOIN users u ON u.id = n.user_id
  LEFT JOIN alliance_members am ON am.user_id = u.id LEFT JOIN alliances a ON a.id = am.alliance_id;
