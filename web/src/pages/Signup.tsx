import { SignUp } from '@clerk/react';
import { Box } from '@mui/material';

export function Signup() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: '#f8f8f8',
        p: 2,
      }}
    >
      <SignUp
        routing="path"
        path="/signup"
        signInUrl="/login"
        fallbackRedirectUrl="/select-store"
      />
    </Box>
  );
}
