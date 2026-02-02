import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { StorePermission, Store } from '../types';
import { api } from '../api/client';

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
  const savedStoreId = typeof window !== 'undefined' ? localStorage.getItem('selectedStoreId') : null;

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

    const previousStoreId = permissions.currentStoreId || localStorage.getItem('selectedStoreId');

    try {
      const me = await api.get<{
        user: { uid: string; isGlobalAdmin: boolean } | null;
        storePermissions: { storeId: string; canEdit: boolean }[];
        stores: { id: string; name: string }[];
      }>('/me');

      const storePerms: StorePermission[] = (me.storePermissions || []).map(p => ({
        storeId: p.storeId,
        canEdit: p.canEdit
      })).filter(p => p.storeId);

      const isGlobalAdmin = me.user?.isGlobalAdmin === true;
      const savedStoreId = localStorage.getItem('selectedStoreId') || previousStoreId;
      let currentStoreId = savedStoreId;

      if (savedStoreId && !isGlobalAdmin) {
        const hasAccess = storePerms.some(p => p.storeId === savedStoreId);
        if (!hasAccess) {
          currentStoreId = null;
          localStorage.removeItem('selectedStoreId');
        }
      }

      if (!currentStoreId) {
        const stores = (me.stores || []) as Store[];
        if (isGlobalAdmin && stores.length === 1) {
          currentStoreId = stores[0].id;
          localStorage.setItem('selectedStoreId', currentStoreId);
        } else if (isGlobalAdmin && stores.length > 1) {
          currentStoreId = null;
        } else if (storePerms.length > 0) {
          currentStoreId = storePerms[0].storeId;
          localStorage.setItem('selectedStoreId', currentStoreId);
        }
      }

      setPermissions({
        isGlobalAdmin,
        storePermissions: storePerms,
        currentStoreId
      });
    } catch (error) {
      console.error('Error loading permissions:', error);
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
    localStorage.setItem('selectedStoreId', storeId);
    setPermissions(prev => ({
      ...prev,
      currentStoreId: storeId
    }));
  };

  const canView = (storeId?: string): boolean => {
    if (permissions.isGlobalAdmin) return true;
    const targetStoreId = storeId || permissions.currentStoreId;
    if (!targetStoreId) return false;
    return permissions.storePermissions.some(p => p.storeId === targetStoreId);
  };

  const canEdit = (storeId?: string): boolean => {
    if (permissions.isGlobalAdmin) return true;
    const targetStoreId = storeId || permissions.currentStoreId;
    if (!targetStoreId) return false;
    const perm = permissions.storePermissions.find(p => p.storeId === targetStoreId);
    return perm?.canEdit || false;
  };

  const isAdmin = (): boolean => permissions.isGlobalAdmin;
  const hasAnyAccess = (): boolean => permissions.isGlobalAdmin || permissions.storePermissions.length > 0;

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
