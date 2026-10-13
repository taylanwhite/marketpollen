ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "is_corporate_account" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "tax_exempt_number" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "card_on_file_last4" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "corporate_status" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'is_corporate_account'
  ) THEN
    UPDATE "businesses" b
    SET
      "is_corporate_account" = true,
      "tax_exempt_number" = COALESCE(b."tax_exempt_number", c."tax_exempt_number"),
      "card_on_file_last4" = COALESCE(b."card_on_file_last4", c."card_on_file_last4"),
      "corporate_status" = COALESCE(b."corporate_status", c."corporate_status")
    FROM "contacts" c
    WHERE c."business_id" = b."id" AND c."is_corporate_account" = true;
  END IF;
END $$;

ALTER TABLE "contacts" DROP COLUMN IF EXISTS "is_corporate_account";
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "tax_exempt_number";
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "card_on_file_last4";
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "corporate_status";
DROP INDEX IF EXISTS "contacts_store_id_corporate_idx";
