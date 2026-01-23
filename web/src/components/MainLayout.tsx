import { ReactNode, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionContext';
import { BundtiniTracker } from './BundtiniTracker';
import { Store } from '../types';
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
  CalendarMonth as CalendarIcon,
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
  const [currentStore, setCurrentStore] = useState<Store | null>(null);
  const [hasMultipleStores, setHasMultipleStores] = useState(false);

  useEffect(() => {
    loadCurrentStore();
  }, [permissions.currentStoreId]);

  const loadCurrentStore = async () => {
    if (!permissions.currentStoreId) {
      setCurrentStore(null);
      setHasMultipleStores(false);
      return;
    }

    try {
      const querySnapshot = await getDocs(collection(db, 'stores'));
      const storeList: Store[] = [];
      querySnapshot.forEach((doc) => {
        storeList.push({ id: doc.id, ...doc.data() } as Store);
      });

      const availableStores = isAdmin()
        ? storeList
        : storeList.filter(store =>
            permissions.storePermissions.some(p => p.storeId === store.id)
          );
      
      setHasMultipleStores(availableStores.length > 1);
      const current = storeList.find(store => store.id === permissions.currentStoreId);
      
      // If store not found, it might have been deleted - don't clear it immediately
      // Let PermissionContext handle validation
      if (current) {
        setCurrentStore(current);
      } else {
        // Store not found - might be deleted or user lost access
        // Keep showing it for now, PermissionContext will handle cleanup
        setCurrentStore(null);
      }
    } catch (error) {
      console.error('Error loading store:', error);
      // Don't clear store on error - might be temporary network issue
    }
  };

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleLogout = async () => {
    try {
      localStorage.removeItem('selectedStoreId');
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
    { text: 'Calendar', icon: <CalendarIcon />, path: '/calendar' },
  ];

  const adminNavItems = [
    { text: 'Stores', icon: <LocationIcon />, path: '/stores' },
    { text: 'User Management', icon: <AdminIcon />, path: '/admin' },
  ];

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Toolbar sx={{ justifyContent: 'center', py: 2, flexShrink: 0 }}>
        <Typography variant="h6" sx={{ color: 'white', fontWeight: 700 }}>
          🎂 Bundt Marketer
        </Typography>
      </Toolbar>
      <Box sx={{ px: 2, pb: 2, flexShrink: 0 }}>
        <BundtiniTracker />
      </Box>
      <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
      
      {hasMultipleStores && (
        <>
          <List sx={{ flexShrink: 0 }}>
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => {
                  navigate('/select-store');
                  setMobileOpen(false);
                }}
                sx={{
                  mx: 1,
                  borderRadius: 2,
                  mb: 0.5,
                  '&:hover': {
                    bgcolor: 'rgba(102, 126, 234, 0.2)',
                  },
                }}
              >
                <ListItemIcon sx={{ color: 'rgba(255,255,255,0.7)', minWidth: 40 }}>
                  <SwapIcon />
                </ListItemIcon>
                <ListItemText 
                  primary="Change Store" 
                  sx={{ 
                    '& .MuiListItemText-primary': { 
                      color: 'rgba(255,255,255,0.8)',
                    } 
                  }} 
                />
              </ListItemButton>
            </ListItem>
          </List>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 1, flexShrink: 0 }} />
        </>
      )}
      
      <List sx={{ flex: 1, pt: 2, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>
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

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
      <List sx={{ flexShrink: 0 }}>
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
        <Toolbar sx={{ px: { xs: 1, sm: 2 }, minHeight: { xs: 56, sm: 64 } }}>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: { xs: 1, sm: 2 }, display: { sm: 'none' } }}
            size="small"
          >
            <MenuIcon />
          </IconButton>
          
          <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 }, minWidth: 0, overflow: 'hidden' }}>
            {currentStore && (
              <Chip
                icon={<LocationIcon sx={{ color: 'white !important', fontSize: { xs: 16, sm: 20 } }} />}
                label={currentStore.name}
                sx={{
                  bgcolor: 'rgba(255,255,255,0.2)',
                  color: 'white',
                  fontWeight: 500,
                  fontSize: { xs: '0.75rem', sm: '0.875rem' },
                  height: { xs: 28, sm: 32 },
                  '& .MuiChip-icon': { color: 'white' },
                }}
              />
            )}
          </Box>

          {hasMultipleStores && (
            <Button
              color="inherit"
              startIcon={<SwapIcon />}
              onClick={() => navigate('/select-store')}
              sx={{ 
                bgcolor: 'rgba(255,255,255,0.1)',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
                fontSize: { xs: '0.75rem', sm: '0.875rem' },
                px: { xs: 1, sm: 2 },
                minWidth: { xs: 'auto', sm: 140 },
                display: { xs: 'none', sm: 'flex' },
                '& .MuiButton-startIcon': {
                  marginRight: { xs: 0.5, sm: 1 },
                },
              }}
            >
              Change Store
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
              overflow: 'hidden',
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
              overflow: 'hidden',
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
          p: { xs: 1.5, sm: 3 },
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          bgcolor: 'background.default',
          minHeight: '100vh',
          overflowX: 'hidden',
        }}
      >
        <Toolbar /> {/* Spacer for AppBar */}
        {children}
      </Box>
    </Box>
  );
}
