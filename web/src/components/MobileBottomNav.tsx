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
          gap: 0.25,
          py: 1,
          color: active ? '#2d2d2d' : '#7a7a7a',
          transition: 'color 0.15s ease',
          position: 'relative',
          '&::before': active
            ? {
                content: '""',
                position: 'absolute',
                top: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 32,
                height: 3,
                borderRadius: 2,
                bgcolor: '#f5c842',
              }
            : {},
        }}
        aria-label={item.label}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            '& svg': { fontSize: 24 },
          }}
        >
          {item.icon}
        </Box>
        <Typography
          variant="caption"
          sx={{
            fontWeight: active ? 700 : 500,
            fontSize: '0.7rem',
            lineHeight: 1,
          }}
        >
          {item.label}
        </Typography>
      </ButtonBase>
    );
  };

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: { xs: 'block', sm: 'none' },
        zIndex: (theme) => theme.zIndex.appBar,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderTop: '1px solid rgba(0,0,0,0.06)',
        pb: 'env(safe-area-inset-bottom)',
        bgcolor: '#ffffff',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'stretch', position: 'relative', height: 64 }}>
        {LEFT_ITEMS.map(renderItem)}

        {/* Center spacer for FAB */}
        <Box sx={{ width: 72, flexShrink: 0 }} />

        {RIGHT_ITEMS.map(renderItem)}

        {/* Floating + button */}
        <Fab
          color="primary"
          aria-label="Log a visit"
          onClick={() => {
            haptics.press();
            onQuickAdd();
          }}
          sx={{
            position: 'absolute',
            top: -24,
            left: '50%',
            transform: 'translateX(-50%)',
            bgcolor: '#f5c842',
            color: '#2d2d2d',
            width: 60,
            height: 60,
            boxShadow: '0 6px 16px rgba(245, 200, 66, 0.5)',
            '&:hover': {
              bgcolor: '#e8b923',
            },
          }}
        >
          <AddIcon sx={{ fontSize: 32 }} />
        </Fab>
      </Box>
    </Paper>
  );
}
