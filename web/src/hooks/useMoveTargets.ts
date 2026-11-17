import { useMemo } from 'react';
import { usePermissions } from '../contexts/PermissionContext';

/** Stores a business in `storeId` can move to: other stores of the same organization the person can edit. */
export function useMoveTargets(storeId: string | null | undefined) {
  const { permissions, canEdit } = usePermissions();
  return useMemo(() => {
    if (!storeId) return [];
    const org = permissions.organizations.find((o) => o.stores.some((s) => s.id === storeId));
    if (!org || !canEdit(storeId)) return [];
    return org.stores.filter((s) => s.id !== storeId && canEdit(s.id));
    // canEdit reads permissions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, permissions]);
}
