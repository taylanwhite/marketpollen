// Local development server for API routes
// Run with: node api-local-server.js
// Then use: http://localhost:3001/api/chat-completion

import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '.env') });

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

app.listen(PORT, () => {
  console.log(`Local API server running on http://localhost:${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  - http://localhost:${PORT}/api/chat-completion`);
  console.log(`  - http://localhost:${PORT}/api/send-invite-email`);
});
