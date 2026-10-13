import { useState } from 'react';
import {
  Box,
  Collapse,
  FormControlLabel,
  ListSubheader,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { Business as BusinessIcon } from '@mui/icons-material';
import {
  knownOrganizationTypes,
  organizationTypeSections,
  type ContactProfileExtras,
  type CorporateAccountFields,
} from '../utils/organizationTypes';

export function ContactProfileFields({
  value,
  onChange,
  disabled = false,
}: {
  value: ContactProfileExtras;
  onChange: (next: ContactProfileExtras) => void;
  disabled?: boolean;
}) {
  const sections = organizationTypeSections();
  const known = new Set(knownOrganizationTypes().map((type) => type.toLowerCase()));
  const custom = value.organizationType.trim() !== '' && !known.has(value.organizationType.trim().toLowerCase());
  const [otherMode, setOtherMode] = useState(false);
  const showOther = otherMode || custom;
  const selectValue = showOther ? '__other__' : value.organizationType;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        select
        label="Organization type"
        value={selectValue}
        onChange={(event) => {
          const next = event.target.value;
          if (next === '__other__') {
            setOtherMode(true);
            if (!custom) onChange({ organizationType: '' });
            return;
          }
          setOtherMode(false);
          onChange({ organizationType: next });
        }}
        fullWidth
        disabled={disabled}
        helperText="Kind of company or organization"
      >
        <MenuItem value="">Select a type</MenuItem>
        {sections.flatMap((section) => [
          <ListSubheader key={section.name}>{section.name}</ListSubheader>,
          ...section.types.map((type) => (
            <MenuItem key={type} value={type}>{type}</MenuItem>
          )),
        ])}
        <MenuItem value="__other__">Other</MenuItem>
      </TextField>
      {showOther && (
        <TextField
          label="Other organization type"
          value={value.organizationType}
          onChange={(event) => onChange({ organizationType: event.target.value })}
          fullWidth
          disabled={disabled}
        />
      )}
    </Box>
  );
}

export function CorporateAccountEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: CorporateAccountFields;
  onChange: (next: CorporateAccountFields) => void;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <FormControlLabel
        control={
          <Switch
            checked={value.isCorporateAccount}
            onChange={(event) => {
              const on = event.target.checked;
              onChange({
                ...value,
                isCorporateAccount: on,
                corporateStatus: on ? (value.corporateStatus || 'active') : value.corporateStatus,
              });
            }}
            disabled={disabled}
          />
        }
        label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <BusinessIcon fontSize="small" />
            <Typography>Corporate account</Typography>
          </Box>
        }
      />
      <Collapse in={value.isCorporateAccount}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Tax exempt #"
            value={value.taxExemptNumber}
            onChange={(event) => onChange({ ...value, taxExemptNumber: event.target.value })}
            fullWidth
            disabled={disabled}
          />
          <TextField
            label="Card on file (last 4)"
            value={value.cardOnFileLast4}
            onChange={(event) => onChange({ ...value, cardOnFileLast4: event.target.value.replace(/\D/g, '').slice(-4) })}
            fullWidth
            disabled={disabled}
            helperText="Last 4 digits only. Full card numbers are not saved."
            slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 4, autoComplete: 'off' } }}
          />
          <TextField
            select
            label="Status"
            value={value.corporateStatus === 'inactive' ? 'inactive' : 'active'}
            onChange={(event) => onChange({ ...value, corporateStatus: event.target.value })}
            fullWidth
            disabled={disabled}
          >
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
          </TextField>
        </Box>
      </Collapse>
    </Box>
  );
}
