import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Paper, ButtonBase, Typography, Fab } from '@mui/material';
import { haptics } from '../utils/haptics';
import {
  Assignment as PlanIcon,
  Dashboard as ContactsIcon,
  Cake as CakeIcon,
  Explore as DiscoverIcon,
  Add as AddIcon,
} from '@mui/icons-material';

interface MobileBottomNavProps {
  onQuickAdd: () => void;
}

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

const LEFT_ITEMS: NavItem[] = [
  { label: 'Plan', path: '/calendar', icon: <PlanIcon /> },
  { label: 'Contacts', path: '/dashboard', icon: <ContactsIcon /> },
];

const RIGHT_ITEMS: NavItem[] = [
  { label: 'Donations', path: '/donations', icon: <CakeIcon /> },
  { label: 'Discover', path: '/opportunities', icon: <DiscoverIcon /> },
];

const FAB_SIZE = 52;
const CENTER_GAP = 72;

export function MobileBottomNav({ onQuickAdd }: MobileBottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  const renderItem = (item: NavItem) => {
    const active = isActive(item.path);
    return (
      <ButtonBase
        key={item.path}
        onClick={() => {
          haptics.tap();
          navigate(item.path);
        }}
        sx={{
          flex: 1,
          flexDirection: 'column',
          gap: 0.35,
          py: 0.75,
          minWidth: 0,
          color: active ? '#2d2d2d' : '#8a8a8a',
          transition: 'color 0.15s ease',
        }}
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 28,
            borderRadius: 2,
            bgcolor: active ? 'rgba(245, 200, 66, 0.28)' : 'transparent',
            '& svg': { fontSize: 22 },
          }}
        >
          {item.icon}
        </Box>
        <Typography
          variant="caption"
          sx={{
            fontWeight: active ? 700 : 500,
            fontSize: '0.68rem',
            lineHeight: 1.15,
            letterSpacing: 0.1,
          }}
        >
          {item.label}
        </Typography>
      </ButtonBase>
    );
  };

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: { xs: 'block', sm: 'none' },
        zIndex: (theme) => theme.zIndex.appBar,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderTop: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 -4px 16px rgba(0,0,0,0.06)',
        pb: 'env(safe-area-inset-bottom)',
        bgcolor: '#ffffff',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'stretch',
          position: 'relative',
          height: 64,
          px: 0.5,
        }}
      >
        {LEFT_ITEMS.map(renderItem)}
        <Box sx={{ width: CENTER_GAP, flexShrink: 0 }} />
        {RIGHT_ITEMS.map(renderItem)}

        <Fab
          color="primary"
          aria-label="Log a visit"
          onClick={() => {
            haptics.press();
            onQuickAdd();
          }}
          sx={{
            position: 'absolute',
            top: -18,
            left: '50%',
            transform: 'translateX(-50%)',
            bgcolor: '#f5c842',
            color: '#2d2d2d',
            width: FAB_SIZE,
            height: FAB_SIZE,
            boxShadow: '0 4px 12px rgba(245, 200, 66, 0.45)',
            border: '3px solid #ffffff',
            '&:hover': {
              bgcolor: '#e8b923',
            },
          }}
        >
          <AddIcon sx={{ fontSize: 28 }} />
        </Fab>
      </Box>
    </Paper>
  );
}
