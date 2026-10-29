import { Alert } from '@mui/material';
import { Science as DemoIcon } from '@mui/icons-material';

/** Shown in place of the trial and billing banners while viewing a demo store. */
export function DemoBanner({ label = 'Demo store' }: { label?: string }) {
  return (
    <Alert
      icon={<DemoIcon fontSize="inherit" />}
      sx={{
        mb: 2,
        bgcolor: '#efe9fb',
        color: '#4a2f8a',
        '& .MuiAlert-icon': { color: '#6b4bc4' },
      }}
    >
      <strong>{label}</strong> · Not billed and not counted in reports.
    </Alert>
  );
}
