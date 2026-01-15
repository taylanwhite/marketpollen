import { ReactNode, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionContext';
import { BundtiniTracker } from './BundtiniTracker';
import { Location } from '../types';
import {
  AppBar,
  Box,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  Divider,
  Button,
  Chip,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  AdminPanelSettings as AdminIcon,
  Logout as LogoutIcon,
  SwapHoriz as SwapIcon,
  Cake as CakeIcon,
} from '@mui/icons-material';

const drawerWidth = 240;

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const { permissions, isAdmin } = usePermissions();
  
  const [mobileOpen, setMobileOpen] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<Location | null>(null);
  const [hasMultipleLocations, setHasMultipleLocations] = useState(false);

  useEffect(() => {
    loadCurrentLocation();
  }, [permissions.currentLocationId]);

  const loadCurrentLocation = async () => {
    if (!permissions.currentLocationId) {
      setCurrentLocation(null);
      return;
    }

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
      
      setHasMultipleLocations(availableLocations.length > 1);
      const current = locationList.find(loc => loc.id === permissions.currentLocationId);
      setCurrentLocation(current || null);
    } catch (error) {
      console.error('Error loading location:', error);
    }
  };

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleLogout = async () => {
    try {
      localStorage.removeItem('selectedLocationId');
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const isActive = (path: string) => location.pathname === path;

  const mainNavItems = [
    { text: 'Contacts', icon: <DashboardIcon />, path: '/dashboard' },
    { text: 'Businesses', icon: <BusinessIcon />, path: '/businesses' },
    { text: 'Donations', icon: <CakeIcon />, path: '/donations' },
  ];

  const adminNavItems = [
    { text: 'Locations', icon: <LocationIcon />, path: '/locations' },
    { text: 'User Management', icon: <AdminIcon />, path: '/admin' },
  ];

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar sx={{ justifyContent: 'center', py: 2 }}>
        <Typography variant="h6" sx={{ color: 'white', fontWeight: 700 }}>
          🎂 Bundt Marketer
        </Typography>
      </Toolbar>
      <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)' }} />
      
      <List sx={{ flex: 1, pt: 2 }}>
        {mainNavItems.map((item) => (
          <ListItem key={item.text} disablePadding>
            <ListItemButton
              onClick={() => {
                navigate(item.path);
                setMobileOpen(false);
              }}
              sx={{
                mx: 1,
                borderRadius: 2,
                mb: 0.5,
                bgcolor: isActive(item.path) ? 'rgba(102, 126, 234, 0.3)' : 'transparent',
                '&:hover': {
                  bgcolor: 'rgba(102, 126, 234, 0.2)',
                },
              }}
            >
              <ListItemIcon sx={{ color: isActive(item.path) ? '#667eea' : 'rgba(255,255,255,0.7)', minWidth: 40 }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText 
                primary={item.text} 
                sx={{ 
                  '& .MuiListItemText-primary': { 
                    color: isActive(item.path) ? '#fff' : 'rgba(255,255,255,0.8)',
                    fontWeight: isActive(item.path) ? 600 : 400,
                  } 
                }} 
              />
            </ListItemButton>
          </ListItem>
        ))}

        {isAdmin() && (
          <>
            <Divider sx={{ my: 2, borderColor: 'rgba(255,255,255,0.1)' }} />
            <Typography 
              variant="caption" 
              sx={{ 
                px: 3, 
                py: 1, 
                color: 'rgba(255,255,255,0.5)', 
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              Admin
            </Typography>
            {adminNavItems.map((item) => (
              <ListItem key={item.text} disablePadding>
                <ListItemButton
                  onClick={() => {
                    navigate(item.path);
                    setMobileOpen(false);
                  }}
                  sx={{
                    mx: 1,
                    borderRadius: 2,
                    mb: 0.5,
                    bgcolor: isActive(item.path) ? 'rgba(102, 126, 234, 0.3)' : 'transparent',
                    '&:hover': {
                      bgcolor: 'rgba(102, 126, 234, 0.2)',
                    },
                  }}
                >
                  <ListItemIcon sx={{ color: isActive(item.path) ? '#667eea' : 'rgba(255,255,255,0.7)', minWidth: 40 }}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText 
                    primary={item.text} 
                    sx={{ 
                      '& .MuiListItemText-primary': { 
                        color: isActive(item.path) ? '#fff' : 'rgba(255,255,255,0.8)',
                        fontWeight: isActive(item.path) ? 600 : 400,
                      } 
                    }} 
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </>
        )}
      </List>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)' }} />
      <List>
        <ListItem disablePadding>
          <ListItemButton
            onClick={handleLogout}
            sx={{
              mx: 1,
              borderRadius: 2,
              '&:hover': {
                bgcolor: 'rgba(231, 76, 60, 0.2)',
              },
            }}
          >
            <ListItemIcon sx={{ color: '#e74c3c', minWidth: 40 }}>
              <LogoutIcon />
            </ListItemIcon>
            <ListItemText 
              primary="Logout" 
              sx={{ '& .MuiListItemText-primary': { color: '#e74c3c' } }} 
            />
          </ListItemButton>
        </ListItem>
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          
          <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
            {currentLocation && (
              <Chip
                icon={<LocationIcon sx={{ color: 'white !important' }} />}
                label={currentLocation.name}
                sx={{
                  bgcolor: 'rgba(255,255,255,0.2)',
                  color: 'white',
                  fontWeight: 500,
                  '& .MuiChip-icon': { color: 'white' },
                }}
              />
            )}
            <BundtiniTracker />
          </Box>

          {hasMultipleLocations && (
            <Button
              color="inherit"
              startIcon={<SwapIcon />}
              onClick={() => navigate('/select-location')}
              sx={{ 
                bgcolor: 'rgba(255,255,255,0.1)',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
              }}
            >
              Change Location
            </Button>
          )}
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
      >
        {/* Mobile drawer */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { 
              boxSizing: 'border-box', 
              width: drawerWidth,
              bgcolor: '#1a1a2e',
            },
          }}
        >
          {drawer}
        </Drawer>
        
        {/* Desktop drawer */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': { 
              boxSizing: 'border-box', 
              width: drawerWidth,
              bgcolor: '#1a1a2e',
              borderRight: 'none',
            },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          bgcolor: 'background.default',
          minHeight: '100vh',
        }}
      >
        <Toolbar /> {/* Spacer for AppBar */}
        {children}
      </Box>
    </Box>
  );
}
