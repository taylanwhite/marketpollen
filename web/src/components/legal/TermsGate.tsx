import { useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useClerk } from '@clerk/react';
import { Alert, Box, Button, Checkbox, FormControlLabel, Link, Paper, Typography } from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';

// Pages anyone can see without accepting first.
const OPEN_PATHS = ['/terms', '/privacy', '/login', '/signup'];

/**
 * Blocks the app for any signed-in user who hasn't accepted the current
 * Terms of Service and Privacy Policy. One checkbox and one button; the
 * documents open in a new tab so reading them is optional.
 */
export function TermsGate({ children }: { children: ReactNode }) {
  const { isSignedIn, userData, loading, termsAccepted } = useAuth();
  const location = useLocation();

  const isOpenPath = OPEN_PATHS.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));
  if (loading || !isSignedIn || !userData || termsAccepted || isOpenPath) {
    return <>{children}</>;
  }
  return <AcceptTermsScreen />;
}

function AcceptTermsScreen() {
  const { acceptTerms, userEmail } = useAuth();
  const { signOut } = useClerk();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    setSaving(true);
    setError(null);
    try {
      await acceptTerms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setSaving(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: '#f7f7f8',
        px: 2,
        py: 4,
      }}
    >
      <Paper variant="outlined" sx={{ maxWidth: 440, width: '100%', p: { xs: 3, sm: 4 }, borderRadius: 3 }}>
        <Box
          component="img"
          src="/assets/navbar-logo-280x46.png"
          srcSet="/assets/navbar-logo-560x92@2x.png 2x"
          alt="Market Pollen"
          sx={{ height: 36, width: 'auto', display: 'block', mb: 3 }}
        />
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Before you continue
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
          Please accept our Terms of Service and Privacy Policy to keep using MarketPollen.
        </Typography>

        <FormControlLabel
          sx={{ alignItems: 'flex-start', mb: 2.5, mr: 0 }}
          control={
            <Checkbox
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              sx={{ pt: 0.25 }}
              inputProps={{ 'aria-label': 'I agree to the Terms of Service and Privacy Policy' }}
            />
          }
          label={
            <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
              I agree to the{' '}
              <Link href="/terms" target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="/privacy" target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
                Privacy Policy
              </Link>
              .
            </Typography>
          }
        />

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Button
          fullWidth
          variant="contained"
          size="large"
          disabled={!checked || saving}
          onClick={handleContinue}
        >
          {saving ? 'Saving…' : 'Continue'}
        </Button>

        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Typography variant="caption" color="text.secondary" component="div">
            Signed in as {userEmail}
          </Typography>
          <Link component="button" variant="caption" onClick={() => signOut()} sx={{ mt: 0.5 }}>
            Sign out
          </Link>
        </Box>
      </Paper>
    </Box>
  );
}
