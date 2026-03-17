import { api } from '../api/client';

/**
 * Call Google Places Autocomplete API via serverless function.
 * Auth token is automatically attached by the api client.
 */
export async function autocompletePlaces(input: string, sessionToken?: string) {
  try {
    const response = await api.post<any>('/places-autocomplete', { input, sessionToken });
    return response;
  } catch (error: any) {
    throw new Error(error.message || 'Failed to get autocomplete suggestions');
  }
}

/**
 * Get place details from Google Places API via serverless function.
 * Auth token is automatically attached by the api client.
 */
export async function getPlaceDetails(placeId: string, sessionToken?: string) {
  try {
    const response = await api.post<any>('/places-details', { placeId, sessionToken });
    return response;
  } catch (error: any) {
    throw new Error(error.message || 'Failed to get place details');
  }
}
