CREATE TABLE IF NOT EXISTS "contact_businesses" (
  "contact_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  CONSTRAINT "contact_businesses_pkey" PRIMARY KEY ("contact_id", "business_id")
);

CREATE INDEX IF NOT EXISTS "contact_businesses_business_id_idx" ON "contact_businesses"("business_id");
