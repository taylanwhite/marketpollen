ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "payment_failed_at" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "payment_grace_notice_at" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "payment_final_notice_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "organization_invites" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "invited_by" TEXT NOT NULL,
  "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'pending',
  CONSTRAINT "organization_invites_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "organization_invites_email_status_idx" ON "organization_invites"("email", "status");
