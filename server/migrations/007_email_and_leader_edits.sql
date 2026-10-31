-- Email notifications (sent through an HTTPS email API: Resend or Brevo)
ALTER TABLE users ADD COLUMN notify_email BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE notifications DROP CONSTRAINT notifications_channel_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_channel_check CHECK (channel IN ('site','push','discord','email'));
-- Who last changed a member's numbers (the member, or a leader helping them)
ALTER TABLE member_inventory ADD COLUMN updated_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE member_buildings ADD COLUMN updated_by INT REFERENCES users(id) ON DELETE SET NULL;
