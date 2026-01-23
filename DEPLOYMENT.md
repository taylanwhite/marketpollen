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
# Or: VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
# (Use the exact value from Firebase Console, without gs:// prefix)
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
VITE_FIREBASE_MEASUREMENT_ID=your-measurement-id

# NOTE: These should NOT have VITE_ prefix - they're server-side only
OPENAI_API_KEY=your-openai-api-key
RESEND_API_KEY=your-resend-api-key
# RESEND_FROM_EMAIL is optional - defaults to Resend's test domain (onboarding@resend.dev)
# RESEND_FROM_EMAIL=Bundt Marketer <noreply@yourdomain.com>
VITE_APP_URL=http://localhost:5173

# Google Places API (for address autocomplete) - Server-side only, NOT VITE_ prefix
GOOGLE_PLACES_API_KEY=your-google-places-api-key
```

#### For Vercel Serverless Functions (Server-side):
Set these environment variables in Vercel:

1. Go to your Vercel project dashboard
2. Navigate to Settings → Environment Variables
3. Add these variables (select all environments: Production, Preview, Development):
   - **Name:** `OPENAI_API_KEY` - **Value:** Your OpenAI API key
   - **Name:** `RESEND_API_KEY` - **Value:** Your Resend API key (get from [resend.com](https://resend.com))
   - **Name:** `RESEND_FROM_EMAIL` - **Value:** `Bundt Marketer <onboarding@resend.dev>` (optional - this is Resend's default test domain, no verification needed)
   - **Name:** `GOOGLE_PLACES_API_KEY` - **Value:** Your Google Places API key (get from [Google Cloud Console](https://console.cloud.google.com/))
   - **Name:** `VITE_APP_URL` - **Value:** Your production URL (e.g., `https://your-app.vercel.app`)
   - **Name:** `FIREBASE_PROJECT_ID` - **Value:** Your Firebase project ID (same as VITE_FIREBASE_PROJECT_ID but without VITE_ prefix for server-side use)
   - **Name:** `VOICE_API_KEY` or `AI_PHONE_API_KEY` - **Value:** (Optional) A secret API key for AI phone system authentication (see [API_KEY_SETUP.md](./API_KEY_SETUP.md) for how to generate)
   - **Name:** `FIREBASE_SERVICE_ACCOUNT` - **Value:** (Optional) JSON string of Firebase service account credentials for Admin SDK (alternative to default credentials)
4. Save

**Note:** `RESEND_FROM_EMAIL` is optional. If not set, it defaults to `Bundt Marketer <onboarding@resend.dev>`, which works immediately without domain verification. For production, you can add your own domain later in Resend's dashboard.

**To get a Resend API key:**
1. Sign up at [resend.com](https://resend.com) (free tier: 3,000 emails/month)
2. Go to API Keys and create a new key
3. Add it to Vercel environment variables

The API routes at `/api/chat-completion` and `/api/send-invite-email` will automatically use these environment variables.

### 3. Configure Firebase Storage Security Rules

**Action Required:**
1. Go to [Firebase Console - Storage](https://console.firebase.google.com/project/bundtmarketer/storage)
2. If Storage is not enabled:
   - Click "Get started"
   - Choose "Start in test mode"
   - Select a location (same as your Firestore location)
   - Click "Enable"
3. Go to the "Rules" tab
4. Replace the existing rules with the rules from `FIREBASE_STORAGE_RULES.txt`
5. Click "Publish"

This allows authenticated users to upload and download files for contacts.

### 4. Build the Web App

```bash
cd web
npm install  # Install dependencies including @vercel/node
npm run build
```

### 5. Deploy to Vercel

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
- `GOOGLE_PLACES_API_KEY` - Only used in Vercel serverless functions

## AI Phone System Integration

The app includes endpoints for AI phone systems to create contacts automatically from call transcripts and look up calendar events.

**📋 See [API_PAYLOADS.md](./API_PAYLOADS.md) for complete request/response examples.**

### Create Contact from Call

**Endpoint:** `POST /api/create-contact-from-call`

**Authentication:**
- Bearer token (Firebase ID token), OR
- `apiKey` in request body (must match `AI_PHONE_API_KEY` environment variable)

**Request Body:**
```json
{
  "notes": "Call transcript/notes from AI phone call",
  "storeName": "Downtown Location",
  "businessName": "ABC Company",
  "apiKey": "optional-api-key-for-auth"
}
```

**Note:** `businessName` is required - this is used by internal teams in the field to quickly create opportunities.

**Note:** The system uses AI to look up stores and businesses by name, so the AI phone system doesn't need to know IDs. It will:
- Look up the store by name (with fuzzy matching)
- Look up existing businesses by name within the store
- Create new businesses if they don't exist

**📖 See [AI_EXTRACTION_GUIDE.md](./AI_EXTRACTION_GUIDE.md) for detailed information on how the AI phone system should extract `notes`, `storeName`, and `businessName` from calls.**

**Response:**
```json
{
  "success": true,
  "contactId": "contact-id",
  "contact": { ... },
  "message": "Contact created successfully from call notes"
}
```

**What it does:**
1. Extracts contact info (name, email, phone, etc.) from notes using AI
2. Extracts donation information if products were given away
3. Creates or links to a business
4. Creates the contact with all extracted information
5. Generates AI follow-up suggestion (date, method, priority)
6. Creates calendar events for the reachout and follow-up

**Environment Variables Needed:**
- `OPENAI_API_KEY` - For AI extraction and follow-up generation
- `FIREBASE_PROJECT_ID` - For Firebase Admin SDK (or `FIREBASE_SERVICE_ACCOUNT` JSON)
- `VOICE_API_KEY` or `AI_PHONE_API_KEY` - (Optional) Secret key for API key authentication (see [API_KEY_SETUP.md](./API_KEY_SETUP.md) for how to generate)

---

**Endpoint:** `POST /api/get-calendar-events`

**Authentication:**
- Bearer token (Firebase ID token), OR
- `apiKey` in request body (must match `AI_PHONE_API_KEY` environment variable)

**Request Body:**
```json
{
  "date": "2026-01-19",
  "storeName": "Downtown Location",
  "apiKey": "optional-api-key-for-auth"
}
```

**Note:** The system uses AI to look up stores by name, so the AI phone system doesn't need to know store IDs. If `storeName` is not provided, returns events for all stores.

**Response:**
```json
{
  "success": true,
  "date": "2026-01-19",
  "storeId": "store-id-or-null",
  "events": [
    {
      "id": "event-id",
      "storeId": "store-id",
      "title": "Follow-up: John Smith",
      "description": "Follow up about sample tray",
      "date": "2026-01-19",
      "startTime": "14:00",
      "endTime": "15:00",
      "type": "followup",
      "contactId": "contact-id",
      "businessId": "business-id",
      "priority": "high",
      "status": "scheduled",
      "location": null,
      "notes": null,
      "createdBy": "user-id",
      "createdAt": "2026-01-15T10:00:00.000Z",
      "contact": {
        "id": "contact-id",
        "firstName": "John",
        "lastName": "Smith",
        "email": "john@example.com",
        "phone": "(555) 123-4567"
      },
      "business": {
        "id": "business-id",
        "name": "ABC Company"
      }
    }
  ],
  "count": 1
}
```

**What it does:**
1. Fetches all calendar events for the specified date
2. Optionally filters by store ID
3. Loads related contact and business information
4. Returns events sorted by start time (or creation time if no start time)

**Use Cases:**
- Check what events are scheduled for a specific day before making calls
- Understand context about existing follow-ups or meetings
- Avoid scheduling conflicts when creating new events

## Troubleshooting

### "Missing required Firebase environment variables"
- Make sure all `VITE_FIREBASE_*` variables are set in your deployment platform

### "AI completion failed"
- Verify Vercel function is deployed: Check `/api/chat-completion` endpoint
- Check OpenAI API key is set in Vercel environment variables
- Ensure user is authenticated when calling AI features
- Check Vercel function logs for detailed error messages

### "Firebase Admin initialization error"
- Set `FIREBASE_PROJECT_ID` environment variable in Vercel
- Or provide `FIREBASE_SERVICE_ACCOUNT` as a JSON string with service account credentials
