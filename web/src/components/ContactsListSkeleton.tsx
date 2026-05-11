import { Box, Card, CardContent, Skeleton, Grid } from '@mui/material';

interface ContactsListSkeletonProps {
  count?: number;
}

/**
 * Placeholder cards shown while the contacts list is fetching. They mirror
 * the real card layout so the page doesn't shift when content arrives.
 */
export function ContactsListSkeleton({ count = 6 }: ContactsListSkeletonProps) {
  return (
    <Grid container spacing={2}>
      {Array.from({ length: count }).map((_, i) => (
        <Grid size={{ xs: 12, sm: 6, xl: 4 }} key={i}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                <Skeleton variant="text" width="55%" height={28} />
                <Skeleton variant="rounded" width={48} height={20} />
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 2 }}>
                <Skeleton variant="text" width="70%" height={20} />
                <Skeleton variant="text" width="60%" height={20} />
                <Skeleton variant="text" width="40%" height={20} />
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Skeleton variant="rounded" width={80} height={22} />
                <Skeleton variant="rounded" width={92} height={22} />
              </Box>
            </CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', px: 2, pb: 1.5 }}>
              <Skeleton variant="rounded" width={110} height={28} />
              <Skeleton variant="rounded" width={96} height={28} />
            </Box>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}
