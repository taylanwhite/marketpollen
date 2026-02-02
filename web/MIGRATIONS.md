# Database (Prisma)

This project uses **Prisma** for the database. No separate migration runner.

## Setup

1. Set `DATABASE_URL` in `.env` (e.g. from Neon dashboard).
2. Generate the client and push the schema to the DB:

   ```bash
   npm run db:generate   # generate Prisma client
   npm run db:push       # apply schema to DB (creates/updates tables)
   ```

3. Optional: open Prisma Studio to inspect data:

   ```bash
   npm run db:studio
   ```

## Schema

- Schema is in `prisma/schema.prisma`.
- All queries go through the Prisma client (parameterized, no raw SQL in app code).
- After changing the schema, run `npm run db:push` (or `prisma migrate dev` if you introduce migrations later).

