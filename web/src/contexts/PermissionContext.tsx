import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from './AuthContext';
import { LocationPermission } from '../types';

interface UserPermissions {
  isGlobalAdmin: boolean;
  locationPermissions: LocationPermission[];
  currentLocationId: string | null;
}

interface PermissionContextType {
  permissions: UserPermissions;
  setCurrentLocation: (locationId: string) => void;
  canView: (locationId?: string) => boolean;
  canEdit: (locationId?: string) => boolean;
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
  
  // Try to load saved location from localStorage
  const savedLocationId = localStorage.getItem('selectedLocationId');
  
  const [permissions, setPermissions] = useState<UserPermissions>({
    isGlobalAdmin: false,
    locationPermissions: [],
    currentLocationId: savedLocationId
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setPermissions({
        isGlobalAdmin: false,
        locationPermissions: [],
        currentLocationId: null
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    loadUserPermissions();
  }, [currentUser]);

  const loadUserPermissions = async () => {
    if (!currentUser) return;

    try {
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const locationPerms = (userData.locationPermissions || []) as LocationPermission[];
        
        // Use saved location from localStorage, or first available location
        const savedLocationId = localStorage.getItem('selectedLocationId');
        let currentLocationId = savedLocationId;
        
        // Verify saved location is still valid
        if (savedLocationId && !userData.isGlobalAdmin) {
          const hasAccess = locationPerms.some(p => p.locationId === savedLocationId);
          if (!hasAccess) {
            currentLocationId = null;
            localStorage.removeItem('selectedLocationId');
          }
        }
        
        // Don't auto-select first location - require user to explicitly choose
        // This ensures first-time users see the location picker
        
        setPermissions({
          isGlobalAdmin: userData.isGlobalAdmin === true,
          locationPermissions: locationPerms,
          currentLocationId
        });
      } else {
        setPermissions({
          isGlobalAdmin: false,
          locationPermissions: [],
          currentLocationId: null
        });
      }
    } catch (error) {
      console.error('Error loading user permissions:', error);
      setPermissions({
        isGlobalAdmin: false,
        locationPermissions: [],
        currentLocationId: null
      });
    } finally {
      setLoading(false);
    }
  };

  const setCurrentLocation = (locationId: string) => {
    // Save to localStorage
    localStorage.setItem('selectedLocationId', locationId);
    // Update state
    setPermissions(prev => ({
      ...prev,
      currentLocationId: locationId
    }));
  };

  const canView = (locationId?: string): boolean => {
    if (permissions.isGlobalAdmin) return true;
    
    const targetLocationId = locationId || permissions.currentLocationId;
    if (!targetLocationId) return false;

    // If user has ANY permission entry for this location, they can view
    const perm = permissions.locationPermissions.find(
      p => p.locationId === targetLocationId
    );
    return !!perm; // Has access = can view
  };

  const canEdit = (locationId?: string): boolean => {
    if (permissions.isGlobalAdmin) return true;
    
    const targetLocationId = locationId || permissions.currentLocationId;
    if (!targetLocationId) return false;

    const perm = permissions.locationPermissions.find(
      p => p.locationId === targetLocationId
    );
    return perm?.canEdit || false;
  };

  const isAdmin = (): boolean => {
    return permissions.isGlobalAdmin;
  };

  const hasAnyAccess = (): boolean => {
    return permissions.isGlobalAdmin || permissions.locationPermissions.length > 0;
  };

  return (
    <PermissionContext.Provider
      value={{
        permissions,
        setCurrentLocation,
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
