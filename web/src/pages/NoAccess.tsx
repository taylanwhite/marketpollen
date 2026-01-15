import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionContext';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
} from '@mui/material';
import { Logout as LogoutIcon, Lock as LockIcon } from '@mui/icons-material';

export function NoAccess() {
  const { logout, currentUser } = useAuth();
  const { hasAnyAccess, loading } = usePermissions();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && hasAnyAccess()) {
      navigate('/dashboard', { replace: true });
    }
  }, [hasAnyAccess, loading, navigate]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 500, width: '100%', textAlign: 'center' }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ mb: 3 }}>
            <LockIcon sx={{ fontSize: 64, color: 'text.secondary' }} />
          </Box>
          
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>
            No Access Granted
          </Typography>
          
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
            Your account ({currentUser?.email}) does not have permission to access this application.
          </Typography>
          
          <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
            Please reach out to your administrator if you believe this to be an error.
          </Typography>

          <Button
            variant="contained"
            startIcon={<LogoutIcon />}
            onClick={handleLogout}
          >
            Logout
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
