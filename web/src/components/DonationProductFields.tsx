import { TextField, Grid } from '@mui/material';
import { DonationData, CampaignProduct, SLUG_TO_FIELD } from '../types';

interface DonationProductFieldsProps {
  products: CampaignProduct[];
  donationData: DonationData;
  onChange: (updated: DonationData) => void;
}

export function DonationProductFields({ products, donationData, onChange }: DonationProductFieldsProps) {
  const handleChange = (product: CampaignProduct, value: string) => {
    const numVal = parseInt(value) || 0;
    const field = SLUG_TO_FIELD[product.slug];

    if (field) {
      onChange({ ...donationData, [field]: numVal });
    } else {
      onChange({
        ...donationData,
        customItems: { ...(donationData.customItems || {}), [product.id]: numVal },
      });
    }
  };

  const getValue = (product: CampaignProduct): number => {
    const field = SLUG_TO_FIELD[product.slug];
    if (field) return (donationData[field] as number) || 0;
    return donationData.customItems?.[product.id] || 0;
  };

  return (
    <Grid container spacing={2}>
      {products.filter(p => p.isActive).map(product => (
        <Grid key={product.id} size={{ xs: 6, sm: 4 }}>
          <TextField
            label={product.name}
            type="number"
            value={getValue(product) || ''}
            onChange={e => handleChange(product, e.target.value)}
            fullWidth
            size="small"
            slotProps={{ htmlInput: { min: 0 } }}
            helperText={`${product.mouthValue} mouth${product.mouthValue !== 1 ? 's' : ''} each`}
          />
        </Grid>
      ))}
    </Grid>
  );
}
