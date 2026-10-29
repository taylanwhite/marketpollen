ALTER TABLE "plan_stops" ADD COLUMN IF NOT EXISTS "assigned_by" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "follow_up_every_days" INTEGER;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "follow_up_assignee" TEXT;
