import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionContext';
import { Location } from '../types';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  CircularProgress,
} from '@mui/material';
import {
  LocationOn as LocationIcon,
  Logout as LogoutIcon,
  Add as AddIcon,
} from '@mui/icons-material';

export function LocationPicker() {
  const { currentUser, logout } = useAuth();
  const { permissions, setCurrentLocation, isAdmin } = usePermissions();
  const navigate = useNavigate();
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLocations();
  }, []);

  const loadLocations = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'locations'));
      const locationList: Location[] = [];
      querySnapshot.forEach((doc) => {
        locationList.push({ id: doc.id, ...doc.data() } as Location);
      });
      
      const availableLocations = isAdmin()
        ? locationList
        : locationList.filter(loc =>
            permissions.locationPermissions.some(p => p.locationId === loc.id)
          );
      
      availableLocations.sort((a, b) => a.name.localeCompare(b.name));
      setLocations(availableLocations);
    } catch (error) {
      console.error('Error loading locations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectLocation = (locationId: string) => {
    localStorage.setItem('selectedLocationId', locationId);
    setCurrentLocation(locationId);
    navigate('/dashboard');
  };

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
      <Card sx={{ maxWidth: 800, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : locations.length === 0 ? (
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>
                🏢 No Locations Available
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 3 }}>
                You don't have access to any locations yet.
              </Typography>
              
              {isAdmin() && (
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => navigate('/locations')}
                  sx={{ mb: 2 }}
                >
                  Create First Location
                </Button>
              )}
              
              <Box>
                <Button
                  variant="outlined"
                  startIcon={<LogoutIcon />}
                  onClick={handleLogout}
                >
                  Logout
                </Button>
              </Box>
            </Box>
          ) : (
            <>
              <Box sx={{ textAlign: 'center', mb: 4 }}>
                <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
                  🏢 Select Your Location
                </Typography>
                <Typography color="text.secondary">
                  Welcome, {currentUser?.email}
                </Typography>
              </Box>

              <Grid container spacing={2} sx={{ mb: 3 }}>
                {locations.map((location) => (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={location.id}>
                    <Card
                      sx={{
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        color: 'white',
                        '&:hover': {
                          transform: 'translateY(-4px)',
                          boxShadow: 4,
                        },
                      }}
                      onClick={() => handleSelectLocation(location.id)}
                    >
                      <CardContent sx={{ textAlign: 'center', py: 3 }}>
                        <LocationIcon sx={{ fontSize: 40, mb: 1 }} />
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>
                          {location.name}
                        </Typography>
                        {location.city && (
                          <Typography variant="body2" sx={{ opacity: 0.9 }}>
                            {location.city}, {location.state}
                          </Typography>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>

              <Box sx={{ textAlign: 'center' }}>
                <Button
                  variant="text"
                  startIcon={<LogoutIcon />}
                  onClick={handleLogout}
                >
                  Logout
                </Button>
              </Box>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
