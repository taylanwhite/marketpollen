import { Dialog, DialogContent, DialogTitle, IconButton, Box, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Close as CloseIcon, Mic as MicIcon } from '@mui/icons-material';
import { ContactForm } from './ContactForm';

interface QuickAddDialogProps {
  open: boolean;
  onClose: () => void;
}

export function QuickAddDialog({ open, onClose }: QuickAddDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: { xs: 0, sm: 3 },
          // Stop iOS rubber-band scroll-chaining into the page underneath
          overscrollBehavior: 'contain',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          pr: 1,
          bgcolor: '#f5c842',
          color: '#2d2d2d',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <MicIcon />
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Log a visit
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small" sx={{ color: '#2d2d2d' }} aria-label="Close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Type or dictate what happened. We'll pull out the contact, business, donations, and follow-up automatically.
        </Typography>
        <ContactForm onSuccess={onClose} />
      </DialogContent>
    </Dialog>
  );
}
