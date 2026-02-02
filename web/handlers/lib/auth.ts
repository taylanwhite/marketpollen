import { VercelRequest } from '@vercel/node';
import { verifyIdToken } from './firebase-admin.js';

/**
 * Get current user UID from request. Expects Authorization: Bearer <firebase_id_token>.
 * Returns uid or null if missing/invalid.
 */
export async function getAuthUid(req: VercelRequest): Promise<string | null> {
  const authHeader = req.headers.authorization;
  return verifyIdToken(authHeader);
}

/**
 * Require auth: returns uid or throws (caller should return 401).
 */
export async function requireAuth(req: VercelRequest): Promise<string> {
  const uid = await getAuthUid(req);
  if (!uid) throw new Error('UNAUTHORIZED');
  return uid;
}
