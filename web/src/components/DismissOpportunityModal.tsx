import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Chip,
  Typography,
  CircularProgress,
} from '@mui/material';

const PREDEFINED_REASONS = [
  'Not a fit for our business',
  'Already a customer',
  'Competitor',
  'Closed / Out of business',
  'Unable to contact',
  'Not interested',
];

interface DismissOpportunityModalProps {
  open: boolean;
  opportunityName: string;
  onClose: () => void;
  onDismiss: (reason: string) => Promise<void>;
}

export function DismissOpportunityModal({
  open,
  opportunityName,
  onClose,
  onDismiss,
}: DismissOpportunityModalProps) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChipClick = (predefinedReason: string) => {
    setReason(predefinedReason);
  };

  const handleDismiss = async () => {
    setLoading(true);
    try {
      await onDismiss(reason);
      setReason('');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setReason('');
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Dismiss Opportunity</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Dismiss <strong>{opportunityName}</strong>? You can restore it later if needed.
        </Typography>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Reason (optional)
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          {PREDEFINED_REASONS.map((predefined) => (
            <Chip
              key={predefined}
              label={predefined}
              onClick={() => handleChipClick(predefined)}
              color={reason === predefined ? 'primary' : 'default'}
              variant={reason === predefined ? 'filled' : 'outlined'}
              size="small"
              sx={{ cursor: 'pointer' }}
            />
          ))}
        </Box>

        <TextField
          fullWidth
          multiline
          rows={2}
          label="Dismissal reason"
          placeholder="Enter or edit the reason for dismissing this opportunity..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={loading}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleDismiss}
          variant="contained"
          color="error"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {loading ? 'Dismissing...' : 'Dismiss'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
