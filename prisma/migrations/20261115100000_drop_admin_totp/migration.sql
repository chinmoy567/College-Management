-- Client decision: the Admin logs in with email + password only (no authenticator app, no backup codes).
ALTER TABLE "users" DROP COLUMN "totp_secret_enc",
  DROP COLUMN "totp_enabled_at",
  DROP COLUMN "totp_pending_secret_enc",
  DROP COLUMN "totp_last_step",
  DROP COLUMN "backup_code_hashes";

ALTER TABLE "login_sessions" DROP COLUMN "step_up_pending",
  DROP COLUMN "totp_failures";
