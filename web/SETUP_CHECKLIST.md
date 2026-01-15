# Setup Checklist - Contact Manager

## ✅ Completed
- [x] Firebase configuration file created
- [x] Environment variables configured (.env file)
- [x] All dependencies installed
- [x] Application code complete

## 🔧 Next Steps to Get Running

### 1. Enable Firebase Authentication
**Action Required:**
1. Go to [Firebase Console - Authentication](https://console.firebase.google.com/project/bundtmarketer/authentication)
2. Click "Get started" if you haven't enabled it yet
3. Go to the "Sign-in method" tab
4. Click on "Email/Password"
5. Enable "Email/Password" (toggle ON)
6. Click "Save"

### 2. Create Firestore Database
**Action Required:**
1. Go to [Firebase Console - Firestore](https://console.firebase.google.com/project/bundtmarketer/firestore)
2. Click "Create database"
3. Choose **"Start in test mode"** for development (you'll add security rules next)
4. Select a location (choose closest to your users)
5. Click "Enable"

### 3. Set Up Firestore Security Rules
**Action Required:**
1. In Firestore, go to the "Rules" tab
2. Replace the default rules with these:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only read/write their own user document
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Users can only access businesses they belong to
    match /businesses/{businessId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && 
        (request.resource.data.createdBy == request.auth.uid || 
         get(/databases/$(database)/documents/users/$(request.auth.uid)).data.businessId == businessId);
    }
    
    // Users can only access contacts from their business
    match /contacts/{contactId} {
      allow read, write: if request.auth != null && 
        resource.data.businessId == get(/databases/$(database)/documents/users/$(request.auth.uid)).data.businessId;
    }
  }
}
```

3. Click "Publish"

### 4. Test the Application
**Action Required:**
1. Start the development server:
   ```bash
   cd web
   npm run dev
   ```

2. Open http://localhost:5173 in your browser

3. Test signup:
   - Click "Sign up"
   - Enter your details and a Business ID (e.g., "ACME-001")
   - Create your account

4. Test adding a contact:
   - Click "+ Add Contact"
   - Try voice input or manual entry
   - Save a contact

## 🎯 Quick Links

- **Firebase Console**: https://console.firebase.google.com/project/bundtmarketer
- **Authentication Setup**: https://console.firebase.google.com/project/bundtmarketer/authentication
- **Firestore Setup**: https://console.firebase.google.com/project/bundtmarketer/firestore
- **Firestore Rules**: https://console.firebase.google.com/project/bundtmarketer/firestore/rules

## 🐛 Troubleshooting

### "Missing required Firebase environment variables"
- Make sure `.env` file exists in `web/` directory
- Restart the dev server after creating/updating `.env`

### "Permission denied" errors
- Check that Firestore security rules are published
- Verify you're logged in (check Authentication tab in Firebase Console)

### Voice input not working
- Use Chrome, Edge, or Safari (Web Speech API support)
- Allow microphone permissions in browser
- HTTPS required in production (localhost works for development)

## 📝 Notes

- The app uses Firestore collections: `users`, `businesses`, and `contacts`
- Each user must have a unique Business ID
- Contacts are scoped to the user's Business ID
- Follow-up suggestions are generated automatically based on contact status
