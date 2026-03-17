import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClerk } from '@clerk/react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionContext';
import { Store } from '../types';
import { api } from '../api/client';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  CircularProgress,
  LinearProgress,
  Chip,
  keyframes,
} from '@mui/material';
import {
  Logout as LogoutIcon,
  Add as AddIcon,
  Cake as CakeIcon,
} from '@mui/icons-material';

interface StoreProgress {
  storeId: string;
  totalMouths: number;
  goal: number;
  percentage: number;
}

const shimmer = keyframes`
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
`;

export function StorePicker() {
  const { userEmail } = useAuth();
  const { signOut } = useClerk();
  const { permissions, setCurrentStore, isAdmin } = usePermissions();
  const navigate = useNavigate();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [progressMap, setProgressMap] = useState<Map<string, StoreProgress>>(new Map());

  useEffect(() => {
    loadStores();
  }, []);

  const loadStores = async () => {
    try {
      const [storeList, progressData] = await Promise.all([
        api.get<Store[]>('/stores'),
        api.get<{ stores: StoreProgress[] }>('/store-progress').catch(() => ({ stores: [] })),
      ]);
      const availableStores = isAdmin()
        ? storeList
        : storeList.filter(store =>
            permissions.storePermissions.some(p => p.storeId === store.id)
          );
      availableStores.sort((a, b) => a.name.localeCompare(b.name));
      setStores(availableStores);

      const pMap = new Map<string, StoreProgress>();
      for (const sp of progressData.stores) {
        pMap.set(sp.storeId, sp);
      }
      setProgressMap(pMap);
    } catch (error) {
      console.error('Error loading stores:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectStore = (storeId: string) => {
    localStorage.setItem('selectedStoreId', storeId);
    setCurrentStore(storeId);
    navigate('/dashboard');
  };

  const handleLogout = async () => {
    try {
      await signOut();
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
        bgcolor: '#ffffff',
        p: 2,
      }}
    >
      <Card
        sx={{
          maxWidth: 800,
          width: '100%',
          border: '1px solid',
          borderColor: 'grey.200',
          boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
        }}
      >
        <CardContent sx={{ p: 4 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : stores.length === 0 ? (
            <Box sx={{ textAlign: 'center' }}>
              <Box
                component="img"
                src="/assets/navbar-logo-280x46.png"
                srcSet="/assets/navbar-logo-560x92@2x.png 2x"
                alt="Market Pollen"
                sx={{ height: 46, width: 'auto', maxWidth: 280, objectFit: 'contain', mx: 'auto', mb: 2 }}
              />
              <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>
                🏢 No Stores Available
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 3 }}>
                You don't have access to any stores yet.
              </Typography>
              
              {isAdmin() && (
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => navigate('/stores')}
                  sx={{ mb: 2 }}
                >
                  Create First Store
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
                <Box
                  component="img"
                  src="/assets/navbar-logo-280x46.png"
                  srcSet="/assets/navbar-logo-560x92@2x.png 2x"
                  alt="Market Pollen"
                  sx={{ height: 46, width: 'auto', maxWidth: 280, objectFit: 'contain', mx: 'auto', mb: 1 }}
                />
                <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
                  🏢 Select Your Store
                </Typography>
                <Typography color="text.secondary">
                  Welcome, {userEmail}
                </Typography>
              </Box>

              <Grid container spacing={2} sx={{ mb: 3 }}>
                {stores.map((store) => (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={store.id} sx={{ display: 'flex' }}>
                    <Card
                      sx={{
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        bgcolor: '#ffffff',
                        color: '#252525',
                        border: '1px solid',
                        borderColor: 'grey.200',
                        display: 'flex',
                        flexDirection: 'column',
                        width: '100%',
                        '&:hover': {
                          transform: 'translateY(-4px)',
                          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                          borderColor: '#f5c842',
                          bgcolor: '#ffffff',
                        },
                      }}
                      onClick={() => handleSelectStore(store.id)}
                    >
                      <CardContent sx={{ textAlign: 'center', py: 3, flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <Typography variant="h6" sx={{ fontWeight: 600, color: '#252525' }}>
                            {store.name}
                          </Typography>
                          {store.city && (
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                              {store.city}, {store.state}
                            </Typography>
                          )}
                        </Box>
                        {(() => {
                          const p = progressMap.get(store.id);
                          if (!p) return null;
                          const goalReached = p.percentage >= 100;
                          return (
                            <Box
                              sx={{
                                mt: 1.5,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                bgcolor: goalReached ? 'rgba(245, 200, 66, 0.25)' : 'rgba(0,0,0,0.04)',
                                borderRadius: 2,
                                px: 1.5,
                                py: 0.75,
                                ...(goalReached && {
                                  boxShadow: '0 0 8px rgba(255, 215, 0, 0.4)',
                                  border: '1px solid rgba(255, 215, 0, 0.3)',
                                }),
                              }}
                            >
                              <CakeIcon
                                sx={{
                                  fontSize: 18,
                                  color: goalReached ? '#FFD700' : '#888',
                                }}
                              />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25, gap: 0.5 }}>
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      color: '#2d2d2d',
                                      fontWeight: goalReached ? 700 : 500,
                                      fontSize: goalReached ? '0.8rem' : '0.7rem',
                                      textShadow: goalReached ? '0 0 10px rgba(255,215,0,0.8)' : 'none',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {p.totalMouths.toLocaleString()}
                                  </Typography>
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      color: '#5a5a5a',
                                      fontSize: '0.7rem',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    / {(p.goal / 1000).toFixed(0)}k
                                  </Typography>
                                </Box>
                                <LinearProgress
                                  variant="determinate"
                                  value={Math.min(p.percentage, 100)}
                                  sx={{
                                    height: goalReached ? 7 : 5,
                                    borderRadius: 3,
                                    bgcolor: 'rgba(0,0,0,0.08)',
                                    transition: 'height 0.3s ease',
                                    '& .MuiLinearProgress-bar': {
                                      borderRadius: 3,
                                      transition: 'background-color 0.3s ease',
                                      ...(goalReached ? {
                                        background: 'linear-gradient(90deg, #FFD700 0%, #FFF8DC 25%, #FFD700 50%, #DAA520 75%, #FFD700 100%)',
                                        backgroundSize: '200% 100%',
                                        animation: `${shimmer} 3s linear infinite`,
                                      } : {
                                        bgcolor: '#f5c842',
                                      }),
                                    },
                                  }}
                                />
                              </Box>
                              <Chip
                                label={`${p.percentage.toFixed(0)}%`}
                                size="small"
                                sx={{
                                  height: 20,
                                  fontSize: '0.65rem',
                                  bgcolor: goalReached ? '#FFD700' : '#f5c842',
                                  color: '#2d2d2d',
                                  fontWeight: 600,
                                  '& .MuiChip-label': { px: 0.75 },
                                }}
                              />
                            </Box>
                          );
                        })()}
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
