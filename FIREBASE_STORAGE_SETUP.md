# Firebase Storage Setup Guide

## Error: 404 (Not Found) or "storage/unknown"

This error means Firebase Storage is **not enabled** for your project.

## Quick Fix:

### Step 1: Enable Firebase Storage

1. Go to [Firebase Console - Storage](https://console.firebase.google.com/project/bundtmarketer/storage)
2. If you see "Get started" button:
   - Click **"Get started"**
   - Choose **"Start in test mode"** (we'll add proper rules next)
   - Select a location (same as your Firestore location, e.g., `us-central1`)
   - Click **"Enable"**
3. Wait for Storage to initialize (may take a minute)

### Step 2: Verify Storage Bucket Name

1. After Storage is enabled, go to **Project Settings** → **General** tab
2. Scroll down to **Your apps** section
3. Find your web app and check the `storageBucket` value
4. It should look like: `bundtmarketer.appspot.com` or `bundtmarketer.firebasestorage.app`
5. Make sure your `.env` file has the correct value (without the `gs://` prefix):
   ```env
   VITE_FIREBASE_STORAGE_BUCKET=bundtmarketer.firebasestorage.app
   ```
   **Important:** Use just the bucket name (e.g., `bundtmarketer.firebasestorage.app`), NOT the `gs://` prefix format

### Step 3: Configure Storage Security Rules

1. In Firebase Console, go to **Storage** → **Rules** tab
2. Copy the rules from `FIREBASE_STORAGE_RULES.txt`
3. Paste and click **"Publish"**

### Step 4: Restart Your Dev Server

After enabling Storage and updating your `.env` file:
```bash
# Stop your dev server (Ctrl+C)
# Then restart it
npm run dev
```

## Verify It's Working

1. Try uploading a file in the app
2. Check Firebase Console → Storage → Files tab
3. You should see files in `contacts/{contactId}/files/` folder

## Common Issues

### "Storage bucket not found"
- Make sure Storage is enabled (Step 1)
- Verify the bucket name in `.env` matches Firebase Console

### "Permission denied"
- Make sure Storage security rules are published (Step 3)
- Check that you're logged in to the app

### "CORS error"
- This usually means Storage rules aren't configured
- Make sure you've published the rules from `FIREBASE_STORAGE_RULES.txt`
