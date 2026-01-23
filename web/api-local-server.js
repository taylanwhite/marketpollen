// Local development server for API routes
// Run with: node api-local-server.js
// Then use: http://localhost:3001/api/chat-completion

import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { Resend } from 'resend';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const envPath = join(__dirname, '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn('Warning: Could not load .env file:', result.error.message);
} else {
  console.log('✓ Environment variables loaded from:', envPath);
}

// Log environment variable status (without exposing the key)
console.log('GOOGLE_PLACES_API_KEY:', process.env.GOOGLE_PLACES_API_KEY ? '✓ Set' : '✗ Not set');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Not set');
console.log('RESEND_API_KEY:', process.env.RESEND_API_KEY ? '✓ Set' : '✗ Not set');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// OpenAI API route
app.post('/api/chat-completion', async (req, res) => {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  
  if (!openaiApiKey) {
    return res.status(500).json({ 
      error: 'OPENAI_API_KEY is not configured. Please set it in your .env file.' 
    });
  }

  const openai = new OpenAI({ apiKey: openaiApiKey });

  // Verify authentication token is present
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - Authentication required' });
  }

  try {
    const { messages, temperature, maxTokens, jsonMode } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ 
        error: 'Messages array is required and must not be empty' 
      });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens,
      response_format: jsonMode ? { type: 'json_object' } : undefined,
    });

    const content = response.choices[0]?.message?.content || '';

    return res.status(200).json({
      content,
      usage: response.usage,
    });
  } catch (error) {
    console.error('OpenAI API Error:', error);
    return res.status(500).json({ 
      error: `AI completion failed: ${error.message || 'Unknown error'}` 
    });
  }
});

// Email sending route
app.post('/api/send-invite-email', async (req, res) => {
  const resendApiKey = process.env.RESEND_API_KEY;
  
  if (!resendApiKey) {
    return res.status(500).json({ 
      error: 'RESEND_API_KEY is not configured. Please set it in your .env file.' 
    });
  }

  const resend = new Resend(resendApiKey);

  // Verify authentication token is present
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - Authentication required' });
  }

  try {
    const { email, isGlobalAdmin, invitedByEmail } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ 
        error: 'Email address is required' 
      });
    }

    const appUrl = process.env.VITE_APP_URL || 'http://localhost:5173';
    const signupUrl = `${appUrl}/signup?email=${encodeURIComponent(email)}`;

    // Resend provides onboarding@resend.dev as a default sender (no domain verification needed)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'Bundt Marketer <onboarding@resend.dev>';
    
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: 'You\'re Invited to Bundt Marketer',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 32px;">🎂 Bundt Marketer</h1>
            </div>
            <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
              <h2 style="color: #667eea; margin-top: 0;">You're Invited!</h2>
              <p>You've been invited to join Bundt Marketer${isGlobalAdmin ? ' as a Global Administrator' : ''}.</p>
              ${invitedByEmail ? `<p><strong>Invited by:</strong> ${invitedByEmail}</p>` : ''}
              <p>Click the button below to create your account and get started:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${signupUrl}" 
                   style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                          color: white; 
                          padding: 15px 30px; 
                          text-decoration: none; 
                          border-radius: 5px; 
                          display: inline-block; 
                          font-weight: bold;
                          font-size: 16px;">
                  Accept Invitation & Sign Up
                </a>
              </div>
              <p style="color: #666; font-size: 14px; margin-top: 30px;">
                Or copy and paste this link into your browser:<br>
                <a href="${signupUrl}" style="color: #667eea; word-break: break-all;">${signupUrl}</a>
              </p>
              <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
              <p style="color: #666; font-size: 12px; margin: 0;">
                This invitation was sent by Bundt Marketer. If you didn't expect this email, you can safely ignore it.
              </p>
            </div>
          </body>
        </html>
      `,
      text: `
You've been invited to join Bundt Marketer${isGlobalAdmin ? ' as a Global Administrator' : ''}.

${invitedByEmail ? `Invited by: ${invitedByEmail}\n\n` : ''}Click the link below to create your account:

${signupUrl}

This invitation was sent by Bundt Marketer. If you didn't expect this email, you can safely ignore it.
      `.trim(),
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(500).json({ 
        error: `Failed to send email: ${error.message || 'Unknown error'}` 
      });
    }

    return res.status(200).json({ 
      success: true, 
      messageId: data?.id 
    });
  } catch (error) {
    console.error('Email sending error:', error);
    return res.status(500).json({ 
      error: `Failed to send email: ${error.message || 'Unknown error'}` 
    });
  }
});

// Google Places Autocomplete route
app.post('/api/places-autocomplete', async (req, res) => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY is missing. Checked env file at:', join(__dirname, '.env'));
    console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('GOOGLE') || k.includes('PLACES')));
    return res.status(500).json({ 
      error: 'GOOGLE_PLACES_API_KEY is not configured. Please set it in your .env file in the web directory.' 
    });
  }

  // Verify authentication token is present
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - Authentication required' });
  }

  try {
    const { input, sessionToken } = req.body;

    if (!input || typeof input !== 'string' || input.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Input is required and must not be empty' 
      });
    }

    // Call Google Places API (New) - Autocomplete
    // Documentation: https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
    const url = 'https://places.googleapis.com/v1/places:autocomplete';
    
    const requestBody = {
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

    return res.status(200).json(response.data);
  } catch (error) {
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
});

// Google Places Details route
app.post('/api/places-details', async (req, res) => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY is missing. Checked env file at:', join(__dirname, '.env'));
    return res.status(500).json({ 
      error: 'GOOGLE_PLACES_API_KEY is not configured. Please set it in your .env file in the web directory.' 
    });
  }

  // Verify authentication token is present
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - Authentication required' });
  }

  try {
    const { placeId, sessionToken } = req.body;

    if (!placeId || typeof placeId !== 'string') {
      return res.status(400).json({ 
        error: 'Place ID is required' 
      });
    }

    // Call Google Places API (New) - Get Place Details
    // Documentation: https://developers.google.com/maps/documentation/places/web-service/place-details
    const url = `https://places.googleapis.com/v1/places/${placeId}`;
    
    const headers = {
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

    return res.status(200).json(response.data);
  } catch (error) {
    console.error('Places Details Error:', error);
    if (axios.isAxiosError(error)) {
      const status = error.response?.status || 500;
      const errorMessage = error.response?.data?.error || error.message || 'Unknown error';
      return res.status(status).json({ 
        error: `Get place details failed: ${errorMessage}` 
      });
    }
    return res.status(500).json({ 
      error: `Get place details failed: ${error.message || 'Unknown error'}` 
    });
  }
});

// Import and proxy the new API endpoints
// Note: These are TypeScript files, so we'll need to handle them differently
// For now, we'll add basic proxy routes that can be enhanced later

// Proxy route for create-contact-from-call
app.post('/api/create-contact-from-call', async (req, res) => {
  try {
    // Import the handler dynamically (requires tsx or ts-node for TypeScript)
    // For now, we'll return a helpful error message
    res.status(501).json({ 
      error: 'This endpoint requires Vercel serverless functions. Use "vercel dev" or deploy to Vercel for full functionality.',
      note: 'For local testing with ngrok, use "vercel dev" which will handle TypeScript serverless functions.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Proxy route for get-calendar-events
app.post('/api/get-calendar-events', async (req, res) => {
  try {
    res.status(501).json({ 
      error: 'This endpoint requires Vercel serverless functions. Use "vercel dev" or deploy to Vercel for full functionality.',
      note: 'For local testing with ngrok, use "vercel dev" which will handle TypeScript serverless functions.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Local API server running on http://localhost:${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  - http://localhost:${PORT}/api/chat-completion`);
  console.log(`  - http://localhost:${PORT}/api/send-invite-email`);
  console.log(`  - http://localhost:${PORT}/api/places-autocomplete`);
  console.log(`  - http://localhost:${PORT}/api/places-details`);
  console.log(`  - http://localhost:${PORT}/api/create-contact-from-call (requires vercel dev)`);
  console.log(`  - http://localhost:${PORT}/api/get-calendar-events (requires vercel dev)`);
  console.log(`\nNote: New endpoints require "vercel dev" for TypeScript support.`);
});
