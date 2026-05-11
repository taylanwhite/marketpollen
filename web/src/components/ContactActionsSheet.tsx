import { useState } from 'react';
import {
  SwipeableDrawer,
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Chip,
  Divider,
  IconButton,
} from '@mui/material';
import {
  Phone as PhoneIcon,
  Sms as SmsIcon,
  Email as EmailIcon,
  AutoAwesome as AIIcon,
  AddComment as ReachoutIcon,
  CalendarMonth as CalendarIcon,
  Edit as EditIcon,
  Close as CloseIcon,
  Business as BusinessIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { Contact } from '../types';

export interface ContactActionsSheetProps {
  open: boolean;
  contact: Contact | null;
  businessName?: string;
  onClose: () => void;
  onLogVisit: (contact: Contact) => void;
  onAddFollowUp: (contact: Contact) => void;
  onGenerateEmail: (contact: Contact) => void;
  onEdit: (contact: Contact) => void;
}

function getContactName(contact: Contact): string {
  return (
    `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
    || contact.email
    || contact.phone
    || 'Contact'
  );
}

/**
 * Bottom sheet exposing big tap targets for the most common contact actions
 * in the field: dial, text, email, log a visit, schedule a follow-up.
 *
 * Uses `tel:` and `sms:` URI schemes so the OS opens the native dialer / SMS
 * composer — marketers never have to copy a number to dial.
 */
export function ContactActionsSheet({
  open,
  contact,
  businessName,
  onClose,
  onLogVisit,
  onAddFollowUp,
  onGenerateEmail,
  onEdit,
}: ContactActionsSheetProps) {
  // Track an internal "open" mirror so swipe-to-close behaves correctly
  const [, setInternalOpen] = useState(false);

  if (!contact) return null;

  const name = getContactName(contact);
  const hasPhone = !!contact.phone;
  const hasEmail = !!contact.email;

  const actions: {
    key: string;
    label: string;
    secondary?: string;
    icon: React.ReactNode;
    color?: string;
    disabled?: boolean;
    href?: string;
    onClick?: () => void;
  }[] = [
    {
      key: 'call',
      label: hasPhone ? `Call ${name}` : 'Call',
      secondary: contact.phone || 'No phone number on file',
      icon: <PhoneIcon />,
      color: '#27ae60',
      disabled: !hasPhone,
      href: hasPhone ? `tel:${contact.phone}` : undefined,
    },
    {
      key: 'text',
      label: hasPhone ? `Text ${name}` : 'Text',
      secondary: contact.phone || 'No phone number on file',
      icon: <SmsIcon />,
      color: '#2ecc71',
      disabled: !hasPhone,
      href: hasPhone ? `sms:${contact.phone}` : undefined,
    },
    {
      key: 'email',
      label: hasEmail ? `Email ${name}` : 'Email',
      secondary: contact.email || 'No email on file',
      icon: <EmailIcon />,
      color: '#3498db',
      disabled: !hasEmail,
      href: hasEmail ? `mailto:${contact.email}` : undefined,
    },
    {
      key: 'generate-email',
      label: 'Generate AI email',
      secondary: 'Draft a follow-up note in seconds',
      icon: <AIIcon />,
      color: '#9b59b6',
      onClick: () => {
        onGenerateEmail(contact);
        onClose();
      },
    },
    {
      key: 'log-visit',
      label: 'Log a visit',
      secondary: 'Dictate notes from your last interaction',
      icon: <ReachoutIcon />,
      color: '#f5c842',
      onClick: () => {
        onLogVisit(contact);
        onClose();
      },
    },
    {
      key: 'schedule',
      label: 'Schedule follow-up',
      secondary: 'Add an event to your calendar',
      icon: <CalendarIcon />,
      color: '#e67e22',
      onClick: () => {
        onAddFollowUp(contact);
        onClose();
      },
    },
    {
      key: 'edit',
      label: 'View / edit contact',
      secondary: 'See history, personal details, donations',
      icon: <EditIcon />,
      color: '#7f8c8d',
      onClick: () => {
        onEdit(contact);
        onClose();
      },
    },
  ];

  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open}
      onClose={() => {
        setInternalOpen(false);
        onClose();
      }}
      onOpen={() => setInternalOpen(true)}
      disableSwipeToOpen
      slotProps={{
        paper: {
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '85vh',
            pb: 'env(safe-area-inset-bottom)',
            // Prevent iOS Safari rubber-band scroll-chaining onto the page
            // behind the sheet.
            overscrollBehavior: 'contain',
          },
        },
      }}
    >
      {/* Drag handle */}
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1 }}>
        <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'rgba(0,0,0,0.15)' }} />
      </Box>

      {/* Header */}
      <Box sx={{ px: 2, pt: 1.5, pb: 1, display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PersonIcon fontSize="small" color="action" />
            <Typography
              variant="h6"
              sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {name}
            </Typography>
          </Box>
          {businessName && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
              <BusinessIcon fontSize="small" color="action" sx={{ fontSize: 14 }} />
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {businessName}
              </Typography>
            </Box>
          )}
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75, flexWrap: 'wrap' }}>
            <Chip
              label={`${contact.reachouts?.length || 0} reachouts`}
              size="small"
              variant="outlined"
              sx={{ height: 22 }}
            />
            {contact.suggestedFollowUpDate && (
              <Chip
                icon={<CalendarIcon sx={{ fontSize: 14 }} />}
                label={new Date(contact.suggestedFollowUpDate).toLocaleDateString()}
                size="small"
                color="warning"
                variant="outlined"
                sx={{ height: 22 }}
              />
            )}
          </Box>
        </Box>
        <IconButton onClick={onClose} size="small" aria-label="Close">
          <CloseIcon />
        </IconButton>
      </Box>

      <Divider />

      {/* Actions */}
      <List sx={{ pb: 1 }}>
        {actions.map((action) => {
          const linkProps = action.href
            ? { component: 'a' as const, href: action.href }
            : {};
          return (
            <ListItemButton
              key={action.key}
              disabled={action.disabled}
              onClick={action.onClick}
              {...linkProps}
              sx={{
                py: 1.5,
                px: 2,
                gap: 1.5,
                '&:hover': { bgcolor: 'rgba(0,0,0,0.03)' },
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: 0,
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  bgcolor: action.disabled ? 'rgba(0,0,0,0.05)' : `${action.color}22`,
                  color: action.disabled ? 'rgba(0,0,0,0.3)' : action.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {action.icon}
              </ListItemIcon>
              <ListItemText
                primary={action.label}
                secondary={action.secondary}
                primaryTypographyProps={{ fontWeight: 600, fontSize: '0.95rem' }}
                secondaryTypographyProps={{ fontSize: '0.8rem' }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </SwipeableDrawer>
  );
}
