# URGENT: Fix Permission Errors

## Step 1: Create Firestore Database (if not done)
1. Go to: https://console.firebase.google.com/project/bundtmarketer/firestore
2. Click **"Create database"**
3. Choose **"Start in test mode"** (we'll add proper rules after)
4. Select a location (us-central1 is fine)
5. Click **"Enable"**

## Step 2: Apply Security Rules
1. Once database is created, go to the **"Rules"** tab
2. Replace everything with this:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

3. Click **"Publish"**

## Step 3: Test
- Go back to your app
- Try creating a contact
- Should work now!

## Step 4: Check Authentication
Open browser console and run:
```javascript
firebase.auth().currentUser
```
Should show your user info. If null, you're not logged in.
