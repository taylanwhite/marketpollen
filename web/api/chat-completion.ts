import { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface RequestBody {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify user is authenticated (token presence check)
  // For production, you may want to verify the token with Firebase Admin SDK
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - Authentication required' });
  }

  // Verify OpenAI API key is configured
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    console.error('OPENAI_API_KEY is not configured');
    return res.status(500).json({ 
      error: 'OpenAI API key is not configured. Please set OPENAI_API_KEY environment variable.' 
    });
  }

  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: openaiApiKey,
  });

  try {
    const { messages, temperature, maxTokens, jsonMode }: RequestBody = req.body;

    // Validate request
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ 
        error: 'Messages array is required and must not be empty' 
      });
    }

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Cost-effective model
      messages: messages as any,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens,
      response_format: jsonMode ? { type: 'json_object' } : undefined,
    });

    const content = response.choices[0]?.message?.content || '';

    return res.status(200).json({
      content,
      usage: response.usage,
    });
  } catch (error: any) {
    console.error('OpenAI API Error:', error);
    return res.status(500).json({ 
      error: `AI completion failed: ${error.message || 'Unknown error'}` 
    });
  }
}
