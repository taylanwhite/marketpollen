import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

interface RequestBody {
  input: string;
  sessionToken?: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify user is authenticated
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - Authentication required' });
  }

  // Verify Google Places API key is configured
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY is not configured');
    return res.status(500).json({ 
      error: 'Google Places API key is not configured. Please set GOOGLE_PLACES_API_KEY environment variable.' 
    });
  }

  try {
    const { input, sessionToken }: RequestBody = req.body;

    // Validate request
    if (!input || typeof input !== 'string' || input.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Input is required and must not be empty' 
      });
    }

    // Call Google Places API (New) - Autocomplete
    // Documentation: https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
    const url = 'https://places.googleapis.com/v1/places:autocomplete';

    const requestBody: any = {
      input, // Required: The text string on which to search
      includedRegionCodes: ['us'], // Optional: Limit results to US (up to 15 country codes)
      regionCode: 'us', // Optional: Region code for formatting and biasing suggestions
    };

    if (sessionToken) {
      requestBody.sessionToken = sessionToken; // Optional: For billing optimization
    }

    const response = await axios.post(url, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
      },
    });

    const data = response.data;

    return res.status(200).json(data);
  } catch (error: any) {
    console.error('Places Autocomplete Error:', error);
    if (axios.isAxiosError(error)) {
      const status = error.response?.status || 500;
      const errorData = error.response?.data;
      
      // Log the full error for debugging
      console.error('Request URL:', error.config?.url);
      console.error('Request Body:', error.config?.data);
      console.error('Response Status:', status);
      console.error('Response Data:', JSON.stringify(errorData, null, 2));
      
      // Extract error message properly
      let errorMessage = 'Unknown error';
      if (errorData) {
        if (typeof errorData === 'string') {
          errorMessage = errorData;
        } else if (errorData.error) {
          if (typeof errorData.error === 'string') {
            errorMessage = errorData.error;
          } else if (errorData.error.message) {
            errorMessage = errorData.error.message;
          } else {
            errorMessage = JSON.stringify(errorData.error);
          }
        } else {
          errorMessage = JSON.stringify(errorData);
        }
      } else {
        errorMessage = error.message || 'Unknown error';
      }
      
      return res.status(status).json({ 
        error: `Autocomplete failed: ${errorMessage}` 
      });
    }
    return res.status(500).json({ 
      error: `Autocomplete failed: ${error.message || 'Unknown error'}` 
    });
  }
}
