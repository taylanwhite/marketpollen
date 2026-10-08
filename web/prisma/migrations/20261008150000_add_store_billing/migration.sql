-- Per-store billing. Existing organizations stay unbilled until a global admin turns it on.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "billing_enabled" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "stripe_subscription_item_id" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "stripe_schedule_id" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "stripe_price_id" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscription_status" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "paid_quantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "renewal_quantity" INTEGER;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "current_period_end" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "billing_alert" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_stripe_customer_id_key" ON "organizations"("stripe_customer_id");
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_stripe_subscription_id_key" ON "organizations"("stripe_subscription_id");

ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "billing_status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "pause_on" TIMESTAMP(3);
