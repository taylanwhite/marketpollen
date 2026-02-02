import { createTheme } from '@mui/material/styles';

// MarketPollen theme — values must match brand-colors.css (MUI requires hex/rgb, not CSS variables)
const brand = {
  text: '#2d2d2d',
  textSecondary: '#5a5a5a',
  /** Sidebar: solid dark charcoal so it’s not hazy (not the same as text black) */
  sidebarBg: '#f5f5f5',
  /** App bar: lighter than sidebar so they don’t blend */
  appBarBg: '#ffffff',
  yellow: '#f5c842',
  yellowLight: '#f8d054',
  yellowDark: '#e8b923',
  honey: '#f0c14b',
  amber: '#d4a017',
  bg: '#ffffff',
  paper: '#ffffff',
};

const theme = createTheme({
  palette: {
    primary: {
      main: brand.yellow,
      light: brand.yellowLight,
      dark: brand.yellowDark,
      contrastText: brand.text,
    },
    secondary: {
      main: brand.text,
      light: brand.textSecondary,
      dark: '#1a1a1a',
      contrastText: '#ffffff',
    },
    background: {
      default: brand.bg,
      paper: brand.paper,
    },
    text: {
      primary: brand.text,
      secondary: brand.textSecondary,
    },
    success: {
      main: brand.yellow,
      light: brand.yellowLight,
    },
    error: {
      main: '#e74c3c',
      light: '#ff6b6b',
    },
    warning: {
      main: brand.amber,
      light: brand.honey,
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
    h1: { fontSize: '2rem', fontWeight: 600, color: brand.text },
    h2: {
      fontSize: '1.5rem',
      fontWeight: 600,
      color: brand.text,
    },
    h3: {
      fontSize: '1.25rem',
      fontWeight: 600,
      color: brand.text,
    },
    h4: {
      fontSize: '1.1rem',
      fontWeight: 600,
      color: brand.text,
    },
    body1: {
      fontSize: '1rem',
      color: brand.text,
    },
    body2: {
      fontSize: '0.875rem',
      color: brand.textSecondary,
    },
  },
  shape: {
    borderRadius: 10,
  },
  transitions: {
    duration: { shortest: 150, shorter: 200, short: 250, standard: 280 },
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          padding: '10px 20px',
          transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
        },
        containedPrimary: {
          background: brand.yellow,
          color: brand.text,
          border: '1px solid rgba(245, 200, 66, 0.5)',
          '&:hover': {
            background: brand.yellowLight,
            color: brand.text,
            borderColor: brand.yellowDark,
          },
        },
        containedSecondary: {
          background: 'rgba(45, 45, 45, 0.06)',
          color: brand.text,
          border: '1px solid rgba(45, 45, 45, 0.2)',
          '&:hover': {
            background: 'rgba(45, 45, 45, 0.1)',
            borderColor: 'rgba(45, 45, 45, 0.35)',
          },
        },
        outlined: {
          borderWidth: 1,
          '&.MuiButton-outlinedPrimary': {
            borderColor: 'rgba(245, 200, 66, 0.6)',
            color: brand.text,
            backgroundColor: 'rgba(245, 200, 66, 0.06)',
            '&:hover': {
              borderColor: brand.yellow,
              backgroundColor: 'rgba(245, 200, 66, 0.12)',
            },
          },
          '&.MuiButton-outlinedSecondary': {
            borderColor: 'rgba(45, 45, 45, 0.25)',
            color: brand.text,
            '&:hover': {
              borderColor: 'rgba(45, 45, 45, 0.4)',
              backgroundColor: 'rgba(45, 45, 45, 0.04)',
            },
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          border: '1px solid rgba(0, 0, 0, 0.06)',
          transition: 'box-shadow 0.25s ease, border-color 0.25s ease',
          '&:hover': {
            boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
            borderColor: 'rgba(0, 0, 0, 0.08)',
          },
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
        size: 'small',
      },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(0, 0, 0, 0.12)',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(0, 0, 0, 0.2)',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderWidth: 1,
            borderColor: brand.yellow,
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          border: '1px solid rgba(0, 0, 0, 0.06)',
        },
        elevation1: {
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
          transition: 'background-color 0.2s ease, border-color 0.2s ease',
        },
        outlined: {
          borderColor: 'rgba(0, 0, 0, 0.12)',
          backgroundColor: 'transparent',
          '&:hover': {
            backgroundColor: 'rgba(0, 0, 0, 0.03)',
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)',
          border: '1px solid rgba(0, 0, 0, 0.06)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: brand.sidebarBg,
          background: brand.sidebarBg,
          color: brand.text,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: brand.appBarBg,
          color: brand.text,
          borderBottom: '1px solid rgba(245, 200, 66, 0.4)',
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        standardSuccess: {
          backgroundColor: 'rgba(245, 200, 66, 0.1)',
          color: brand.text,
          borderLeft: '3px solid ' + brand.yellow,
          '& .MuiAlert-icon': { color: brand.text },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          transition: 'background-color 0.2s ease',
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(0, 0, 0, 0.08)',
          borderRadius: 4,
        },
        bar: {
          borderRadius: 4,
        },
      },
    },
  },
});

export default theme;
