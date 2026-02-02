import { ReactNode, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionContext';
import { BundtiniTracker } from './BundtiniTracker';
import { Store } from '../types';
import { api } from '../api/client';
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
  Explore as ExploreIcon,
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
      const storeList = await api.get<Store[]>('/stores');
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
    { text: 'Opportunities', icon: <ExploreIcon />, path: '/opportunities' },
    { text: 'Donations', icon: <CakeIcon />, path: '/donations' },
    { text: 'Calendar', icon: <CalendarIcon />, path: '/calendar' },
  ];

  const adminNavItems = [
    { text: 'Stores', icon: <LocationIcon />, path: '/stores' },
    { text: 'User Management', icon: <AdminIcon />, path: '/admin' },
  ];

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: '#f5f5f5', background: '#f5f5f5' }}>
      <Toolbar sx={{ justifyContent: 'center', py: 2, flexShrink: 0 }}>
        <Box
          component="img"
          src="/assets/sidemenu-logo-48.png"
          srcSet="/assets/sidemenu-logo-96@2x.png 2x"
          alt="Market Pollen"
          sx={{ height: 48, width: 48, objectFit: 'contain' }}
        />
      </Toolbar>
      <Box sx={{ px: 2, pb: 2, flexShrink: 0 }}>
        <BundtiniTracker />
      </Box>
      <Divider sx={{ borderColor: 'rgba(0,0,0,0.08)', flexShrink: 0 }} />
      
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
                    bgcolor: 'rgba(245, 200, 66, 0.12)',
                  },
                }}
              >
                <ListItemIcon sx={{ color: '#2d2d2d', minWidth: 40 }}>
                  <SwapIcon />
                </ListItemIcon>
                <ListItemText 
primary="Change Store" 
                sx={{ 
                  '& .MuiListItemText-primary': { 
                    color: '#2d2d2d',
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
                bgcolor: isActive(item.path) ? 'rgba(245, 200, 66, 0.2)' : 'transparent',
                '&:hover': {
                  bgcolor: isActive(item.path) ? 'rgba(245, 200, 66, 0.25)' : 'rgba(0, 0, 0, 0.04)',
                },
              }}
            >
              <ListItemIcon sx={{ color: '#2d2d2d', minWidth: 40 }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText 
                primary={item.text} 
                sx={{ 
                  '& .MuiListItemText-primary': { 
                    color: '#2d2d2d',
                    fontWeight: isActive(item.path) ? 600 : 400,
                  } 
                }} 
              />
            </ListItemButton>
          </ListItem>
        ))}

        {isAdmin() && (
          <>
            <Divider sx={{ my: 2, borderColor: 'rgba(0, 0, 0, 0.08)' }} />
            <Typography 
              variant="caption" 
              sx={{ 
                px: 3, 
                py: 1, 
                color: '#5a5a5a', 
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
                    bgcolor: isActive(item.path) ? 'rgba(245, 200, 66, 0.2)' : 'transparent',
                    '&:hover': {
                      bgcolor: isActive(item.path) ? 'rgba(245, 200, 66, 0.25)' : 'rgba(0, 0, 0, 0.04)',
                    },
                  }}
                >
                  <ListItemIcon sx={{ color: '#2d2d2d', minWidth: 40 }}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText 
                    primary={item.text} 
                    sx={{ 
                      '& .MuiListItemText-primary': { 
                        color: '#2d2d2d',
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

      <Divider sx={{ borderColor: 'rgba(0,0,0,0.08)', flexShrink: 0 }} />
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
        elevation={0}
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
          bgcolor: '#ffffff',
          color: '#2d2d2d',
          borderBottom: '1px solid rgba(245, 200, 66, 0.4)',
        }}
      >
        <Toolbar sx={{ px: { xs: 1, sm: 2 }, minHeight: { xs: 56, sm: 64 }, position: 'relative' }}>
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
          
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 }, minWidth: 0, overflow: 'hidden' }}>
            {currentStore && (
              <Chip
                icon={<LocationIcon sx={{ color: '#2d2d2d !important', fontSize: { xs: 16, sm: 20 } }} />}
                label={currentStore.name}
                sx={{
                  bgcolor: 'rgba(245, 200, 66, 0.15)',
                  color: '#2d2d2d',
                  border: '1px solid rgba(245, 200, 66, 0.5)',
                  fontWeight: 500,
                  fontSize: { xs: '0.75rem', sm: '0.875rem' },
                  height: { xs: 28, sm: 32 },
                  transition: 'background-color 0.2s ease, border-color 0.2s ease',
                  '& .MuiChip-icon': { color: '#2d2d2d' },
                }}
              />
            )}
          </Box>

          <Box
            component="img"
            src="/assets/nav-title-220x40.png"
            srcSet="/assets/nav-title-440x80@2x.png 2x"
            alt="Market Pollen"
            sx={{
              position: 'absolute',
              left: '50%',
              transform: 'translateX(-50%)',
              height: 36,
              width: 'auto',
              maxWidth: 200,
              objectFit: 'contain',
              pointerEvents: 'none',
            }}
          />

          {hasMultipleStores && (
            <Button
              variant="contained"
              color="primary"
              startIcon={<SwapIcon />}
              onClick={() => navigate('/select-store')}
              sx={{
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
              backgroundColor: '#f5f5f5',
              background: '#f5f5f5',
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
              backgroundColor: '#f5f5f5',
              background: '#f5f5f5',
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
