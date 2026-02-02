# Firebase Setup

Firebase has been initialized in this project. To use it:

## 1. Configure Environment Variables

Create a `.env` file in the `web/` directory with your Firebase configuration:

```env
VITE_FIREBASE_API_KEY=your-api-key-here
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```
(Firebase Storage has been removed; use Neon/Postgres + external storage if needed.)

You can find these values in your [Firebase Console](https://console.firebase.google.com/):
- Go to Project Settings > General > Your apps > Web app

## 2. Use Firebase in Your Components

Firebase is used for **Authentication only**. Data is stored in **Neon (Postgres)** via the `/api` routes.

```typescript
import { auth } from './firebase/config';
import { signInWithEmailAndPassword } from 'firebase/auth';

const login = async (email: string, password: string) => {
  await signInWithEmailAndPassword(auth, email, password);
};
```

Use the `api` client in `src/api/client.ts` for all data (stores, businesses, contacts, calendar events, etc.).
