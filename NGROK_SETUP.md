# Ngrok Setup for Testing API Endpoints

Use ngrok to expose your local Vercel dev server for testing with external services (e.g. AI phone systems).

## Prerequisites

- ngrok installed (`brew install ngrok` or [ngrok.com/download](https://ngrok.com/download))
- Vercel dev server running on port 3000

## Quick Start

1. **Start Vercel dev server:**
   ```bash
   cd web
   npm run dev:vercel
   ```
   Server runs at http://localhost:3000.

2. **In another terminal, start ngrok:**
   ```bash
   cd web
   npm run dev:ngrok
   ```
   This runs `ngrok http 3000`.

3. **Use the ngrok URL** (e.g. `https://abc123.ngrok-free.app`) to hit your API:
   - `POST https://your-url.ngrok-free.app/api/create-contact-from-call`
   - `POST https://your-url.ngrok-free.app/api/get-calendar-events`
   - etc.

## Notes

- **Free ngrok URLs change each time** you restart ngrok (unless you have a paid plan).
- **Keep both running** — Vercel dev and ngrok must run at the same time.
- **Check traffic** at http://localhost:4040 (ngrok dashboard).

## Troubleshooting

- **Connection refused:** Ensure `npm run dev:vercel` is running on port 3000 before starting ngrok.
- **ngrok not found:** Install with `brew install ngrok` (macOS) or from [ngrok.com/download](https://ngrok.com/download).
