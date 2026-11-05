CREATE TABLE IF NOT EXISTS "follow_up_cadences" (
  "id" UUID NOT NULL,
  "contact_id" UUID NOT NULL,
  "every_days" INTEGER NOT NULL,
  "note" TEXT,
  "assignee" TEXT,
  "next_date" TIMESTAMP(3),
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "follow_up_cadences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "follow_up_cadences_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "follow_up_cadences_contact_id_idx" ON "follow_up_cadences"("contact_id");
CREATE INDEX IF NOT EXISTS "follow_up_cadences_next_date_idx" ON "follow_up_cadences"("next_date");

ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "follow_up_cadence_id" UUID;
DO $$ BEGIN
  ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_follow_up_cadence_id_fkey"
    FOREIGN KEY ("follow_up_cadence_id") REFERENCES "follow_up_cadences"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
