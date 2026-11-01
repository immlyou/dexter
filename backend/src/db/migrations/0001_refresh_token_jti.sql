-- Existing rows hold bcrypt hashes of tokens signed with the old shared secret; they cannot be
-- looked up by jti and are no longer accepted, so drop them (users must log in again).
DELETE FROM "refresh_tokens";--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "jti" varchar(64) NOT NULL;--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_jti_unique" UNIQUE("jti");
