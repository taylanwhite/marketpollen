import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { StorePermission, Store, Organization } from '../types';
import { api } from '../api/client';

interface UserPermissions {
  isGlobalAdmin: boolean;
  isOrgAdmin: boolean;
  storePermissions: StorePermission[];
  currentStoreId: string | null;
  organizations: Organization[];
}

interface PermissionContextType {
  permissions: UserPermissions;
  setCurrentStore: (storeId: string) => void;
  canView: (storeId?: string) => boolean;
  canEdit: (storeId?: string) => boolean;
  isAdmin: () => boolean;
  isOrgAdminFn: () => boolean;
  hasAnyAccess: () => boolean;
  currentOrg: Organization | null;
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
  const { isSignedIn, userId, userData, loading: authLoading } = useAuth();
  const savedStoreId = typeof window !== 'undefined' ? localStorage.getItem('selectedStoreId') : null;

  const [permissions, setPermissions] = useState<UserPermissions>({
    isGlobalAdmin: false,
    isOrgAdmin: false,
    storePermissions: [],
    currentStoreId: savedStoreId,
    organizations: [],
  });
  const [loading, setLoading] = useState(true);

  // Wait for AuthContext to finish loading (which sets the token getter and syncs the user)
  // before attempting to load permissions
  useEffect(() => {
    if (authLoading) return;

    if (!isSignedIn) {
      setPermissions({
        isGlobalAdmin: false,
        isOrgAdmin: false,
        storePermissions: [],
        currentStoreId: null,
        organizations: [],
      });
      setLoading(false);
      return;
    }

    if (!userId || !userData) {
      setLoading(true);
      return;
    }

    setLoading(true);
    loadUserPermissions();
  }, [authLoading, isSignedIn, userId, userData]);

  const loadUserPermissions = async () => {
    if (!isSignedIn || !userId) return;

    const previousStoreId = permissions.currentStoreId || localStorage.getItem('selectedStoreId');

    try {
      const me = await api.get<{
        user: { uid: string; isGlobalAdmin: boolean } | null;
        storePermissions: { storeId: string; canEdit: boolean }[];
        stores: { id: string; name: string }[];
        organizations?: Organization[];
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

      const orgs = (me.organizations || []) as Organization[];
      const orgAdmin = isGlobalAdmin || orgs.some(o => o.isAdmin);

      setPermissions({
        isGlobalAdmin,
        isOrgAdmin: orgAdmin,
        storePermissions: storePerms,
        currentStoreId,
        organizations: orgs,
      });
    } catch (error) {
      console.error('Error loading permissions:', error);
      setPermissions({
        isGlobalAdmin: false,
        isOrgAdmin: false,
        storePermissions: [],
        currentStoreId: previousStoreId,
        organizations: [],
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
  const isOrgAdminFn = (): boolean => permissions.isOrgAdmin;
  const hasAnyAccess = (): boolean => permissions.isGlobalAdmin || permissions.storePermissions.length > 0;

  const currentOrg: Organization | null = (() => {
    if (permissions.organizations.length === 0) return null;
    if (!permissions.currentStoreId) return permissions.organizations[0] || null;
    return permissions.organizations.find(o =>
      o.stores.some(s => s.id === permissions.currentStoreId)
    ) || permissions.organizations[0] || null;
  })();

  return (
    <PermissionContext.Provider
      value={{
        permissions,
        setCurrentStore,
        canView,
        canEdit,
        isAdmin,
        isOrgAdminFn,
        hasAnyAccess,
        currentOrg,
        loading
      }}
    >
      {children}
    </PermissionContext.Provider>
  );
}
