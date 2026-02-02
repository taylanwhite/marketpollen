-- Baseline: existing DB was created with db push. No schema changes; this migration is only
-- marked as applied so Prisma Migrate can run subsequent migrations (e.g. add business.place_id).
SELECT 1;
