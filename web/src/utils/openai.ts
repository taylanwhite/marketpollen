import { api } from '../api/client';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function chatCompletion(
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
  }
): Promise<string> {
  try {
    const data = await api.post<{ content: string }>('/chat-completion', {
      messages,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      jsonMode: options?.jsonMode,
    });

    return data.content || '';
  } catch (error: any) {
    console.error('OpenAI API Error:', error);
    throw new Error(`AI completion failed: ${error.message}`);
  }
}

/**
 * Extract structured contact information from voice transcript
 */
export interface ExtractProduct {
  slug: string;
  name: string;
  mouthValue: number;
}

export async function extractContactInfo(transcript: string, products?: ExtractProduct[]): Promise<{
  firstName?: string;
  lastName?: string;
  businessName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  personalDetails?: string;
  reachoutNote: string;
  reachoutType?: 'call' | 'email' | 'meeting' | 'other';
  suggestedFollowUpDays: number;
  donation?: {
    freeBundletCard?: number;
    dozenBundtinis?: number;
    cake8inch?: number;
    cake10inch?: number;
    sampleTray?: number;
    bundtletTower?: number;
    [key: string]: number | string | boolean | undefined;
    cakesDonatedNotes?: string;
    orderedFromUs?: boolean;
    followedUp?: boolean;
  };
}> {
  const productList = products && products.length > 0 ? products : [
    { slug: 'freeBundletCard', name: 'Bundtlet Card', mouthValue: 1 },
    { slug: 'dozenBundtinis', name: 'Dozen Bundtinis', mouthValue: 12 },
    { slug: 'cake8inch', name: '8" Cake', mouthValue: 10 },
    { slug: 'cake10inch', name: '10" Cake', mouthValue: 20 },
    { slug: 'sampleTray', name: 'Sample Tray', mouthValue: 40 },
    { slug: 'bundtletTower', name: 'Bundtlet/Tower', mouthValue: 1 },
  ];

  const productListDescription = productList.map(p => `${p.name} (${p.mouthValue} mouths)`).join(', ');
  const productExtractionLines = productList.map(p =>
    `  * ${p.slug}: number of "${p.name}" given (${p.mouthValue} mouths each)`
  ).join('\n');

  const systemPrompt = `You are an AI assistant that extracts contact information from voice transcripts for a bakery marketing program.

IMPORTANT CONTEXT:
- This is a bakery (Nothing Bundt Cake) giving away free products to businesses/contacts
- "Donations" means WE (the bakery) gave products TO the contact/business, not the other way around
- Available products: ${productListDescription}

Extract the following information and return it as JSON:
- firstName: person's first name
- lastName: person's last name
- businessName: the name of the business or organization the contact works at (e.g. "Lewis Bank", "Acme Corp"). Extract this from mentions like "at [business]", "from [business]", "[business] office", etc.
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
- reachoutType: how the interaction happened. Must be one of: "call" (phone call), "email" (email exchange), "meeting" (in-person visit, drop-off, face-to-face), "other" (anything else). Look for clues like "in person", "visited", "stopped by", "dropped off", "met with" → "meeting"; "called", "phone" → "call"; "emailed", "sent an email" → "email". Default to "other" if unclear.
- suggestedFollowUpDays: suggest number of days until next follow-up (typically 2-7 days)
- donation: (optional object) CRITICAL: Extract donation information if ANY of these phrases appear: "gave", "gave away", "gave them", "gave her", "gave him", "for free", "free", "donated", "sample", "treat", "gift", "complimentary", or any mention of products being provided at no cost. Extract:
${productExtractionLines}
  * cakesDonatedNotes: fill this when any donation is detected. Write a brief human-readable summary of what was given, Include context about why or for what purpose if mentioned.
  * orderedFromUs: boolean - did they place an order with us? Look for "ordering", "ordered", "order", "purchased", "buying" (default false)
  * followedUp: boolean - did we follow up? Look for "followed up", "follow up", "called back", "reached out" (default false)
  
  IMPORTANT: If someone mentions giving products but the exact type isn't clear, use your best guess to match to the closest product above, and always note the details in cakesDonatedNotes.

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
  reachouts: Array<{ date: Date; note: string; type: string; donation?: any }>;
  personalDetails?: string;
  status?: string;
  email?: string;
  phone?: string;
}): Promise<{
  suggestedDate: string;
  suggestedMethod: 'email' | 'call' | 'meeting' | 'text';
  message: string;
  priority: 'low' | 'medium' | 'high';
  reason?: string;
}> {
  const fullName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'the contact';
  const hasDonations = contact.reachouts.some(r => r.donation);
  const lastDonation = contact.reachouts
    .slice()
    .reverse()
    .find(r => r.donation);
  
  const reachoutHistory = contact.reachouts
    .slice(-5)
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

  const systemPrompt = `You are an expert sales and relationship management AI for "Nothing Bundt Cakes" bakery. Analyze the contact's history and suggest a smart, strategic follow-up plan.

CONTEXT:
- "Donations" = products WE gave TO the contact (bundtinis, cakes, sample trays, etc.) as marketing giveaways.
- When donations occurred, follow up to check if they enjoyed the products and explore ordering opportunities. Do NOT thank them for donating — we donated TO them.

CONTACT METHOD CONSTRAINTS:
- email: ONLY if contact has an email address
- call/text: ONLY if contact has a phone number
- meeting: Always available — use for in-person visits, strong interest, or when no other contact method exists

Return JSON:
- suggestedDate: YYYY-MM-DD (must be in the future, never today)
- suggestedMethod: "email" | "call" | "meeting" | "text"
- message: personalized suggestion referencing their history, personal details, and context
- priority: "low" | "medium" | "high"
- reason: brief explanation of your reasoning

FOLLOW-UP TIMING STRATEGY (use your judgment, don't always pick the minimum):
- First contact / brand new lead: 2–4 days. Give them time to settle before following up.
- Gave a donation / dropped off samples: 3–5 days. Let them try the product before asking how it went.
- Active relationship (2-4 reachouts, no strong signal): 5–10 days. Don't overwhelm them.
- Highly engaged (mentioned ordering, interest, demo): 2–3 days. Strike while the iron is hot.
- Haven't heard from them in 2+ weeks: 1–3 days. Re-engage before the relationship cools.
- Routine check-in (established relationship): 7–14 days. Maintain the relationship without being pushy.

TIMING INTELLIGENCE:
- Prefer weekdays (Mon–Fri). If the suggested date falls on a weekend, move to the following Monday.
- Avoid suggesting tomorrow for everything — spacing out follow-ups shows professionalism, not neglect.
- Consider the pattern: if the last 3 follow-ups were all within a week, space this one out more.
- If someone just ordered from us, wait 7–14 days before the next touch.
- Use 1-day follow-ups ONLY for truly urgent situations (e.g., they explicitly asked you to call back tomorrow).`;

  const hasEmail = !!contact.email;
  const hasPhone = !!contact.phone;
  const availableMethods = [];
  if (hasEmail) availableMethods.push('email');
  if (hasPhone) availableMethods.push('call', 'text');
  availableMethods.push('meeting', 'other');
  
  const currentDateStr = now.toISOString().split('T')[0];
  const currentDateReadable = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const userPrompt = `TODAY: ${currentDateReadable} (${currentDateStr})

Contact: ${fullName}
Status: ${contact.status || 'new'}
Email: ${contact.email || 'NONE'}
Phone: ${contact.phone || 'NONE'}
Available methods: ${availableMethods.join(', ')}
Personal Details: ${contact.personalDetails || 'none'}
Donation history: ${hasDonations ? 'Yes' : 'No'}${lastDonation ? ` (last: ${lastDonation.date instanceof Date ? lastDonation.date.toLocaleDateString() : new Date(lastDonation.date).toLocaleDateString()})` : ''}
Days since last contact: ${daysSinceLastContact !== null ? daysSinceLastContact : 'N/A (first interaction)'}
Total reachouts: ${contact.reachouts.length}

Recent history:
${reachoutHistory || 'No previous reachouts'}

Suggest the best follow-up date, method, and message. The date must be after today.`;

  const response = await chatCompletion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    { jsonMode: true, temperature: 0.7, maxTokens: 300 }
  );

  const result = JSON.parse(response);
  
  if (result.suggestedMethod === 'email' && !hasEmail) {
    result.suggestedMethod = 'meeting';
    result.reason = (result.reason || '') + ' (Changed from email - no email available)';
  }
  
  if ((result.suggestedMethod === 'call' || result.suggestedMethod === 'text') && !hasPhone) {
    result.suggestedMethod = 'meeting';
    result.reason = (result.reason || '') + ' (Changed from call/text - no phone available)';
  }
  
  const suggestedDate = new Date(result.suggestedDate);
  if (isNaN(suggestedDate.getTime())) {
    const fallbackDate = new Date(now);
    fallbackDate.setDate(fallbackDate.getDate() + 3);
    result.suggestedDate = fallbackDate.toISOString().split('T')[0];
  } else {
    const normalizedSuggested = new Date(suggestedDate.getFullYear(), suggestedDate.getMonth(), suggestedDate.getDate());
    const normalizedNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysDiff = Math.floor((normalizedSuggested.getTime() - normalizedNow.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysDiff < 1) {
      const minDate = new Date(now);
      minDate.setDate(minDate.getDate() + 1);
      result.suggestedDate = minDate.toISOString().split('T')[0];
      result.reason = (result.reason || '') + ' (Adjusted to minimum 1 day in future)';
    } else {
      result.suggestedDate = suggestedDate.toISOString().split('T')[0];
    }
  }

  return result;
}
