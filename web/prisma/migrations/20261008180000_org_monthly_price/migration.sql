-- Each organization can have its own monthly price per store. Existing orgs stay at $65.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "monthly_price_cents" INTEGER NOT NULL DEFAULT 6500;
