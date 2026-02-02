# Database schema

This project uses **Prisma** as the single source of truth. All queries are parameterized through the Prisma client (no raw SQL in app code).

- **Schema:** `prisma/schema.prisma`
- **Apply to DB:** `npm run db:push` (from `web/`)
- **Reference SQL:** `web/schema/neon-schema.sql` is optional human-readable reference only; do not run it to apply schema. Use Prisma.

See **[MIGRATIONS.md](../MIGRATIONS.md)** for setup and commands.
