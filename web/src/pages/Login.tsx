import { SignIn } from '@clerk/react';
import { Box } from '@mui/material';

export function Login() {
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
      <SignIn
        routing="path"
        path="/login"
        signUpUrl="/signup"
        fallbackRedirectUrl="/select-store"
      />
    </Box>
  );
}
