import { Navigate, useLocation } from 'react-router-dom';
import { useAuth as useClerkAuth } from '@clerk/react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionContext';
import { MainLayout } from './MainLayout';
import { Box, keyframes } from '@mui/material';

const pulse = keyframes`
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.04); }
`;

const dots = keyframes`
  0% { content: ''; }
  25% { content: '.'; }
  50% { content: '..'; }
  75% { content: '...'; }
`;

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { isSignedIn, isLoaded } = useClerkAuth();
  const { loading: authLoading } = useAuth();
  const { permissions, hasAnyAccess, isAdmin, loading: permLoading } = usePermissions();
  const location = useLocation();

  if (!isLoaded || authLoading || permLoading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: '#ffffff',
          gap: 3,
        }}
      >
        <Box
          component="img"
          src="/assets/navbar-logo-280x46.png"
          srcSet="/assets/navbar-logo-560x92@2x.png 2x"
          alt="Market Pollen"
          sx={{
            height: 46,
            width: 'auto',
            maxWidth: 280,
            objectFit: 'contain',
            animation: `${pulse} 2s ease-in-out infinite`,
          }}
        />
        <Box
          sx={{
            color: '#999',
            fontSize: '0.85rem',
            letterSpacing: 1,
            '&::after': {
              content: '""',
              animation: `${dots} 1.5s steps(4, end) infinite`,
            },
          }}
        >
          Loading
        </Box>
      </Box>
    );
  }

  if (!isSignedIn) {
    return <Navigate to="/login" replace />;
  }

  if (!hasAnyAccess()) {
    return <Navigate to="/no-access" replace />;
  }

  if (requireAdmin && !isAdmin()) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!permissions.currentStoreId && location.pathname !== '/select-store') {
    return <Navigate to="/select-store" replace />;
  }

  return <MainLayout>{children}</MainLayout>;
}
