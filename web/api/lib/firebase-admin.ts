import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// api/lib is two levels under project root (web)
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

let adminApp: App | null = null;

export function getAdminApp(): App {
  if (adminApp) return adminApp;
  if (getApps().length) {
    adminApp = getApps()[0] as App;
    return adminApp;
  }
  let serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson || serviceAccountJson.length < 100) {
    try {
      const envPath = join(__dirname, '..', '..', '.env');
      if (existsSync(envPath)) {
        const envContent = readFileSync(envPath, 'utf-8');
        const match = envContent.match(/FIREBASE_SERVICE_ACCOUNT\s*=\s*['"]?(\{[\s\S]*?\})['"]?/);
        if (match?.[1]) serviceAccountJson = match[1].replace(/\\n/g, '\n').trim();
      }
    } catch (_) {}
  }
  if (serviceAccountJson && serviceAccountJson.length > 50) {
    try {
      let cleaned = serviceAccountJson.trim();
      if ((cleaned.startsWith("'") && cleaned.endsWith("'")) || (cleaned.startsWith('"') && cleaned.endsWith('"')))
        cleaned = cleaned.slice(1, -1);
      const serviceAccount = JSON.parse(cleaned);
      if (serviceAccount.project_id && serviceAccount.private_key && serviceAccount.client_email) {
        adminApp = initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
        return adminApp;
      }
    } catch (_) {}
  }
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  if (projectId) {
    adminApp = initializeApp({ projectId });
    return adminApp;
  }
  adminApp = initializeApp();
  return adminApp;
}

/** Verify Firebase ID token from Authorization: Bearer <token>. Returns uid or null. */
export async function verifyIdToken(bearerToken: string | undefined): Promise<string | null> {
  if (!bearerToken || !bearerToken.startsWith('Bearer ')) return null;
  const token = bearerToken.slice(7).trim();
  if (!token) return null;
  try {
    const app = getAdminApp();
    const decoded = await getAuth(app).verifyIdToken(token);
    return decoded.uid ?? null;
  } catch {
    return null;
  }
}
