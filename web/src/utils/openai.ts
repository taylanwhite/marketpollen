import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true // For client-side use (consider moving to backend for production)
});

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Chat completion helper using OpenAI gpt-5-nano (cheap and fast)
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
  }
): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5-nano', // Cheap and efficient
      messages: messages,
      response_format: options?.jsonMode ? { type: 'json_object' } : undefined
    });

    return response.choices[0]?.message?.content || '';
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
