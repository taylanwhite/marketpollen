import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { auth } from '../firebase/config';
import { api } from '../api/client';
import type { StorePermission } from '../types';

type FirebaseUser = Awaited<ReturnType<typeof createUserWithEmailAndPassword>>['user'];

interface UserData {
  uid: string;
  email: string;
  displayName?: string;
  createdAt: Date;
  isGlobalAdmin: boolean;
  storePermissions: StorePermission[];
}

interface AuthContextType {
  currentUser: FirebaseUser | null;
  userData: UserData | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          const me = await api.get<{ user: { uid: string; email: string; displayName?: string; createdAt: string; isGlobalAdmin: boolean }; storePermissions: { storeId: string; canEdit: boolean }[] }>('/me');
          if (me.user) {
            setUserData({
              uid: me.user.uid,
              email: me.user.email,
              displayName: me.user.displayName,
              createdAt: new Date(me.user.createdAt),
              isGlobalAdmin: me.user.isGlobalAdmin,
              storePermissions: me.storePermissions || [],
            });
          } else {
            await api.post('/users/sync', { email: user.email || '', displayName: user.displayName || undefined });
            const me2 = await api.get<{ user: { uid: string; email: string; displayName?: string; createdAt: string; isGlobalAdmin: boolean }; storePermissions: { storeId: string; canEdit: boolean }[] }>('/me');
            if (me2.user) {
              setUserData({
                uid: me2.user.uid,
                email: me2.user.email,
                displayName: me2.user.displayName,
                createdAt: new Date(me2.user.createdAt),
                isGlobalAdmin: me2.user.isGlobalAdmin,
                storePermissions: me2.storePermissions || [],
              });
            } else {
              setUserData(null);
            }
          }
        } catch (err) {
          console.error('Error loading user from API:', err);
          setUserData(null);
        }
      } else {
        setUserData(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  async function signup(email: string, password: string) {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    await api.post('/users/sync', { email: user.email || '', displayName: user.displayName || undefined });
  }

  async function login(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function logout() {
    await signOut(auth);
  }

  const value: AuthContextType = {
    currentUser,
    userData,
    loading,
    login,
    signup,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
