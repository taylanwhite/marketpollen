ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "organization_type" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "is_corporate_account" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "tax_exempt_number" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "card_on_file_last4" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "corporate_status" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);

UPDATE "contacts"
SET "updated_at" = COALESCE("last_reachout_date", "created_at")
WHERE "updated_at" IS NULL;

ALTER TABLE "contacts" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "contacts" ALTER COLUMN "updated_at" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "contacts_store_id_corporate_idx" ON "contacts"("store_id", "is_corporate_account");
