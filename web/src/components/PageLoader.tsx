import { Component, Suspense, type ReactNode } from 'react';
import { Alert, Box, Button, CircularProgress } from '@mui/material';
import { useLocation } from 'react-router-dom';

/**
 * Shows a page whose code loads as its own file. Usually the code is already
 * there (prefetched at startup). If it can't be fetched, say so with a retry
 * instead of leaving a blank screen.
 */
class PageLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    // Only page-code fetch failures; anything else goes to the browser as before.
    if (/dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError|Loading chunk/i.test(message)) {
      return { failed: true };
    }
    throw error;
  }

  render() {
    if (this.state.failed) {
      return (
        <Box sx={{ p: 2 }}>
          <Alert
            severity="warning"
            action={<Button color="inherit" size="small" sx={{ minHeight: 44 }} onClick={() => window.location.reload()}>Retry</Button>}
          >
            This page couldn't load. Check your connection and try again.
          </Alert>
        </Box>
      );
    }
    return this.props.children;
  }
}

export function PageLoader({ children }: { children: ReactNode }) {
  // Every page sits in the same spot under the layout, so without the key a
  // failed load would keep showing after moving to another page.
  const { pathname } = useLocation();
  return (
    <PageLoadBoundary key={pathname}>
      <Suspense
        fallback={
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        }
      >
        {children}
      </Suspense>
    </PageLoadBoundary>
  );
}
