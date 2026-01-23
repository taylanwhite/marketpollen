import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from './AuthContext';
import { StorePermission, Store } from '../types';

interface UserPermissions {
  isGlobalAdmin: boolean;
  storePermissions: StorePermission[];
  currentStoreId: string | null;
}

interface PermissionContextType {
  permissions: UserPermissions;
  setCurrentStore: (storeId: string) => void;
  canView: (storeId?: string) => boolean;
  canEdit: (storeId?: string) => boolean;
  isAdmin: () => boolean;
  hasAnyAccess: () => boolean;
  loading: boolean;
}

const PermissionContext = createContext<PermissionContextType | undefined>(undefined);

export function usePermissions() {
  const context = useContext(PermissionContext);
  if (!context) {
    throw new Error('usePermissions must be used within a PermissionProvider');
  }
  return context;
}

interface PermissionProviderProps {
  children: ReactNode;
}

export function PermissionProvider({ children }: PermissionProviderProps) {
  const { currentUser } = useAuth();
  
  // Try to load saved store from localStorage
  const savedStoreId = typeof window !== 'undefined' 
    ? localStorage.getItem('selectedStoreId')
    : null;
  
  const [permissions, setPermissions] = useState<UserPermissions>({
    isGlobalAdmin: false,
    storePermissions: [],
    currentStoreId: savedStoreId
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setPermissions({
        isGlobalAdmin: false,
        storePermissions: [],
        currentStoreId: null
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    loadUserPermissions();
  }, [currentUser]);

  const loadUserPermissions = async () => {
    if (!currentUser) return;

    // Preserve current store from state during reload to prevent flicker
    const previousStoreId = permissions.currentStoreId 
      || localStorage.getItem('selectedStoreId');

    try {
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const storePerms = (userData.storePermissions || []) as StorePermission[];
        
        // Normalize store permissions format
        const migratedPerms = storePerms.map(perm => ({
          storeId: perm.storeId,
          canEdit: perm.canEdit
        })).filter(perm => perm.storeId); // Filter out invalid entries
        
        // Use saved store from localStorage, or preserve previous if available
        const savedStoreId = localStorage.getItem('selectedStoreId') || previousStoreId;
        let currentStoreId = savedStoreId;
        
        // Verify saved store is still valid
        if (savedStoreId && !userData.isGlobalAdmin) {
          const hasAccess = migratedPerms.some(p => p.storeId === savedStoreId);
          if (!hasAccess) {
            // User lost access to saved store - clear it
            currentStoreId = null;
            localStorage.removeItem('selectedStoreId');
          }
        }
        
        // Auto-select first available store if none is selected and user has access
        if (!currentStoreId) {
          if (userData.isGlobalAdmin) {
            // For global admins, load stores and auto-select first one if only one exists
            try {
              const storesSnapshot = await getDocs(collection(db, 'stores'));
              const stores: Store[] = [];
              storesSnapshot.forEach((doc) => {
                stores.push({ id: doc.id, ...doc.data() } as Store);
              });
              stores.sort((a, b) => a.name.localeCompare(b.name));
              
              if (stores.length === 1) {
                // Auto-select if only one store exists
                currentStoreId = stores[0].id;
                localStorage.setItem('selectedStoreId', currentStoreId);
              } else if (stores.length > 1) {
                // Multiple stores - require explicit selection
                currentStoreId = null;
              }
            } catch (storeError) {
              console.error('Error loading stores for auto-select:', storeError);
              // On error, don't auto-select
              currentStoreId = null;
            }
          } else if (migratedPerms.length > 0) {
            // Auto-select first store from permissions
            currentStoreId = migratedPerms[0].storeId;
            localStorage.setItem('selectedStoreId', currentStoreId);
          }
        }
        
        setPermissions({
          isGlobalAdmin: userData.isGlobalAdmin === true,
          storePermissions: migratedPerms,
          currentStoreId
        });
      } else {
        // User document doesn't exist - preserve store if we had one
        setPermissions({
          isGlobalAdmin: false,
          storePermissions: [],
          currentStoreId: previousStoreId
        });
      }
    } catch (error) {
      console.error('Error loading user permissions:', error);
      // On error, preserve previous store to prevent it from disappearing
      setPermissions({
        isGlobalAdmin: false,
        storePermissions: [],
        currentStoreId: previousStoreId
      });
    } finally {
      setLoading(false);
    }
  };

  const setCurrentStore = (storeId: string) => {
    // Save to localStorage
    localStorage.setItem('selectedStoreId', storeId);
    // Update state
    setPermissions(prev => ({
      ...prev,
      currentStoreId: storeId
    }));
  };

  const canView = (storeId?: string): boolean => {
    if (permissions.isGlobalAdmin) return true;
    
    const targetStoreId = storeId || permissions.currentStoreId;
    if (!targetStoreId) return false;

    // If user has ANY permission entry for this store, they can view
    const perm = permissions.storePermissions.find(
      p => p.storeId === targetStoreId
    );
    return !!perm; // Has access = can view
  };

  const canEdit = (storeId?: string): boolean => {
    if (permissions.isGlobalAdmin) return true;
    
    const targetStoreId = storeId || permissions.currentStoreId;
    if (!targetStoreId) return false;

    const perm = permissions.storePermissions.find(
      p => p.storeId === targetStoreId
    );
    return perm?.canEdit || false;
  };

  const isAdmin = (): boolean => {
    return permissions.isGlobalAdmin;
  };

  const hasAnyAccess = (): boolean => {
    return permissions.isGlobalAdmin || permissions.storePermissions.length > 0;
  };

  return (
    <PermissionContext.Provider
      value={{
        permissions,
        setCurrentStore,
        canView,
        canEdit,
        isAdmin,
        hasAnyAccess,
        loading
      }}
    >
      {children}
    </PermissionContext.Provider>
  );
}
