/**
 * Local dev only: runs compiled dist-api/*.js on port 3001 so Vite's proxy has a target.
 * Start with: npm run build:api && node api-dev-server.js
 * Then run Vite in another terminal; Vite proxies /api -> 3001.
 */

import express from 'express';
import cors from 'cors';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(__dirname, 'dist-api');

function resolveRoute(pathname, queryFromUrl = {}) {
  const path = pathname.replace(/^\/api\/?/, '') || '';
  const segments = path ? path.split('/').filter(Boolean) : [];
  const query = { ...queryFromUrl };
  if (segments.length === 0) return null;
  if (segments[0] === 'me') return { file: join(API_DIR, 'me.js'), query };
  if (segments[0] === 'users' && segments[1] === 'sync') return { file: join(API_DIR, 'users', 'sync.js'), query };
  if (segments[0] === 'users' && segments.length === 1) return { file: join(API_DIR, 'users', 'index.js'), query };
  if (segments[0] === 'users' && segments.length === 2) { query.uid = segments[1]; return { file: join(API_DIR, 'users', '[uid].js'), query }; }
  if (segments[0] === 'stores' && segments.length === 1) return { file: join(API_DIR, 'stores.js'), query };
  if (segments[0] === 'stores' && segments.length === 2) { query.id = segments[1]; return { file: join(API_DIR, 'stores', '[id].js'), query }; }
  if (segments[0] === 'contacts' && segments.length === 1) return { file: join(API_DIR, 'contacts.js'), query };
  if (segments[0] === 'contacts' && segments.length === 2) { query.id = segments[1]; return { file: join(API_DIR, 'contacts', '[id].js'), query }; }
  if (segments[0] === 'businesses' && segments.length === 1) return { file: join(API_DIR, 'businesses.js'), query };
  if (segments[0] === 'businesses' && segments.length === 2) { query.id = segments[1]; return { file: join(API_DIR, 'businesses', '[id].js'), query }; }
  if (segments[0] === 'opportunities' && segments.length === 1) return { file: join(API_DIR, 'opportunities.js'), query };
  if (segments[0] === 'opportunities' && segments.length === 3 && segments[2] === 'convert') { query.id = segments[1]; return { file: join(API_DIR, 'opportunities', '[id]', 'convert.js'), query }; }
  if (segments[0] === 'opportunities' && segments.length === 2) { query.id = segments[1]; return { file: join(API_DIR, 'opportunities', '[id].js'), query }; }
  if (segments[0] === 'calendar-events' && segments.length === 1) return { file: join(API_DIR, 'calendar-events.js'), query };
  if (segments[0] === 'calendar-events' && segments.length === 2) { query.id = segments[1]; return { file: join(API_DIR, 'calendar-events', '[id].js'), query }; }
  if (segments[0] === 'invites' && segments.length === 1) return { file: join(API_DIR, 'invites.js'), query };
  if (segments[0] === 'invites' && segments.length === 2) { query.id = segments[1]; return { file: join(API_DIR, 'invites', '[id].js'), query }; }
  if (segments[0] === 'chat-completion') return { file: join(API_DIR, 'chat-completion.js'), query };
  if (segments[0] === 'send-invite-email') return { file: join(API_DIR, 'send-invite-email.js'), query };
  if (segments[0] === 'places-autocomplete') return { file: join(API_DIR, 'places-autocomplete.js'), query };
  if (segments[0] === 'places-details') return { file: join(API_DIR, 'places-details.js'), query };
  if (segments[0] === 'places-nearby') return { file: join(API_DIR, 'places-nearby.js'), query };
  if (segments[0] === 'create-contact-from-call') return { file: join(API_DIR, 'create-contact-from-call.js'), query };
  if (segments[0] === 'get-calendar-events') return { file: join(API_DIR, 'get-calendar-events.js'), query };
  return null;
}

function toVercelReq(expressReq, pathQuery) {
  return {
    method: expressReq.method,
    url: expressReq.originalUrl || expressReq.url,
    headers: expressReq.headers,
    query: { ...expressReq.query, ...pathQuery },
    body: expressReq.body,
  };
}

function toVercelRes(expressRes) {
  return {
    _status: 200,
    status(code) { this._status = code; return this; },
    json(data) { expressRes.status(this._status).json(data); return this; },
    setHeader(n, v) { expressRes.setHeader(n, v); return this; },
    end(b) { if (this._status) expressRes.status(this._status); expressRes.end(b); return this; },
  };
}

const app = express();
app.use(cors());
app.use(express.json());

app.all('/api/*', async (req, res) => {
  const pathname = req.path || req.url?.split('?')[0] || '';
  const resolved = resolveRoute(pathname, req.query || {});
  if (!resolved) return res.status(404).json({ error: 'Not found', path: pathname });
  try {
    const mod = await import(pathToFileURL(resolved.file).href);
    const handler = mod.default;
    if (typeof handler !== 'function') return res.status(500).json({ error: 'Invalid handler' });
    const vercelReq = toVercelReq(req, resolved.query);
    const vercelRes = toVercelRes(res);
    await handler(vercelReq, vercelRes);
  } catch (err) {
    console.error(`API ${pathname}:`, err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`API dev server (dist-api/*.js) on http://localhost:${PORT}`);
  console.log('Start Vite or vercel dev in another terminal; they proxy /api here.');
});
