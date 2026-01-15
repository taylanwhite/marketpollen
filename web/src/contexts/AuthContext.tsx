import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { 
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';

// Extract User type from auth functions
type FirebaseUser = Awaited<ReturnType<typeof createUserWithEmailAndPassword>>['user'];

// User data type (from Firestore)
interface UserData {
  uid: string;
  email: string;
  createdAt: Date;
  role?: 'admin' | 'user';
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
        // Fetch user data from Firestore
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserData({
            ...data,
            createdAt: data.createdAt?.toDate() || new Date()
          } as UserData);
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
    
    // Check for pending invitations
    const { collection, query, where, getDocs, updateDoc } = await import('firebase/firestore');
    const invitesQuery = query(
      collection(db, 'invites'),
      where('email', '==', user.email!.toLowerCase()),
      where('status', '==', 'pending')
    );
    
    const invitesSnapshot = await getDocs(invitesQuery);
    const invites = invitesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Aggregate permissions from all invitations
    const locationPermissions: any[] = [];
    let isGlobalAdmin = false;
    
    for (const invite of invites) {
      const inviteData = invite as any;
      if (inviteData.isGlobalAdmin) {
        isGlobalAdmin = true;
      } else if (inviteData.locationPermissions) {
        // New format: invite has locationPermissions array
        locationPermissions.push(...inviteData.locationPermissions);
      } else if (inviteData.locationId) {
        // Legacy format: single location with canEdit
        locationPermissions.push({
          locationId: inviteData.locationId,
          canEdit: inviteData.canEdit || false
        });
      }
      
      // Mark invite as accepted
      await updateDoc(doc(db, 'invites', invite.id), {
        status: 'accepted'
      });
    }
    
    // Create user document in Firestore with permissions
    const userData = {
      uid: user.uid,
      email: user.email!,
      createdAt: new Date(),
      isGlobalAdmin,
      locationPermissions
    };
    
    await setDoc(doc(db, 'users', user.uid), userData);
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
