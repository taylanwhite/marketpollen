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

## Fixing production (e.g. missing `businesses.place_id`)

1. Ensure the migration that adds the column (and any new tables) exists under `prisma/migrations/`.
2. With `DATABASE_URL` set to the **production** DB, run:

   ```bash
   npm run db:migrate
   ```

3. Redeploy the app so it uses the updated schema.

npm**If you already ran `db push`** and the `opportunities` table (or `businesses.place_id`) already exists, mark this migration as applied without running it:

```bash
npx prisma migrate resolve --applied 20250202120000_add_business_place_id_and_opportunities
```

Then run `npm run db:migrate` as usual for future migrations.
