-- Leaders can make upgrade plans for members; the plan belongs to the member.
ALTER TABLE upgrade_plans ADD COLUMN created_by INT REFERENCES users(id) ON DELETE SET NULL;
-- Kingdom-wide settings (e.g. whether new members share resources with leaders by default)
INSERT INTO integration_settings (key, value) VALUES ('kingdom', '{"share_default": true}') ON CONFLICT (key) DO NOTHING;
