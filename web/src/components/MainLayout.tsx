import { ReactNode, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useClerk } from '@clerk/react';
import { usePermissions } from '../contexts/PermissionContext';
import { BundtiniTracker } from './BundtiniTracker';
// import { ElevenLabsConvAI } from './ElevenLabsConvAI';
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
  Settings as SettingsIcon,
} from '@mui/icons-material';

const drawerWidth = 240;

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useClerk();
  const { permissions, isAdmin, isOrgAdminFn } = usePermissions();
  
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
      
      if (current) {
        setCurrentStore(current);
      } else {
        setCurrentStore(null);
      }
    } catch (error) {
      console.error('Error loading store:', error);
    }
  };

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleLogout = async () => {
    try {
      localStorage.removeItem('selectedStoreId');
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const isStorePicker = location.pathname === '/select-store';
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
      {currentStore && (
        <Box sx={{ px: 2, pt: 2, pb: 1, flexShrink: 0, textAlign: 'center' }}>
          <Chip
            icon={<LocationIcon sx={{ color: '#2d2d2d !important', fontSize: 18 }} />}
            label={currentStore.name}
            onClick={hasMultipleStores ? () => navigate('/select-store') : undefined}
            sx={{
              bgcolor: 'rgba(245, 200, 66, 0.15)',
              color: '#2d2d2d',
              border: '1px solid rgba(245, 200, 66, 0.5)',
              fontWeight: 500,
              fontSize: '0.8rem',
              height: 32,
              maxWidth: '100%',
              cursor: hasMultipleStores ? 'pointer' : 'default',
              '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
              '& .MuiChip-icon': { color: '#2d2d2d' },
              '&:hover': hasMultipleStores ? { bgcolor: 'rgba(245, 200, 66, 0.3)' } : {},
            }}
          />
        </Box>
      )}
      <Toolbar sx={{ justifyContent: 'center', py: 1, flexShrink: 0 }}>
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

        {(isAdmin() || isOrgAdminFn()) && (
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
            {(isOrgAdminFn() || isAdmin()) && (
              <ListItem disablePadding>
                <ListItemButton
                  onClick={() => {
                    navigate('/org-settings');
                    setMobileOpen(false);
                  }}
                  sx={{
                    mx: 1,
                    borderRadius: 2,
                    mb: 0.5,
                    bgcolor: isActive('/org-settings') ? 'rgba(245, 200, 66, 0.2)' : 'transparent',
                    '&:hover': {
                      bgcolor: isActive('/org-settings') ? 'rgba(245, 200, 66, 0.25)' : 'rgba(0, 0, 0, 0.04)',
                    },
                  }}
                >
                  <ListItemIcon sx={{ color: '#2d2d2d', minWidth: 40 }}>
                    <SettingsIcon />
                  </ListItemIcon>
                  <ListItemText 
                    primary="Org Settings" 
                    sx={{ 
                      '& .MuiListItemText-primary': { 
                        color: '#2d2d2d',
                        fontWeight: isActive('/org-settings') ? 600 : 400,
                      } 
                    }} 
                  />
                </ListItemButton>
              </ListItem>
            )}
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

  if (isStorePicker) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        {children}
      </Box>
    );
  }

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
        <Toolbar sx={{ px: { xs: 1, sm: 2 }, minHeight: { xs: 56, sm: 64 }, position: 'relative', display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 }, minWidth: 0 }}>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: { xs: 0, sm: 0 }, flexShrink: 0, display: { sm: 'none' } }}
            size="small"
          >
            <MenuIcon />
          </IconButton>

          {/* Logo: inline on mobile to avoid overlap, centered on desktop */}
          <Box
            component="img"
            src="/assets/nav-title-220x40.png"
            srcSet="/assets/nav-title-440x80@2x.png 2x"
            alt="Market Pollen"
            sx={{
              height: { xs: 28, sm: 36 },
              width: 'auto',
              maxWidth: { xs: 120, sm: 200 },
              objectFit: 'contain',
              flexShrink: 0,
              display: { xs: 'block', sm: 'none' },
            }}
          />
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
              display: { xs: 'none', sm: 'block' },
            }}
          />

          {/* Store chip: mobile only (desktop shows it in sidebar) */}
          <Box sx={{ flex: 1, minWidth: 0, display: { xs: 'flex', sm: 'none' }, alignItems: 'center', overflow: 'hidden' }}>
            {currentStore && (
              <Chip
                icon={<LocationIcon sx={{ color: '#2d2d2d !important', fontSize: 16 }} />}
                label={currentStore.name}
                sx={{
                  bgcolor: 'rgba(245, 200, 66, 0.15)',
                  color: '#2d2d2d',
                  border: '1px solid rgba(245, 200, 66, 0.5)',
                  fontWeight: 500,
                  fontSize: '0.75rem',
                  height: 28,
                  maxWidth: '100%',
                  '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                  '& .MuiChip-icon': { color: '#2d2d2d' },
                }}
              />
            )}
          </Box>
          <Box sx={{ flex: 1, display: { xs: 'none', sm: 'block' } }} />

          {/* Change Store button removed — use sidebar link instead */}
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
      {/* <ElevenLabsConvAI /> */}
    </Box>
  );
}
