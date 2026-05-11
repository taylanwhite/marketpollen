import { ReactNode, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePermissions } from '../contexts/PermissionContext';
import { BundtiniTracker } from './BundtiniTracker';
import { MobileBottomNav } from './MobileBottomNav';
import { UserMenu } from './UserMenu';
import { QuickAddDialog } from './QuickAddDialog';
import { OfflineIndicator } from './OfflineIndicator';
import { OfflineBanner } from './OnlineOnlyNotice';
import { Store } from '../types';
import { api } from '../api/client';
import { prefetchOfflineAssets } from '../utils/prefetchOfflineAssets';
import {
  AppBar,
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Divider,
} from '@mui/material';
import {
  Assignment as PlanIcon,
  Dashboard as ContactsIcon,
  Cake as CakeIcon,
  Explore as DiscoverIcon,
} from '@mui/icons-material';

const drawerWidth = 220;
const bottomNavHeight = 64;

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { permissions, isAdmin } = usePermissions();

  const [currentStore, setCurrentStore] = useState<Store | null>(null);
  const [hasMultipleStores, setHasMultipleStores] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  useEffect(() => {
    loadCurrentStore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissions.currentStoreId]);

  useEffect(() => {
    // Warm lazy chunks (action sheet, edit modal, email dialog) while the
    // user still has signal. Without this, the first contact-tap in a dead
    // zone shows a blank Suspense fallback.
    prefetchOfflineAssets();
  }, []);

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
        : storeList.filter((store) =>
            permissions.storePermissions.some((p) => p.storeId === store.id)
          );
      setHasMultipleStores(availableStores.length > 1);
      const current = storeList.find((store) => store.id === permissions.currentStoreId);
      setCurrentStore(current || null);
    } catch (error) {
      console.error('Error loading store:', error);
    }
  };

  const isStorePicker = location.pathname === '/select-store';
  const isActive = (path: string) => location.pathname === path;

  const navItems = [
    { text: 'Plan', icon: <PlanIcon />, path: '/calendar' },
    { text: 'Contacts', icon: <ContactsIcon />, path: '/dashboard' },
    { text: 'Donations', icon: <CakeIcon />, path: '/donations' },
    { text: 'Discover', icon: <DiscoverIcon />, path: '/opportunities' },
  ];

  // Desktop sidebar (5 items max: 4 main + visual goal tracker on top)
  const desktopDrawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#f5f5f5' }}>
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
      <List sx={{ flex: 1, pt: 2, overflowY: 'auto' }}>
        {navItems.map((item) => (
          <ListItem key={item.text} disablePadding>
            <ListItemButton
              onClick={() => navigate(item.path)}
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
              <ListItemIcon sx={{ color: '#2d2d2d', minWidth: 40 }}>{item.icon}</ListItemIcon>
              <ListItemText
                primary={item.text}
                sx={{
                  '& .MuiListItemText-primary': {
                    color: '#2d2d2d',
                    fontWeight: isActive(item.path) ? 600 : 400,
                  },
                }}
              />
            </ListItemButton>
          </ListItem>
        ))}
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
        <Toolbar
          sx={{
            px: { xs: 1.5, sm: 2 },
            minHeight: { xs: 56, sm: 64 },
            display: 'flex',
            alignItems: 'center',
            gap: { xs: 1, sm: 2 },
          }}
        >
          {/* Mobile: logo on the left */}
          <Box
            component="img"
            src="/assets/nav-title-220x40.png"
            srcSet="/assets/nav-title-440x80@2x.png 2x"
            alt="Market Pollen"
            sx={{
              height: { xs: 26, sm: 36 },
              width: 'auto',
              maxWidth: { xs: 130, sm: 200 },
              objectFit: 'contain',
              flexShrink: 0,
            }}
          />

          {/* Mobile-only inline goal tracker for at-a-glance progress */}
          <Box sx={{ flex: 1, display: { xs: 'flex', sm: 'none' }, minWidth: 0, alignItems: 'center' }}>
            <BundtiniTracker />
          </Box>

          {/* Desktop spacer */}
          <Box sx={{ flex: 1, display: { xs: 'none', sm: 'block' } }} />

          {/* Offline / sync status — visible on every screen */}
          <OfflineIndicator />

          {/* Avatar menu (admin, store switch, logout) on every screen */}
          <UserMenu currentStore={currentStore} hasMultipleStores={hasMultipleStores} />
        </Toolbar>
      </AppBar>

      {/* Desktop sidebar */}
      <Box component="nav" sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              backgroundColor: '#f5f5f5',
              borderRight: 'none',
              overflow: 'hidden',
            },
          }}
          open
        >
          {desktopDrawer}
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
          // Reserve space under content so the floating bottom nav never
          // covers anything — but only when the nav is actually visible.
          pb: {
            xs:
              permissions.currentStoreId && location.pathname !== '/select-store'
                ? `calc(${bottomNavHeight}px + env(safe-area-inset-bottom) + 24px)`
                : 2,
            sm: 3,
          },
        }}
      >
        <Toolbar />
        {/* Persistent, sticky no-signal banner directly under the AppBar.
            The pill in the top bar is easy to miss on a busy page; this
            ribbon is unmissable and tells marketers exactly what's degraded. */}
        <OfflineBanner />
        {children}
      </Box>

      {/* Mobile bottom navigation + center "+" — hidden when the user hasn't
          picked a store yet, since tab destinations and quick-add all depend
          on currentStoreId being set. */}
      {permissions.currentStoreId && location.pathname !== '/select-store' && (
        <>
          <MobileBottomNav onQuickAdd={() => setQuickAddOpen(true)} />
          <QuickAddDialog open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
        </>
      )}
    </Box>
  );
}
