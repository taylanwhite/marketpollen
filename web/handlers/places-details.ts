import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

interface RequestBody {
  placeId: string;
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
    const { placeId, sessionToken }: RequestBody = req.body;

    // Validate request
    if (!placeId || typeof placeId !== 'string') {
      return res.status(400).json({ 
        error: 'Place ID is required' 
      });
    }

    // Call Google Places API (New) - Get Place Details
    // Documentation: https://developers.google.com/maps/documentation/places/web-service/place-details
    const url = `https://places.googleapis.com/v1/places/${placeId}`;

    const headers: any = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,addressComponents,location',
    };

    // Add sessionToken to header if provided (for billing optimization)
    if (sessionToken) {
      headers['X-Goog-Session-Token'] = sessionToken;
    }

    const response = await axios.get(url, {
      headers,
    });

    const data = response.data;

    return res.status(200).json(data);
  } catch (error: any) {
    console.error('Places Details Error:', error);
    if (axios.isAxiosError(error)) {
      const status = error.response?.status || 500;
      const errorData = error.response?.data;
      const errorMessage = errorData?.error?.message || errorData?.error || error.message || 'Unknown error';
      console.error('Places API Error Details:', JSON.stringify(errorData, null, 2));
      return res.status(status).json({ 
        error: `Get place details failed: ${errorMessage}` 
      });
    }
    return res.status(500).json({ 
      error: `Get place details failed: ${error.message || 'Unknown error'}` 
    });
  }
}
