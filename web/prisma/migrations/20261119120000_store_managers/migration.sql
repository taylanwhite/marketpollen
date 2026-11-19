-- Store managers: plan and assign stops for everyone in a store without being an organization admin
ALTER TABLE "store_permissions" ADD COLUMN IF NOT EXISTS "can_manage_plans" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invites" ADD COLUMN IF NOT EXISTS "can_manage_plans" BOOLEAN NOT NULL DEFAULT false;
