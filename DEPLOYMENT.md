# Deployment Guide

## Prerequisites

1. Firebase CLI installed: `npm install -g firebase-tools`
2. Logged into Firebase: `firebase login`
3. Node.js 20+ installed

## Setup Steps

### 1. Install Dependencies

```bash
# Install web dependencies
cd web
npm install
```

### 2. Configure Environment Variables

#### For Local Development (web/.env):
```env
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
VITE_FIREBASE_MEASUREMENT_ID=your-measurement-id

# NOTE: These should NOT have VITE_ prefix - they're server-side only
OPENAI_API_KEY=your-openai-api-key
RESEND_API_KEY=your-resend-api-key
# RESEND_FROM_EMAIL is optional - defaults to Resend's test domain (onboarding@resend.dev)
# RESEND_FROM_EMAIL=Bundt Marketer <noreply@yourdomain.com>
VITE_APP_URL=http://localhost:5173
```

#### For Vercel Serverless Functions (Server-side):
Set these environment variables in Vercel:

1. Go to your Vercel project dashboard
2. Navigate to Settings → Environment Variables
3. Add these variables (select all environments: Production, Preview, Development):
   - **Name:** `OPENAI_API_KEY` - **Value:** Your OpenAI API key
   - **Name:** `RESEND_API_KEY` - **Value:** Your Resend API key (get from [resend.com](https://resend.com))
   - **Name:** `RESEND_FROM_EMAIL` - **Value:** `Bundt Marketer <onboarding@resend.dev>` (optional - this is Resend's default test domain, no verification needed)
   - **Name:** `VITE_APP_URL` - **Value:** Your production URL (e.g., `https://your-app.vercel.app`)
4. Save

**Note:** `RESEND_FROM_EMAIL` is optional. If not set, it defaults to `Bundt Marketer <onboarding@resend.dev>`, which works immediately without domain verification. For production, you can add your own domain later in Resend's dashboard.

**To get a Resend API key:**
1. Sign up at [resend.com](https://resend.com) (free tier: 3,000 emails/month)
2. Go to API Keys and create a new key
3. Add it to Vercel environment variables

The API routes at `/api/chat-completion` and `/api/send-invite-email` will automatically use these environment variables.

### 3. Build the Web App

```bash
cd web
npm install  # Install dependencies including @vercel/node
npm run build
```

### 4. Deploy to Vercel

```bash
# From web directory
vercel deploy --prod
```

Or connect your GitHub repository to Vercel for automatic deployments:
1. Go to [vercel.com](https://vercel.com)
2. Import your GitHub repository
3. Set root directory to `web`
4. Add environment variables (see above)
5. Deploy

## Environment Variables in Deployment Platforms

### Vercel
1. Go to Project Settings → Environment Variables
2. Add all `VITE_*` variables (Firebase config - these are public and safe to expose)
3. Add `OPENAI_API_KEY` (server-side only, used by `/api/chat-completion` function)
   - **Important:** This is a secret and will NOT be exposed to the client

## Security Notes

✅ **Safe to expose (client-side):**
- All `VITE_FIREBASE_*` variables (public Firebase config)

❌ **Never expose (server-side only):**
- `OPENAI_API_KEY` - Only used in Vercel serverless functions
- `RESEND_API_KEY` - Only used in Vercel serverless functions

## Troubleshooting

### "Missing required Firebase environment variables"
- Make sure all `VITE_FIREBASE_*` variables are set in your deployment platform

### "AI completion failed"
- Verify Vercel function is deployed: Check `/api/chat-completion` endpoint
- Check OpenAI API key is set in Vercel environment variables
- Ensure user is authenticated when calling AI features
- Check Vercel function logs for detailed error messages
