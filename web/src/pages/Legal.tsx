import { useEffect } from 'react';
import { Box, Container, Link, Paper } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { LegalDocument } from '../components/legal/LegalDocument';
import { TERMS_MARKDOWN } from '../legal/terms';
import { PRIVACY_MARKDOWN } from '../legal/privacy';

const DOCS = {
  terms: { title: 'Terms of Service | MarketPollen', markdown: TERMS_MARKDOWN },
  privacy: { title: 'Privacy Policy | MarketPollen', markdown: PRIVACY_MARKDOWN },
};

/** Public page for /terms and /privacy. Works signed in or out. */
export function LegalPage({ doc }: { doc: keyof typeof DOCS }) {
  const { title, markdown } = DOCS[doc];

  useEffect(() => {
    const previous = document.title;
    document.title = title;
    window.scrollTo(0, 0);
    return () => { document.title = previous; };
  }, [title]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f7f7f8', py: { xs: 2, sm: 5 } }}>
      <Container maxWidth="md" sx={{ px: { xs: 2, sm: 3 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, gap: 2, flexWrap: 'wrap' }}>
          <RouterLink to="/">
            <Box
              component="img"
              src="/assets/navbar-logo-280x46.png"
              srcSet="/assets/navbar-logo-560x92@2x.png 2x"
              alt="Market Pollen"
              sx={{ height: 36, width: 'auto', display: 'block' }}
            />
          </RouterLink>
          <Box sx={{ display: 'flex', gap: 2, fontSize: '0.9rem' }}>
            <Link component={RouterLink} to="/terms" underline={doc === 'terms' ? 'always' : 'hover'}>Terms</Link>
            <Link component={RouterLink} to="/privacy" underline={doc === 'privacy' ? 'always' : 'hover'}>Privacy</Link>
          </Box>
        </Box>
        <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 5 }, borderRadius: 2 }}>
          <LegalDocument markdown={markdown} />
        </Paper>
      </Container>
    </Box>
  );
}
