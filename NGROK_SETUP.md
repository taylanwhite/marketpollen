# Ngrok Setup for Testing API Endpoints

This guide explains how to use ngrok to expose your local API server for testing with external services (like AI phone systems).

## Prerequisites

- ngrok installed (already installed at `/opt/homebrew/bin/ngrok`)
- Local API server running on port 3001

## Quick Start

### Option 1: Using Vercel Dev (Recommended for new endpoints)

The new API endpoints (`create-contact-from-call` and `get-calendar-events`) are TypeScript serverless functions that require `vercel dev`:

1. **Start Vercel dev server:**
   ```bash
   cd web
   npm run dev:vercel
   ```
   This starts the server on `http://localhost:3000` (default Vercel port)

2. **In a new terminal, start ngrok:**
   ```bash
   cd web
   npm run dev:ngrok:vercel
   ```
   This runs `ngrok http 3000` to tunnel to the Vercel dev server

3. **Copy the ngrok URL:**
   - ngrok will display a forwarding URL like: `https://abc123.ngrok-free.app`
   - Use this URL to access your API endpoints

### Option 2: Using local API server (for older endpoints only)

For endpoints that don't require TypeScript (chat-completion, send-invite-email, places):

1. **Start the local API server:**
   ```bash
   cd web
   npm run dev:api
   ```
   This starts the server on `http://localhost:3001`

2. **In a new terminal, start ngrok:**
   ```bash
   cd web
   npm run dev:ngrok
   ```

### Option 2: Using ngrok directly

```bash
ngrok http 3001
```

## Testing Your Endpoints

Once ngrok is running, you'll see output like:

```
Forwarding   https://abc123.ngrok-free.app -> http://localhost:3001
```

Use the ngrok URL to test your API endpoints:

### Create Contact from Call
```bash
POST https://abc123.ngrok-free.app/api/create-contact-from-call
```

### Get Calendar Events
```bash
POST https://abc123.ngrok-free.app/api/get-calendar-events
```

## Example cURL Test

```bash
curl -X POST https://abc123.ngrok-free.app/api/create-contact-from-call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "notes": "Called John Smith at ABC Company. Gave them a sample tray.",
    "storeName": "Downtown Location",
    "businessName": "ABC Company",
    "apiKey": "your-secret-api-key"
  }'
```

## Important Notes

1. **Free ngrok URLs change each time** - The URL will be different each time you restart ngrok (unless you have a paid plan with a static domain)

2. **Update your AI phone system** - You'll need to update the webhook URL in your AI phone system configuration each time ngrok restarts

3. **Keep both running** - Make sure both the local API server (`npm run dev:api`) and ngrok are running simultaneously

4. **Check ngrok dashboard** - Visit `http://localhost:4040` to see request logs and inspect traffic

5. **Authentication** - Make sure your `AI_PHONE_API_KEY` is set in your `.env` file if using API key authentication

## Troubleshooting

### "Tunnel not found"
- For Vercel dev: Make sure `vercel dev` is running on port 3000
- For local API: Make sure the local API server is running on port 3001
- Check that ngrok is pointing to the correct port: `ngrok http 3000` (Vercel) or `ngrok http 3001` (local)

### "Connection refused"
- Verify the API server is running: `curl http://localhost:3001/api/chat-completion`
- Check that port 3001 is not blocked by firewall

### "ngrok: command not found"
- Install ngrok: `brew install ngrok` (on macOS)
- Or download from: https://ngrok.com/download

## Production Alternative

For production, you'll deploy to Vercel and use the production URL instead of ngrok. Ngrok is only for local development and testing.
