import { getAuth } from 'firebase/auth';
import axios from 'axios';

/**
 * Call Google Places Autocomplete API via serverless function
 */
export async function autocompletePlaces(input: string, sessionToken?: string) {
  const auth = getAuth();
  const user = auth.currentUser;
  
  if (!user) {
    throw new Error('User must be authenticated');
  }

  const token = await user.getIdToken();

  try {
    const response = await axios.post('/api/places-autocomplete', 
      { input, sessionToken },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    return response.data;
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data?.error || error.message || 'Failed to get autocomplete suggestions';
      throw new Error(errorMessage);
    }
    throw new Error('Failed to get autocomplete suggestions');
  }
}

/**
 * Get place details from Google Places API via serverless function
 */
export async function getPlaceDetails(placeId: string, sessionToken?: string) {
  const auth = getAuth();
  const user = auth.currentUser;
  
  if (!user) {
    throw new Error('User must be authenticated');
  }

  const token = await user.getIdToken();

  try {
    const response = await axios.post('/api/places-details',
      { placeId, sessionToken },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    return response.data;
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data?.error || error.message || 'Failed to get place details';
      throw new Error(errorMessage);
    }
    throw new Error('Failed to get place details');
  }
}
