# Local development

You need **both** the app (Vite) and the API (compiled `api/*.js` on port 3001). Vite proxies `/api` to 3001.

## Option A: One command, open localhost:5173 (recommended)

```bash
npm run dev:all
```

Then open **http://localhost:5173**. This runs the API server (3001) and Vite (5173) together. No Vercel CLI needed.

## Option B: One command, open localhost:3000 (Vercel dev)

```bash
npm run dev:vercel
```

Then open **http://localhost:3000**. Runs API server (3001) and Vercel dev (3000). Requires [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`).

## Option C: Two terminals (Vite on 5173)

**Terminal 1:** Build API and start API server
```bash
npm run build:api
npm run dev:api
```

**Terminal 2:** Start Vite
```bash
npm run dev
```

Then open **http://localhost:5173**.

---

**Requires:** `.env` with `DATABASE_URL` and Firebase env.

**“No Access Granted” + ERR_CONNECTION_REFUSED for `/api/me`?**  
The API server isn’t running. Use one of the options above so the API runs on port 3001 (e.g. `npm run dev:all` or run `npm run dev:api` in another terminal before `npm run dev`).

**Vite-only (no API):** `npm run dev` alone runs Vite at http://localhost:5173. `/api` will fail with connection refused unless you also run the API (e.g. `npm run dev:api` or `npm run dev:all`).
