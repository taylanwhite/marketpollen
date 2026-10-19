CREATE TABLE IF NOT EXISTS "plan_stops" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "plan_date" DATE NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "opportunity_id" UUID,
  "business_id" UUID,
  "place_id" TEXT,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "city" TEXT,
  "state" TEXT,
  "zip_code" TEXT,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_stops_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plan_stops_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "plan_stops_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "plan_stops_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "plan_stops_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "plan_stops_store_id_plan_date_idx" ON "plan_stops"("store_id", "plan_date");
CREATE INDEX IF NOT EXISTS "plan_stops_user_id_plan_date_idx" ON "plan_stops"("user_id", "plan_date");
