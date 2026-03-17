import { useEffect, useRef, useState, useCallback } from 'react';
import { TextField, CircularProgress, Autocomplete, SxProps, Theme } from '@mui/material';
import { autocompletePlaces, getPlaceDetails } from '../utils/placesApi';

export interface AddressData {
  address: string;
  city: string;
  state: string;
  zipCode: string;
}

interface AddressPickerProps {
  value: AddressData;
  onChange: (address: AddressData) => void;
  label?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  helperText?: string;
  size?: 'small' | 'medium';
  sx?: SxProps<Theme>;
}

interface PlacePrediction {
  placeId: string;
  description: string;
}

export function AddressPicker({
  value,
  onChange,
  label = 'Address',
  fullWidth = true,
  disabled = false,
  required = false,
  error = false,
  helperText,
  size = 'small',
  sx,
}: AddressPickerProps) {
  const [inputValue, setInputValue] = useState(value.address);
  const [options, setOptions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | undefined>();
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const generateSessionToken = useCallback(() => {
    return `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }, []);

  useEffect(() => {
    setSessionToken(generateSessionToken());
  }, [generateSessionToken]);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!inputValue || inputValue.trim().length < 3) {
      setOptions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceTimerRef.current = setTimeout(async () => {
      try {
        const response = await autocompletePlaces(inputValue, sessionToken);

        const predictions: PlacePrediction[] = (response.suggestions || []).map((suggestion: any) => {
          const prediction = suggestion.placePrediction || suggestion;
          return {
            placeId: prediction.placeId || prediction.place_id || '',
            description: prediction.text?.text || prediction.description || prediction.formatted_address || '',
          };
        }).filter((p: PlacePrediction) => p.placeId && p.description);

        setOptions(predictions);
      } catch (err: any) {
        console.error('Autocomplete error:', err);
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [inputValue, sessionToken]);

  const handlePlaceSelect = async (placeId: string) => {
    try {
      setLoading(true);
      const placeDetails = await getPlaceDetails(placeId, sessionToken);

      const addressComponents = placeDetails.addressComponents || [];

      let streetNumber = '';
      let route = '';
      let city = '';
      let state = '';
      let zipCode = '';

      addressComponents.forEach((component: any) => {
        const types = component.types || [];
        if (types.includes('street_number')) {
          streetNumber = component.longText || component.long_name || '';
        } else if (types.includes('route')) {
          route = component.longText || component.long_name || '';
        } else if (types.includes('locality')) {
          city = component.longText || component.long_name || '';
        } else if (types.includes('administrative_area_level_1')) {
          state = component.shortText || component.short_name || '';
        } else if (types.includes('postal_code')) {
          zipCode = component.longText || component.long_name || '';
        }
      });

      const address = [streetNumber, route].filter(Boolean).join(' ').trim()
        || placeDetails.formattedAddress || placeDetails.formatted_address || '';

      onChange({ address, city, state, zipCode });
      setInputValue(address);
      setSessionToken(generateSessionToken());
    } catch (err: any) {
      console.error('Error getting place details:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (value.address !== inputValue) {
      setInputValue(value.address);
    }
  }, [value.address]);

  return (
    <Autocomplete
      freeSolo
      options={options}
      getOptionLabel={(option) =>
        typeof option === 'string' ? option : option.description || ''
      }
      isOptionEqualToValue={(option, val) => option.placeId === val.placeId}
      filterOptions={(x) => x}
      inputValue={inputValue}
      onInputChange={(_, newInputValue) => {
        setInputValue(newInputValue);
        onChange({ ...value, address: newInputValue });
      }}
      onChange={(_, newValue) => {
        if (newValue && typeof newValue !== 'string') {
          handlePlaceSelect(newValue.placeId);
        }
      }}
      loading={loading}
      disabled={disabled}
      sx={sx}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          fullWidth={fullWidth}
          required={required}
          error={error}
          size={size}
          helperText={helperText}
          slotProps={{
            input: {
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? <CircularProgress size={18} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
    />
  );
}
