-- Remember when a member chose sharing on/off themselves, so admin "turn on for everyone" never overrides "off".
ALTER TABLE users ADD COLUMN share_user_choice BOOLEAN;
