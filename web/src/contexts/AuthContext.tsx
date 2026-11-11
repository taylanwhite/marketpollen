import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useUser, useAuth as useClerkAuth } from '@clerk/react';
import { api, setTokenGetter } from '../api/client';
import type { StorePermission } from '../types';

interface UserData {
  uid: string;
  email: string;
  displayName?: string;
  createdAt: Date;
  isGlobalAdmin: boolean;
  storePermissions: StorePermission[];
}

interface AuthContextType {
  userId: string | null;
  userEmail: string | null;
  userData: UserData | null;
  loading: boolean;
  isSignedIn: boolean;
  /** True once the user has accepted the current Terms of Service and Privacy Policy. */
  termsAccepted: boolean;
  acceptTerms: () => Promise<void>;
}

type MeResponse = {
  user: { uid: string; email: string; displayName?: string; createdAt: string; isGlobalAdmin: boolean; termsAccepted?: boolean } | null;
  storePermissions: { storeId: string; canEdit: boolean }[];
  termsVersion?: string;
};

const localAcceptanceKey = (uid: string) => `mp_terms_accepted_${uid}`;

function readLocalAcceptance(uid: string): string | null {
  try { return localStorage.getItem(localAcceptanceKey(uid)); } catch { return null; }
}

function writeLocalAcceptance(uid: string, version: string) {
  try { localStorage.setItem(localAcceptanceKey(uid), version); } catch { /* private mode */ }
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
  const { isSignedIn, userId, getToken } = useClerkAuth();
  const { user } = useUser();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsVersion, setTermsVersion] = useState<string | null>(null);

  useEffect(() => {
    setTokenGetter(() => getToken());
  }, [getToken]);

  useEffect(() => {
    if (isSignedIn === undefined) {
      // Clerk hasn't loaded yet — stay in loading state
      return;
    }

    if (!isSignedIn || !userId) {
      setUserData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    loadUserData();
  }, [isSignedIn, userId]);

  function applyTerms(me: MeResponse) {
    setTermsVersion(me.termsVersion ?? null);
    // Older API without the field: don't lock people out.
    const accepted = me.user?.termsAccepted ?? !me.termsVersion;
    // Offline, /me can come from a cache saved before the user accepted. Trust
    // the copy this device saved at accept time so they aren't stuck on the gate.
    const acceptedHere = !!me.user && !!me.termsVersion
      && readLocalAcceptance(me.user.uid) === me.termsVersion;
    setTermsAccepted(accepted || acceptedHere);
  }

  async function acceptTerms() {
    const result = await api.post<{ termsAccepted: boolean }>('/legal/accept', { version: termsVersion });
    if (result.termsAccepted && userId && termsVersion) writeLocalAcceptance(userId, termsVersion);
    setTermsAccepted(result.termsAccepted);
  }

  async function loadUserData() {
    try {
      const me = await api.get<MeResponse>('/me');
      applyTerms(me);

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
        await api.post('/users/sync', {
          email: user?.primaryEmailAddress?.emailAddress || '',
          displayName: user?.fullName || undefined,
        });
        const me2 = await api.get<MeResponse>('/me');
        applyTerms(me2);
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
    } finally {
      setLoading(false);
    }
  }

  const value: AuthContextType = {
    userId: userId ?? null,
    userEmail: user?.primaryEmailAddress?.emailAddress ?? null,
    userData,
    loading: loading || isSignedIn === undefined,
    isSignedIn: !!isSignedIn,
    termsAccepted,
    acceptTerms,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
