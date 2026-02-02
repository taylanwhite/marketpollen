import { PrismaClient } from '@prisma/client';

// Resolve and sanitize DB URL (Vercel may use different var names or add quotes/whitespace)
let url = process.env.DATABASE_URL ?? process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL ?? '';
url = url.trim().replace(/^["']|["']$/g, '');
if (url) process.env.DATABASE_URL = url;

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

/**
 * Prisma client singleton. Safe for serverless: reuses one connection pool.
 * All queries are parameterized — no raw SQL, protection from injection.
 */
export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
