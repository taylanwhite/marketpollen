-- Moves the old one-schedule-per-contact columns into follow_up_cadences.
-- Safe to run on every deploy: once copied, the old columns are cleared.
-- The build runs this after `prisma db push`, which creates the table.
BEGIN;
CREATE TEMP TABLE "_legacy_cadences" ON COMMIT DROP AS
  SELECT gen_random_uuid() AS "id", c."id" AS "contact_id", c."follow_up_every_days" AS "every_days",
         c."follow_up_assignee" AS "assignee", c."suggested_follow_up_date" AS "next_date", c."created_by"
  FROM "contacts" c
  WHERE c."follow_up_every_days" IS NOT NULL;

INSERT INTO "follow_up_cadences" ("id", "contact_id", "every_days", "assignee", "next_date", "created_by", "created_at", "updated_at")
  SELECT "id", "contact_id", "every_days", "assignee", "next_date", "created_by", NOW(), NOW() FROM "_legacy_cadences";

-- Link each schedule's upcoming reminder on the calendar to its new cadence.
UPDATE "calendar_events" e SET "follow_up_cadence_id" = l."id"
  FROM "_legacy_cadences" l
  WHERE e."contact_id" = l."contact_id" AND e."type" = 'followup' AND e."status" = 'scheduled'
    AND e."follow_up_cadence_id" IS NULL AND e."description" LIKE 'Scheduled follow-up (%';

UPDATE "contacts" SET "follow_up_every_days" = NULL, "follow_up_assignee" = NULL
  WHERE "id" IN (SELECT "contact_id" FROM "_legacy_cadences");
COMMIT;
