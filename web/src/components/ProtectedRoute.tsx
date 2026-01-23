import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionContext';
import { MainLayout } from './MainLayout';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { currentUser, loading: authLoading } = useAuth();
  const { permissions, hasAnyAccess, isAdmin, loading: permLoading } = usePermissions();
  const location = useLocation();

  if (authLoading || permLoading) {
    return <div className="loading-container">Loading...</div>;
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  // Check if user has any access
  if (!hasAnyAccess()) {
    return <Navigate to="/no-access" replace />;
  }

  // Check admin requirement
  if (requireAdmin && !isAdmin()) {
    return <Navigate to="/dashboard" replace />;
  }

  // Ensure a store is always selected (except on /select-store route)
  // Global admins need to pick a store too, even though they can see all stores
  if (!permissions.currentStoreId && location.pathname !== '/select-store') {
    return <Navigate to="/select-store" replace />;
  }

  return <MainLayout>{children}</MainLayout>;
}
