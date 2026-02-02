-- AlterTable: add place_id to businesses (for linking to Google Places / opportunities)
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "place_id" TEXT;

-- CreateTable: opportunities (discovered places, convertible to businesses)
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "place_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip_code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "business_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "converted_at" TIMESTAMP(3),

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_store_id_place_id_key" ON "opportunities"("store_id", "place_id");
CREATE INDEX "opportunities_store_id_idx" ON "opportunities"("store_id");
CREATE INDEX "opportunities_store_id_status_idx" ON "opportunities"("store_id", "status");

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
