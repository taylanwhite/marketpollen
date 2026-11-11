-- Terms of Service / Privacy Policy acceptance
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_accepted_version" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_accepted_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "legal_acceptances" (
  "id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip_address" TEXT,
  "user_agent" TEXT,
  CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "legal_acceptances_user_id_idx" ON "legal_acceptances"("user_id");
