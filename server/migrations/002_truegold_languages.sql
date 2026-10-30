-- Truegold tiers are now calculated (data provided from in-game screenshots, approved by the project).
-- Levels above 30 are Truegold tiers: level 31 = TG1 ... level 36 = TG6.
UPDATE resource_types SET deferred = FALSE WHERE key IN ('truegold', 'tempered_truegold');

-- Supported interface languages
UPDATE users SET language = 'en' WHERE language NOT IN ('en','ko','fr','id');
ALTER TABLE users ADD CONSTRAINT users_language_check CHECK (language IN ('en','ko','fr','id'));

-- A resource is only expected from this level up (Truegold types start at TG1 = level 31).
ALTER TABLE resource_types ADD COLUMN applies_from_level INT NOT NULL DEFAULT 1;
UPDATE resource_types SET applies_from_level = 31 WHERE key IN ('truegold', 'tempered_truegold');
