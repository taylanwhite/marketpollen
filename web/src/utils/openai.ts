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
  donation?: {
    freeBundletCard?: number;
    dozenBundtinis?: number;
    cake8inch?: number;
    cake10inch?: number;
    sampleTray?: number;
    bundtletTower?: number;
    cakesDonatedNotes?: string;
    orderedFromUs?: boolean;
    followedUp?: boolean;
  };
}> {
  const systemPrompt = `You are an AI assistant that extracts contact information from voice transcripts for a bakery marketing program.

IMPORTANT CONTEXT:
- This is a bakery (Nothing Bundt Cake) giving away free products to businesses/contacts
- "Donations" means WE (the bakery) gave products TO the contact/business, not the other way around
- Products given away include: Bundtlet Cards, Dozen Bundtinis (12), 8" Cake (10), 10" Cake (20), Sample Tray (40), Bundtlet Tower (1 per bundtlet)

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
- reachoutNote: a clear, detailed note of what was discussed. CRITICAL: Preserve ALL important information including:
  * Orders placed (quantities, products, dates, deadlines, delivery dates)
  * Products given away (what was donated, quantities)
  * Key business information (meetings scheduled, proposals, quotes, pricing discussed)
  * Action items (what needs to happen next, who is responsible)
  * Important dates and deadlines
  * Customer sentiment and feedback
  * Any specific numbers, quantities, or amounts mentioned
  DO NOT summarize or condense - include all relevant details. If the original notes are already clear and complete, use them as-is or only make minor improvements for clarity.
- suggestedFollowUpDays: suggest number of days until next follow-up (typically 2-7 days)
- donation: (optional object) CRITICAL: Extract donation information if ANY of these phrases appear: "gave", "gave away", "gave them", "gave her", "gave him", "for free", "free", "donated", "sample", "treat", "gift", "complimentary", or any mention of products being provided at no cost. Extract:
  * freeBundletCard: number of free bundtlet cards given (look for "bundtlet card", "card")
  * dozenBundtinis: number of dozen bundtinis given (look for "dozen bundtinis", "12 bundtinis", "bundtinis" - each dozen = 12)
  * cake8inch: number of 8" cakes given (look for "8 inch", "8\"", "8 inch cake")
  * cake10inch: number of 10" cakes given (look for "10 inch", "10\"", "10 inch cake")
  * sampleTray: number of sample trays given (look for "sample tray", "tray")
  * bundtletTower: number of bundtlets in a tower given (look for "tower", "bundtlet tower")
  * cakesDonatedNotes: any notes about what was donated, including quantities and types if not captured above (e.g., "gave her two more bundt cakes" should be noted here if exact type unclear)
  * orderedFromUs: boolean - did they place an order with us? Look for "ordering", "ordered", "order", "purchased", "buying" (default false)
  * followedUp: boolean - did we follow up? Look for "followed up", "follow up", "called back", "reached out" (default false)
  
  IMPORTANT: If someone mentions "gave her two bundt cakes" or similar, extract this even if the exact product type isn't specified. Use cakesDonatedNotes to capture the details, and if it's unclear whether it's 8" or 10", you can estimate or note it in cakesDonatedNotes.

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
 * Returns specific date and recommended method (email, call, meeting, text)
 */
export async function generateFollowUpSuggestion(contact: {
  firstName?: string;
  lastName?: string;
  reachouts: Array<{ date: Date; note: string; type: string; donation?: any }>;
  personalDetails?: string;
  status?: string;
  email?: string;
  phone?: string;
}): Promise<{
  suggestedDate: string; // ISO date string
  suggestedMethod: 'email' | 'call' | 'meeting' | 'text';
  message: string;
  priority: 'low' | 'medium' | 'high';
  reason?: string;
}> {
  const fullName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'the contact';
  // Check if any donations occurred
  const hasDonations = contact.reachouts.some(r => r.donation);
  const lastDonation = contact.reachouts
    .slice()
    .reverse()
    .find(r => r.donation);
  
  const reachoutHistory = contact.reachouts
    .slice(-5) // Last 5 reachouts for better context
    .map(r => {
      const date = r.date instanceof Date ? r.date.toLocaleDateString() : new Date(r.date).toLocaleDateString();
      const donationInfo = r.donation ? ` [DONATION: ${JSON.stringify(r.donation)}]` : '';
      return `${date} [${r.type}]: ${r.note}${donationInfo}`;
    })
    .join('\n');

  const now = new Date();
  const lastReachout = contact.reachouts.length > 0 
    ? (contact.reachouts[contact.reachouts.length - 1].date instanceof Date 
        ? contact.reachouts[contact.reachouts.length - 1].date 
        : new Date(contact.reachouts[contact.reachouts.length - 1].date))
    : null;
  const daysSinceLastContact = lastReachout 
    ? Math.floor((now.getTime() - lastReachout.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const systemPrompt = `You are an expert sales and relationship management AI for "Nothing Bundt Cake". Analyze contact history and suggest the optimal follow-up strategy.

IMPORTANT CONTEXT:
- "Donations" in this system refer to PRODUCTS GIVEN AWAY BY YOUR BUSINESS TO THE CONTACT (bundtinis, cakes, etc.)
- Donations are marketing giveaways to build relationships and generate business
- When a donation occurred, you should follow up to:
  * Check if they enjoyed the products
  * See if it led to any business opportunities or orders
  * Build on the relationship that was started with the donation
  * NOT thank them for donating (they received a gift from you, not the other way around)

CRITICAL CONSTRAINTS:
- You CANNOT suggest "email" if the contact has no email address
- You CANNOT suggest "call" or "text" if the contact has no phone number
- If no email or phone is available, you MUST suggest "meeting" or "other"
- If a donation was given (products given to contact), this is a HIGH PRIORITY follow-up - suggest follow-up within 1-3 days to check satisfaction and explore business opportunities
- Donations indicate strong engagement - consider suggesting a meeting or call to discuss results and future opportunities

Return JSON with:
- suggestedDate: ISO date string (YYYY-MM-DD) for the recommended follow-up date (MUST be at least 1 day in the future, never same day)
- suggestedMethod: one of "email", "call", "meeting", "text", or "other" - MUST match available contact methods:
  * email: ONLY if contact has email address - for informational follow-ups, sending resources
  * call: ONLY if contact has phone number - for urgent matters, complex discussions, personal touch
  * meeting: Always available - for demos, proposals, closing discussions, strong interest, or when no contact info available
  * text: ONLY if contact has phone number - for quick check-ins, casual follow-ups
  * other: Fallback if no contact methods available
- message: personalized suggestion of what to discuss or send (reference personal details, recent interactions, donations, and context)
- priority: "low", "medium", or "high" based on urgency and opportunity
- reason: brief explanation of why this method and date were chosen (optional)

Guidelines:
- MINIMUM FOLLOW-UP: NEVER suggest same-day follow-up. Minimum is 1 day in the future (tomorrow at earliest)
- DONATIONS: IMPORTANT - "Donations" means WE (the bakery) gave products TO the contact/business. If we gave away products, this is HIGH PRIORITY - follow up within 1-3 days (but at least tomorrow) to check if they enjoyed the products and see if they're interested in ordering. DO NOT thank them for donating - we donated TO them.
- New contacts (0-1 reachouts): Suggest follow-up in 2-3 days (minimum 1 day)
- Active contacts (2-4 reachouts): Suggest follow-up in 3-7 days
- Engaged contacts (5+ reachouts or recent donations): Suggest follow-up in 1-5 days (minimum 1 day), consider meeting if interest is high
- If last contact was >7 days ago: Higher priority, but still minimum 1 day
- If contact mentioned interest/demo/proposal: Suggest meeting within 1-3 days (minimum 1 day)
- If contact has personal details: Reference them in the message for personalization
- Business days: Prefer weekdays for meetings and calls
- Urgency: High priority = 1 day (minimum 1), Medium = 2-3 days, Low = 4-10 days`;

  const hasEmail = !!contact.email;
  const hasPhone = !!contact.phone;
  const availableMethods = [];
  if (hasEmail) availableMethods.push('email');
  if (hasPhone) availableMethods.push('call', 'text');
  availableMethods.push('meeting', 'other'); // Always available
  
  const currentDateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD format
  const currentDateReadable = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const userPrompt = `TODAY'S DATE: ${currentDateReadable} (${currentDateStr})

Contact: ${fullName}
Status: ${contact.status || 'new'}
Email: ${contact.email || 'NOT PROVIDED - cannot suggest email'}
Phone: ${contact.phone || 'NOT PROVIDED - cannot suggest call or text'}
Available contact methods: ${availableMethods.join(', ')}
Personal Details: ${contact.personalDetails || 'none'}
Has donations: ${hasDonations ? 'YES - HIGH PRIORITY follow-up needed' : 'No'}
${lastDonation ? `Last donation date: ${lastDonation.date instanceof Date ? lastDonation.date.toLocaleDateString() : new Date(lastDonation.date).toLocaleDateString()}` : ''}
Days since last contact: ${daysSinceLastContact !== null ? daysSinceLastContact : 'N/A (new contact)'}

Recent Reachouts (most recent first):
${reachoutHistory || 'No previous reachouts'}

IMPORTANT: 
- TODAY is ${currentDateReadable} (${currentDateStr})
- You MUST suggest a date that is AT LEAST 1 day in the future (tomorrow at earliest)
- Only suggest methods that are available
- If a donation occurred (products given to the contact), prioritize following up to check if they enjoyed the products, see if it led to business opportunities, and continue building the relationship
- Remember: donations are gifts FROM your business TO the contact, not the other way around

Analyze this contact and suggest the optimal follow-up strategy:`;

  const response = await chatCompletion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    { jsonMode: true, temperature: 0.7, maxTokens: 300 }
  );

  const result = JSON.parse(response);
  
  // Validate suggested method against available contact info
  if (result.suggestedMethod === 'email' && !hasEmail) {
    // Fallback to meeting if email suggested but not available
    result.suggestedMethod = 'meeting';
    result.reason = (result.reason || '') + ' (Changed from email - no email available)';
  }
  
  if ((result.suggestedMethod === 'call' || result.suggestedMethod === 'text') && !hasPhone) {
    // Fallback to meeting if call/text suggested but no phone available
    result.suggestedMethod = 'meeting';
    result.reason = (result.reason || '') + ' (Changed from call/text - no phone available)';
  }
  
  // Ensure suggestedDate is a valid date and at least 1 day in the future
  const suggestedDate = new Date(result.suggestedDate);
  if (isNaN(suggestedDate.getTime())) {
    // Fallback: add 3 days if date parsing fails
    const fallbackDate = new Date(now);
    fallbackDate.setDate(fallbackDate.getDate() + 3);
    result.suggestedDate = fallbackDate.toISOString().split('T')[0];
  } else {
    // Normalize to local midnight for comparison
    const normalizedSuggested = new Date(suggestedDate.getFullYear(), suggestedDate.getMonth(), suggestedDate.getDate());
    const normalizedNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysDiff = Math.floor((normalizedSuggested.getTime() - normalizedNow.getTime()) / (1000 * 60 * 60 * 24));
    
    // Enforce minimum 1 day in the future
    if (daysDiff < 1) {
      const minDate = new Date(now);
      minDate.setDate(minDate.getDate() + 1); // Tomorrow at minimum
      result.suggestedDate = minDate.toISOString().split('T')[0];
      result.reason = (result.reason || '') + ' (Adjusted to minimum 1 day in future)';
    } else {
      result.suggestedDate = suggestedDate.toISOString().split('T')[0];
    }
  }

  return result;
}
