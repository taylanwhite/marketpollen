// OpenAI API calls are made through Vercel serverless function
// The API key is stored server-side and never exposed to the client
import { getAuth } from 'firebase/auth';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Chat completion helper - calls Vercel serverless function
 */
async function chatCompletion(
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
  }
): Promise<string> {
  // Get current user's ID token for authentication
  const currentUser = getAuth().currentUser;
  if (!currentUser) {
    throw new Error('User must be authenticated to use AI features');
  }

  const idToken = await currentUser.getIdToken();
  
  try {
    const response = await fetch('/api/chat-completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`, // Pass auth token for verification
      },
      body: JSON.stringify({
        messages,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        jsonMode: options?.jsonMode,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'AI completion failed');
    }

    const data = await response.json();
    return data.content || '';
  } catch (error: any) {
    console.error('OpenAI API Error:', error);
    throw new Error(`AI completion failed: ${error.message}`);
  }
}

/**
 * Extract structured contact information from voice transcript
 */
export async function extractContactInfo(transcript: string): Promise<{
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  personalDetails?: string;
  reachoutNote: string;
  suggestedFollowUpDays: number;
}> {
  const systemPrompt = `You are an AI assistant that extracts contact information from voice transcripts.
Extract the following information and return it as JSON:
- firstName: person's first name
- lastName: person's last name  
- email: email address
- phone: phone number (formatted as (XXX) XXX-XXXX if 10 digits)
- address: street address
- city: city name
- state: state abbreviation (2 letters, e.g., CA, NY)
- zipCode: 5-digit zip code
- personalDetails: any personal information mentioned (hobbies, family, interests, preferences, etc.) in a friendly sentence
- reachoutNote: a summary of what was discussed or why this contact is important
- suggestedFollowUpDays: suggest number of days until next follow-up (typically 2-7 days)

If information is not mentioned, omit that field. Return valid JSON only.`;

  const response = await chatCompletion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Extract contact info from this transcript: "${transcript}"` }
    ],
    { jsonMode: true, temperature: 0.3 }
  );

  return JSON.parse(response);
}

/**
 * Generate intelligent follow-up suggestion based on contact history
 */
export async function generateFollowUpSuggestion(contact: {
  firstName?: string;
  lastName?: string;
  reachouts: Array<{ date: Date; note: string; type: string }>;
  personalDetails?: string;
  status?: string;
}): Promise<{
  suggestedDays: number;
  message: string;
  priority: 'low' | 'medium' | 'high';
}> {
  const name = contact.firstName || 'the contact';
  const reachoutHistory = contact.reachouts
    .slice(-3) // Last 3 reachouts
    .map(r => `${r.date.toLocaleDateString()}: ${r.note}`)
    .join('\n');

  const systemPrompt = `You are a sales/relationship manager AI. Based on contact history, suggest the next follow-up.
Return JSON with:
- suggestedDays: number of days until next follow-up (1-14)
- message: brief suggestion of what to discuss (reference personal details if available)
- priority: "low", "medium", or "high"

Consider:
- More recent contacts = longer wait
- Show interest = higher priority
- Personal details = personalized follow-up suggestions`;

  const userPrompt = `Contact: ${name}
Status: ${contact.status || 'new'}
Personal Details: ${contact.personalDetails || 'none'}

Recent Reachouts:
${reachoutHistory || 'No previous reachouts'}

Suggest next follow-up:`;

  const response = await chatCompletion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    { jsonMode: true, temperature: 0.7, maxTokens: 200 }
  );

  return JSON.parse(response);
}
