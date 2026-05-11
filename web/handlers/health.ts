import { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Reachability probe endpoint.
 *
 * Intentionally minimal: no auth, no database, no third-party calls. The
 * client polls this from the offline-detection state machine to distinguish
 * "OS says we have a connection" (`navigator.onLine`) from "we can actually
 * reach our backend" (the only signal that matters for marketers in the
 * field on flaky cellular, captive-portal Wi-Fi, or downed-API scenarios).
 *
 * Keep it cheap. Roughly ~80 bytes on the wire and zero compute. No-cache
 * headers are critical: an intermediary cache returning a 200 from yesterday
 * would defeat the purpose of the probe.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res.status(200).json({ ok: true, ts: Date.now() });
}
