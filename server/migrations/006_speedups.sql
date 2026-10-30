-- Speedups live in the inventory (stored in minutes) but are never part of building costs.
ALTER TABLE resource_types ADD COLUMN kind TEXT NOT NULL DEFAULT 'resource' CHECK (kind IN ('resource','speedup'));
INSERT INTO resource_types (key, name, sort, verified, deferred, kind) VALUES
  ('speedup_general',      'General speedups',      20, TRUE, FALSE, 'speedup'),
  ('speedup_construction', 'Construction speedups', 21, TRUE, FALSE, 'speedup'),
  ('speedup_research',     'Research speedups',     22, TRUE, FALSE, 'speedup'),
  ('speedup_training',     'Training speedups',     23, TRUE, FALSE, 'speedup'),
  ('speedup_healing',      'Healing speedups',      24, TRUE, FALSE, 'speedup')
ON CONFLICT (key) DO NOTHING;
