# Database (Prisma)

This project uses **Prisma** with **migrations** for production and optional `db push` for quick local sync.

## Setup

1. Set `DATABASE_URL` in `.env` (e.g. from Neon dashboard).
2. Generate the client and apply migrations:

   ```bash
   npm run db:generate   # generate Prisma client
   npm run db:migrate    # apply pending migrations (production)
   ```

3. Optional: open Prisma Studio to inspect data:

   ```bash
   npm run db:studio
   ```

## Migration workflow

- **Local development** (after changing `prisma/schema.prisma`):

  ```bash
  npm run db:migrate:dev -- --name describe_your_change
  ```

  That creates a new migration under `prisma/migrations/` and applies it to the DB pointed at by `DATABASE_URL`.

- **Production** (e.g. Vercel, CI, or manual):

  ```bash
  npm run db:migrate
  ```

  That runs `prisma migrate deploy`: applies all pending migrations without creating new ones.

- **One-off schema sync without a migration** (prototyping only):

  ```bash
  npm run db:push
  ```

  Use for quick local experiments; prefer migrations for anything that touches production.

## Schema

- Schema is in `prisma/schema.prisma`.
- Migrations are in `prisma/migrations/` (versioned SQL).
- All app queries use the Prisma client (parameterized; no raw SQL in app code).

## Baselining an existing production DB (P3005)

If production was set up with `db push` (or manual SQL) and has no `_prisma_migrations` table, Prisma will error: **P3005 – database schema is not empty**. Baseline once, then deploys can run migrations.

**One-time baseline (run locally with production `DATABASE_URL`):**

```bash
cd web
# Use production DATABASE_URL in .env (or: export DATABASE_URL="postgresql://...")
npx prisma migrate resolve --applied 20250201000000_baseline
```

That creates `_prisma_migrations` and marks the baseline as applied **without** running any SQL. After that, `npm run db:migrate` (and Vercel’s build) will run pending migrations (e.g. `20250202120000_add_business_place_id_and_opportunities`).

Then push; Vercel build will run `db:migrate` and apply the real migration.

---

## Fixing production (e.g. missing `businesses.place_id`)

1. If you hit P3005, do the **baseline** step above first.
2. With `DATABASE_URL` set to the **production** DB, run:

   ```bash
   npm run db:migrate
   ```

3. Redeploy the app so it uses the updated schema.

**If you already ran `db push`** and the `opportunities` table (and `businesses.place_id`) already exist, mark that migration as applied so Prisma doesn’t run it again:

```bash
npx prisma migrate resolve --applied 20250202120000_add_business_place_id_and_opportunities
```

Then run `npm run db:migrate` (or push) as usual for future migrations.

---

## Recovering from a failed migration (P3018)

If a migration failed (e.g. **relation "opportunities" already exists**) because the schema was already applied via `db push`, clear the failure and mark the migration as applied so Prisma stops trying to run it.

**Run against production (with production `DATABASE_URL`):**

```bash
cd web

# 1. Mark the failed migration as rolled back (clears the failure)
npx prisma migrate resolve --rolled-back 20250202120000_add_business_place_id_and_opportunities

# 2. Mark it as applied (schema already exists; Prisma will not run it again)
npx prisma migrate resolve --applied 20250202120000_add_business_place_id_and_opportunities
```

After that, `npm run db:migrate` (and Vercel builds) will succeed and future migrations will run as normal.
