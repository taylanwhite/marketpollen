-- Stores are archived instead of deleted so contacts and businesses stay on file.
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);
