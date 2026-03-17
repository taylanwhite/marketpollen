import { VercelRequest } from '@vercel/node';
import { verifyToken } from '@clerk/backend';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

async function verifyClerkToken(bearerToken: string | undefined): Promise<string | null> {
  if (!bearerToken || !bearerToken.startsWith('Bearer ')) return null;
  const token = bearerToken.slice(7).trim();
  if (!token) return null;
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export async function getAuthUid(req: VercelRequest): Promise<string | null> {
  const authHeader = req.headers.authorization;
  return verifyClerkToken(authHeader);
}

export async function requireAuth(req: VercelRequest): Promise<string> {
  const uid = await getAuthUid(req);
  if (!uid) throw new Error('UNAUTHORIZED');
  return uid;
}
