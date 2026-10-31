ALTER TABLE "refresh_tokens" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "replaced_by" varchar(64);--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
-- Rows revoked before this migration get a revocation time so cleanup can age them out
UPDATE "refresh_tokens" SET "revoked_at" = now() WHERE "is_revoked" = true AND "revoked_at" IS NULL;
