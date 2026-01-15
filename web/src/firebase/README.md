# Firebase Setup

Firebase has been initialized in this project. To use it:

## 1. Configure Environment Variables

Create a `.env` file in the `web/` directory with your Firebase configuration:

```env
VITE_FIREBASE_API_KEY=your-api-key-here
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

You can find these values in your [Firebase Console](https://console.firebase.google.com/):
- Go to Project Settings > General > Your apps > Web app

## 2. Use Firebase in Your Components

```typescript
import { auth, db, storage } from './firebase/config';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';

// Example: Authentication
const login = async (email: string, password: string) => {
  await signInWithEmailAndPassword(auth, email, password);
};

// Example: Firestore
const getData = async () => {
  const querySnapshot = await getDocs(collection(db, 'your-collection'));
  // ...
};
```

## Available Services

- **auth**: Firebase Authentication
- **db**: Cloud Firestore
- **storage**: Firebase Storage
