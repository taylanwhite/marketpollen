import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  Chip,
  TextField,
  IconButton,
  InputAdornment,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  Close as CloseIcon,
  Search as SearchIcon,
  Tune as FilterIcon,
} from '@mui/icons-material';

/**
 * Curated catalog of business types that consistently convert for our
 * marketers. Grouped into sections so the dialog reads like a menu rather
 * than a wall of chips. Order within each section is by historical
 * reach-out volume (most-used first).
 *
 * Each entry's string is sent verbatim as Google Places `textQuery`, so
 * phrasing matters (e.g. "Real estate office" reliably returns realtor
 * branches; "Real estate" alone bleeds into property listings).
 *
 * Add new categories sparingly — every entry adds visual noise and the
 * inline quick-tap chips on the page should cover the 80% case.
 */
export const FILTER_TYPE_CATEGORIES: Array<{ name: string; types: readonly string[] }> = [
  {
    name: 'Professional services',
    types: [
      'Real estate office',
      'Law firm',
      'Accountant',
      'Insurance agency',
      'Mortgage company',
      'Financial advisor',
      'Architect',
      'Engineering firm',
      'Marketing agency',
      'Consulting firm',
    ],
  },
  {
    name: 'Healthcare',
    types: [
      'Hospital',
      'Doctor office',
      'Dentist',
      'Pediatric office',
      'Chiropractor',
      'Veterinarian',
      'Physical therapy',
      'Optometrist',
      'Pharmacy',
      'Urgent care',
      'Nursing home',
      'Assisted living',
    ],
  },
  {
    name: 'Events & hospitality',
    types: [
      'Event venue',
      'Wedding venue',
      'Catering company',
      'Hotel',
      'Country club',
      'Banquet hall',
      'Convention center',
    ],
  },
  {
    name: 'Education',
    types: [
      'Elementary school',
      'High school',
      'Daycare',
      'Preschool',
      'College',
      'Tutoring center',
      'Library',
      'Music school',
    ],
  },
  {
    name: 'Finance',
    types: [
      'Bank',
      'Credit union',
      'Investment firm',
      'Tax preparation',
    ],
  },
  {
    name: 'Personal services',
    types: [
      'Salon',
      'Spa',
      'Barber shop',
      'Nail salon',
      'Massage therapy',
      'Dry cleaner',
      'Tailor',
    ],
  },
  {
    name: 'Fitness & wellness',
    types: [
      'Gym',
      'Yoga studio',
      'Pilates studio',
      'Dance studio',
      'CrossFit gym',
      'Martial arts school',
    ],
  },
  {
    name: 'Retail & local',
    types: [
      'Florist',
      'Boutique',
      'Jewelry store',
      'Bookstore',
      'Gift shop',
      'Furniture store',
      'Hardware store',
    ],
  },
  {
    name: 'Auto',
    types: [
      'Car dealership',
      'Auto repair shop',
      'Tire shop',
      'Car wash',
    ],
  },
  {
    name: 'Faith & community',
    types: [
      'Church',
      'Synagogue',
      'Community center',
      'Nonprofit',
    ],
  },
  {
    name: 'Civic',
    types: [
      'City hall',
      'Post office',
      'Fire station',
      'Police station',
      'Library',
    ],
  },
  {
    name: 'Workplaces',
    types: [
      'Corporate office',
      'Coworking space',
      'Manufacturing plant',
      'Distribution center',
    ],
  },
  {
    name: 'End-of-life',
    types: [
      'Funeral home',
      'Memorial service',
      'Cemetery',
    ],
  },
];

interface FilterTypeDialogProps {
  open: boolean;
  /** Currently-applied filter (case-insensitive match highlights the chip). */
  currentValue: string;
  onClose: () => void;
  /**
   * Called with the raw type label when the marketer taps a chip. Caller
   * is responsible for filling its `textQuery` state and (typically)
   * firing the actual search.
   */
  onPick: (type: string) => void;
}

/**
 * Full directory of prospect categories, presented as a searchable
 * categorized chip grid. Used as the "More…" escape hatch from the
 * inline quick-tap chips on the Generate Opportunities tab.
 *
 * Mobile-first: full-screen on small viewports, overscroll-contained so
 * iOS Safari rubber-band scrolling can't pull the underlying page.
 */
export function FilterTypeDialog({ open, currentValue, onClose, onPick }: FilterTypeDialogProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [search, setSearch] = useState('');

  const trimmed = search.trim().toLowerCase();
  const currentNorm = currentValue.trim().toLowerCase();

  // Filter sections by search term. Whole sections drop out when nothing
  // matches so the marketer doesn't scroll past empty headers.
  const sections = useMemo(() => {
    if (!trimmed) return FILTER_TYPE_CATEGORIES;
    return FILTER_TYPE_CATEGORIES.map((section) => ({
      name: section.name,
      types: section.types.filter((t) => t.toLowerCase().includes(trimmed)),
    })).filter((section) => section.types.length > 0);
  }, [trimmed]);

  const totalCount = useMemo(
    () => FILTER_TYPE_CATEGORIES.reduce((sum, section) => sum + section.types.length, 0),
    [],
  );

  const handlePick = (type: string) => {
    onPick(type);
    setSearch('');
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        setSearch('');
        onClose();
      }}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
      PaperProps={{
        sx: {
          borderRadius: { xs: 0, sm: 3 },
          // Prevent iOS Safari rubber-band from scrolling the underlying
          // Opportunities page while the marketer is browsing categories.
          overscrollBehavior: 'contain',
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1, pb: 1 }}>
        <FilterIcon fontSize="small" />
        <Typography variant="h6" sx={{ flex: 1, fontWeight: 600 }}>
          All filters
        </Typography>
        <IconButton onClick={onClose} aria-label="Close" size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: { xs: 1.5, sm: 2 } }}>
        <TextField
          fullWidth
          size="small"
          autoFocus={!isMobile}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${totalCount} filters…`}
          sx={{ mb: 2 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  aria-label="Clear search"
                  onClick={() => setSearch('')}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
        />

        {sections.length === 0 ? (
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
            No filters match “{search.trim()}”.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {sections.map((section) => (
              <Box key={section.name}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: 'block',
                    mb: 1,
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                    fontSize: '0.7rem',
                    fontWeight: 700,
                  }}
                >
                  {section.name}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {section.types.map((type) => {
                    const isActive = type.toLowerCase() === currentNorm;
                    return (
                      <Chip
                        key={type}
                        label={type}
                        size="small"
                        variant={isActive ? 'filled' : 'outlined'}
                        color={isActive ? 'primary' : 'default'}
                        onClick={() => handlePick(type)}
                        sx={{
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          height: 'auto',
                          py: 0.6,
                          '& .MuiChip-label': {
                            whiteSpace: 'normal',
                            lineHeight: 1.3,
                            px: 1.25,
                          },
                        }}
                      />
                    );
                  })}
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
