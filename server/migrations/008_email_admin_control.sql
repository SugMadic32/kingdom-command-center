-- Remember when a member chose email on/off themselves, so admin bulk changes never override "off".
ALTER TABLE users ADD COLUMN notify_email_user_choice BOOLEAN;
UPDATE integration_settings SET value = value || '{"email_default": true}'::jsonb WHERE key = 'kingdom' AND NOT (value ? 'email_default');
