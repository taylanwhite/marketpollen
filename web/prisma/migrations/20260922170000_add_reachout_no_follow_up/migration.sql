-- Donations can be marked as needing no follow-up, so we don't
-- schedule a reminder or email the marketer.
ALTER TABLE "reachouts" ADD COLUMN IF NOT EXISTS "no_follow_up" BOOLEAN NOT NULL DEFAULT FALSE;
