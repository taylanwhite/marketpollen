import { Box, IconButton, Typography, Stack } from '@mui/material';
import { Add as AddIcon, Remove as RemoveIcon } from '@mui/icons-material';
import { DonationData, CampaignProduct, SLUG_TO_FIELD } from '../types';
import { haptics } from '../utils/haptics';

interface DonationProductFieldsProps {
  products: CampaignProduct[];
  donationData: DonationData;
  onChange: (updated: DonationData) => void;
}

/**
 * One-tap +/− stepper rows for each active product. Designed for field use:
 * 48px touch targets, no typing required, immediate visual feedback when a
 * product has been given out.
 */
export function DonationProductFields({ products, donationData, onChange }: DonationProductFieldsProps) {
  const setValue = (product: CampaignProduct, value: number) => {
    const next = Math.max(0, value);
    haptics.tap();
    const field = SLUG_TO_FIELD[product.slug];
    if (field) {
      onChange({ ...donationData, [field]: next });
    } else {
      const customItems = { ...(donationData.customItems || {}) };
      if (next === 0) {
        delete customItems[product.id];
      } else {
        customItems[product.id] = next;
      }
      onChange({
        ...donationData,
        customItems: Object.keys(customItems).length > 0 ? customItems : undefined,
      });
    }
  };

  const getValue = (product: CampaignProduct): number => {
    const field = SLUG_TO_FIELD[product.slug];
    if (field) return (donationData[field] as number) || 0;
    return donationData.customItems?.[product.id] || 0;
  };

  const activeProducts = products.filter((p) => p.isActive);

  return (
    <Stack spacing={0.5}>
      {activeProducts.map((product) => {
        const count = getValue(product);
        const active = count > 0;
        return (
          <Box
            key={product.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              py: 0.75,
              px: 1.5,
              borderRadius: 2,
              bgcolor: active ? 'rgba(245, 200, 66, 0.15)' : 'transparent',
              border: '1px solid',
              borderColor: active ? 'rgba(245, 200, 66, 0.5)' : 'rgba(0,0,0,0.08)',
              transition: 'background-color 0.15s ease, border-color 0.15s ease',
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: active ? 600 : 500,
                  color: '#2d2d2d',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {product.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {product.mouthValue} mouth{product.mouthValue !== 1 ? 's' : ''} each
                {count > 0 && ` · ${count * product.mouthValue} mouths`}
              </Typography>
            </Box>

            <IconButton
              size="small"
              onClick={() => setValue(product, count - 1)}
              disabled={count === 0}
              sx={{
                width: 36,
                height: 36,
                border: '1px solid',
                borderColor: 'rgba(0,0,0,0.15)',
                '&.Mui-disabled': { opacity: 0.3 },
              }}
              aria-label={`Decrease ${product.name}`}
            >
              <RemoveIcon fontSize="small" />
            </IconButton>

            <Box
              sx={{
                minWidth: 32,
                textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <Typography
                variant="body1"
                sx={{
                  fontWeight: 700,
                  color: active ? '#2d2d2d' : 'text.secondary',
                  fontSize: '1.1rem',
                }}
              >
                {count}
              </Typography>
            </Box>

            <IconButton
              size="small"
              onClick={() => setValue(product, count + 1)}
              sx={{
                width: 40,
                height: 40,
                bgcolor: active ? '#f5c842' : 'rgba(0,0,0,0.04)',
                color: '#2d2d2d',
                border: '1px solid',
                borderColor: active ? '#f5c842' : 'rgba(0,0,0,0.15)',
                '&:hover': {
                  bgcolor: active ? '#e8b923' : 'rgba(245, 200, 66, 0.2)',
                },
              }}
              aria-label={`Add one ${product.name}`}
            >
              <AddIcon />
            </IconButton>
          </Box>
        );
      })}
    </Stack>
  );
}
