import { createTheme } from '@mui/material/styles';

// Bundt Marketer theme - purple gradient inspired
const theme = createTheme({
  palette: {
    primary: {
      main: '#667eea',
      light: '#8e9fef',
      dark: '#4a5fc7',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#764ba2',
      light: '#9b6fbf',
      dark: '#5a3780',
      contrastText: '#ffffff',
    },
    background: {
      default: '#f5f7fa',
      paper: '#ffffff',
    },
    text: {
      primary: '#2c3e50',
      secondary: '#5a6c7d',
    },
    success: {
      main: '#27ae60',
      light: '#2ecc71',
    },
    error: {
      main: '#e74c3c',
      light: '#ff6b6b',
    },
    warning: {
      main: '#f39c12',
      light: '#f1c40f',
    },
    info: {
      main: '#3498db',
      light: '#5dade2',
    },
  },
  typography: {
    fontFamily: [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(','),
    h1: {
      fontSize: '2rem',
      fontWeight: 600,
      color: '#2c3e50',
    },
    h2: {
      fontSize: '1.5rem',
      fontWeight: 600,
      color: '#2c3e50',
    },
    h3: {
      fontSize: '1.25rem',
      fontWeight: 600,
      color: '#2c3e50',
    },
    h4: {
      fontSize: '1.1rem',
      fontWeight: 600,
      color: '#2c3e50',
    },
    body1: {
      fontSize: '1rem',
      color: '#2c3e50',
    },
    body2: {
      fontSize: '0.875rem',
      color: '#5a6c7d',
    },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          padding: '10px 24px',
        },
        containedPrimary: {
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          '&:hover': {
            background: 'linear-gradient(135deg, #5a6fd6 0%, #6a4292 100%)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
          '&:hover': {
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
          },
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
        size: 'small',
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 12,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#1a1a2e',
          color: '#ffffff',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        },
      },
    },
  },
});

export default theme;
