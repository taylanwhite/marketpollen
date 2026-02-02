import { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { prisma } from './lib/db.js';
import type { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

// Load environment variables from .env file (for local development)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

// Initialize Firebase Admin SDK
let adminApp: App | null = null;

function getAdminApp(): App {
  if (adminApp) {
    return adminApp;
  }

  if (!getApps().length) {
    try {
      // Try to use service account from environment variable (JSON string)
      // Note: .env files may have issues with multi-line JSON, so we'll try reading from file directly if env var is too short
      let serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
      console.log('[Firebase Admin] Checking FIREBASE_SERVICE_ACCOUNT...', serviceAccountJson ? `Found (${serviceAccountJson.length} chars)` : 'Not set');
      
      // If the value is suspiciously short (less than 100 chars), it might be a multi-line issue
      // Try reading from .env file directly
      if (!serviceAccountJson || serviceAccountJson.length < 100) {
        console.log('[Firebase Admin] Service account seems too short, trying to read from .env file directly...');
        try {
          const envFile = join(__dirname, '..', '.env');
          if (existsSync(envFile)) {
            const envContent = readFileSync(envFile, 'utf-8');
            // Match FIREBASE_SERVICE_ACCOUNT=... (handles single quotes, double quotes, or no quotes)
            // Use multiline regex to capture multi-line JSON
            const match = envContent.match(/FIREBASE_SERVICE_ACCOUNT\s*=\s*['"]?([^'"]*\{.*?\}[^'"]*)['"]?/s);
            if (match && match[1]) {
              let rawValue = match[1].trim();
              // Remove surrounding quotes if still present
              if ((rawValue.startsWith("'") && rawValue.endsWith("'")) || 
                  (rawValue.startsWith('"') && rawValue.endsWith('"'))) {
                rawValue = rawValue.slice(1, -1);
              }
              // Extract complete JSON object (handle multi-line)
              if (rawValue.startsWith('{')) {
                // Find the matching closing brace
                let braceCount = 0;
                let endIndex = -1;
                for (let i = 0; i < rawValue.length; i++) {
                  if (rawValue[i] === '{') braceCount++;
                  if (rawValue[i] === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                      endIndex = i + 1;
                      break;
                    }
                  }
                }
                if (endIndex > 0) {
                  serviceAccountJson = rawValue.substring(0, endIndex);
                  console.log('[Firebase Admin] Extracted JSON from .env file:', serviceAccountJson.length, 'chars');
                } else {
                  serviceAccountJson = rawValue;
                }
              } else {
                serviceAccountJson = rawValue;
              }
            }
          }
        } catch (fileError: any) {
          console.error('[Firebase Admin] Could not read .env file:', fileError.message || fileError);
        }
      }
      
      if (serviceAccountJson && serviceAccountJson.length > 50) {
        try {
          // Remove surrounding quotes if present (sometimes .env files add extra quotes)
          let cleanedJson = serviceAccountJson.trim();
          if ((cleanedJson.startsWith("'") && cleanedJson.endsWith("'")) || 
              (cleanedJson.startsWith('"') && cleanedJson.endsWith('"'))) {
            cleanedJson = cleanedJson.slice(1, -1);
          }
          
          console.log('[Firebase Admin] Parsing service account JSON (', cleanedJson.length, 'chars)...');
          const serviceAccount = JSON.parse(cleanedJson);
          
          // Validate required fields
          if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
            throw new Error('Service account JSON missing required fields (project_id, private_key, client_email)');
          }
          
          console.log('[Firebase Admin] Service account has required fields, initializing...');
          adminApp = initializeApp({
            credential: cert(serviceAccount),
            projectId: serviceAccount.project_id,
          });
          console.log('[Firebase Admin] ✅ Initialized with service account for project:', serviceAccount.project_id);
          return adminApp;
        } catch (parseError: any) {
          console.error('[Firebase Admin] ❌ Failed to parse FIREBASE_SERVICE_ACCOUNT:', parseError.message || parseError);
          console.error('[Firebase Admin] First 200 chars of value:', serviceAccountJson.substring(0, 200));
          console.error('[Firebase Admin] Full error:', parseError);
        }
      } else {
        console.log('[Firebase Admin] FIREBASE_SERVICE_ACCOUNT not set or too short, trying other methods...');
      }
      
      // Try to use project ID (for Vercel with Firebase integration or Application Default Credentials)
      const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
      if (projectId) {
        try {
          adminApp = initializeApp({
            projectId: projectId,
          });
          console.log('[Firebase Admin] Initialized with project ID:', projectId);
          return adminApp;
        } catch (projectError) {
          console.error('[Firebase Admin] Failed to initialize with project ID:', projectError);
        }
      }
      
      // Last resort: try to initialize without explicit config (uses Application Default Credentials)
      try {
        adminApp = initializeApp();
        console.log('[Firebase Admin] Initialized with Application Default Credentials');
        return adminApp;
      } catch (defaultError) {
        console.error('[Firebase Admin] All initialization methods failed');
        throw new Error(`Firebase Admin initialization failed. Please set FIREBASE_SERVICE_ACCOUNT (JSON string) or FIREBASE_PROJECT_ID. Error: ${defaultError instanceof Error ? defaultError.message : 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[Firebase Admin] Initialization error:', error);
      throw error;
    }
  } else {
    adminApp = getApps()[0];
  }

  return adminApp;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Cache for API key validation (5 minute TTL)
let apiKeyCache: { key: string; timestamp: number } | null = null;
const API_KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Validate API key (env fallback; Neon api_keys uses key_hash for production)
 */
async function validateApiKey(providedKey: string): Promise<boolean> {
  // First check environment variables (backward compatibility)
  const envKey = process.env.VOICE_API_KEY || process.env.AI_PHONE_API_KEY;
  if (envKey && providedKey === envKey) {
    return true;
  }

  // Check cache first
  if (apiKeyCache && Date.now() - apiKeyCache.timestamp < API_KEY_CACHE_TTL) {
    return providedKey === apiKeyCache.key;
  }

  try {
    // API keys are stored in Neon api_keys (key_hash); for serverless we use env fallback
    if (envKey) {
      const valid = providedKey === envKey;
      if (valid) {
        apiKeyCache = { key: envKey, timestamp: Date.now() };
      }
      return valid;
    }
    return false;
  } catch (error) {
    console.error('Error validating API key:', error);
    return false;
  }
}

/**
 * Look up store by name using AI for fuzzy matching
 */
async function lookupStoreByName(storeName: string, prisma: PrismaClient): Promise<string | null> {
  const rows = await prisma.store.findMany({ select: { id: true, name: true } });
  const stores: Array<{ id: string; name: string }> = rows.map((r) => ({
    id: String(r.id),
    name: r.name || '',
  }));

  // Exact match (case-insensitive)
  const exactMatch = stores.find(s => s.name.toLowerCase() === storeName.toLowerCase());
  if (exactMatch) {
    return exactMatch.id;
  }

  // If no exact match and we have multiple stores, use AI to find best match
  if (stores.length > 0) {
    const systemPrompt = `You are a matching assistant. Given a store name and a list of available stores, find the best match.

Return JSON with:
- matchedStoreId: the ID of the best matching store, or null if no good match
- confidence: "high", "medium", or "low" based on how confident you are in the match
- reason: brief explanation of why this match was chosen

Match criteria:
- Exact matches (case-insensitive) = high confidence
- Partial matches (contains, similar spelling) = medium confidence
- Very different names = low confidence or null`;

    const userPrompt = `Store name to find: "${storeName}"

Available stores:
${stores.map(s => `- ID: ${s.id}, Name: ${s.name}`).join('\n')}

Find the best match:`;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });

      const result = JSON.parse(response.choices[0]?.message?.content || '{}');
      if (result.matchedStoreId && (result.confidence === 'high' || result.confidence === 'medium')) {
        return result.matchedStoreId;
      }
    } catch (error) {
      console.error('AI store lookup failed, trying fallback:', error);
    }

    // Fallback: simple contains match
    const containsMatch = stores.find(s => 
      s.name.toLowerCase().includes(storeName.toLowerCase()) ||
      storeName.toLowerCase().includes(s.name.toLowerCase())
    );
    if (containsMatch) {
      return containsMatch.id;
    }
  }

  return null;
}

/**
 * Look up business by name within a store using AI for fuzzy matching
 */
async function lookupBusinessByName(businessName: string, storeId: string, prisma: PrismaClient): Promise<string | null> {
  const rows = await prisma.business.findMany({
    where: { store_id: storeId },
    select: { id: true, name: true },
  });
  const businesses: Array<{ id: string; name: string }> = rows.map((r) => ({
    id: String(r.id),
    name: r.name || '',
  }));

  // Exact match (case-insensitive)
  const exactMatch = businesses.find(b => b.name.toLowerCase() === businessName.toLowerCase());
  if (exactMatch) {
    return exactMatch.id;
  }

  // If no exact match and we have businesses, use AI to find best match
  if (businesses.length > 0) {
    const systemPrompt = `You are a matching assistant. Given a business name and a list of available businesses, find the best match.

Return JSON with:
- matchedBusinessId: the ID of the best matching business, or null if no good match
- confidence: "high", "medium", or "low" based on how confident you are in the match
- reason: brief explanation of why this match was chosen

Match criteria:
- Exact matches (case-insensitive) = high confidence
- Partial matches (contains, similar spelling, abbreviations) = medium confidence
- Very different names = low confidence or null`;

    const userPrompt = `Business name to find: "${businessName}"

Available businesses:
${businesses.map(b => `- ID: ${b.id}, Name: ${b.name}`).join('\n')}

Find the best match:`;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });

      const result = JSON.parse(response.choices[0]?.message?.content || '{}');
      if (result.matchedBusinessId && (result.confidence === 'high' || result.confidence === 'medium')) {
        return result.matchedBusinessId;
      }
    } catch (error) {
      console.error('AI business lookup failed, trying fallback:', error);
    }

    // Fallback: simple contains match
    const containsMatch = businesses.find(b => 
      b.name.toLowerCase().includes(businessName.toLowerCase()) ||
      businessName.toLowerCase().includes(b.name.toLowerCase())
    );
    if (containsMatch) {
      return containsMatch.id;
    }
  }

  return null;
}

interface RequestBody {
  notes: string; // Call transcript/notes
  storeName: string; // Store name (will be looked up using AI fuzzy matching)
  businessName: string; // Required: business name (will be looked up or created if doesn't exist)
  apiKey?: string; // Optional: API key for authentication (alternative to Bearer token, or use VOICE_API_KEY env var)
}

/**
 * Extract contact info and donations from call notes using AI
 */
async function extractContactInfoFromNotes(notes: string): Promise<{
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
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
  const systemPrompt = `You are an AI assistant that extracts contact information from phone call transcripts for a bakery marketing program.

IMPORTANT CONTEXT:
- This is a bakery (Nothing Bundt Cake) giving away free products to businesses/contacts
- "Donations" means WE (the bakery) gave products TO the contact/business, not the other way around
- Products given away include: Bundtlet Cards, Dozen Bundtinis (12), 8" Cake (10), 10" Cake (20), Sample Tray (40), Bundtlet Tower (1 per bundtlet)

Extract the following information and return it as JSON:
- firstName: person's first name
- lastName: person's last name  
- email: email address
- phone: phone number (formatted as (XXX) XXX-XXXX if 10 digits)
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
- suggestedFollowUpDays: suggest number of days until next follow-up (typically 2-7 days, minimum 1)
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

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Extract contact info from this call transcript: "${notes}"` }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  return JSON.parse(response.choices[0]?.message?.content || '{}');
}

/**
 * Generate follow-up suggestion using AI
 */
async function generateFollowUpSuggestion(contact: {
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
}> {
  const fullName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'the contact';
  const now = new Date();
  const currentDateStr = now.toISOString().split('T')[0];
  const currentDateReadable = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const reachoutHistory = contact.reachouts
    .slice(-5)
    .map(r => {
      const date = r.date instanceof Date ? r.date.toLocaleDateString() : new Date(r.date).toLocaleDateString();
      const donationInfo = r.donation ? ` [DONATION: ${JSON.stringify(r.donation)}]` : '';
      return `${date} [${r.type}]: ${r.note}${donationInfo}`;
    })
    .join('\n');

  const hasDonations = contact.reachouts.some(r => r.donation);
  const hasEmail = !!contact.email;
  const hasPhone = !!contact.phone;
  const availableMethods: string[] = [];
  if (hasEmail) availableMethods.push('email');
  if (hasPhone) availableMethods.push('call', 'text');
  availableMethods.push('meeting', 'other');

  const systemPrompt = `You are an expert sales and relationship management AI. Analyze contact history and suggest the optimal follow-up strategy.

CRITICAL CONSTRAINTS:
- You CANNOT suggest "email" if the contact has no email address
- You CANNOT suggest "call" or "text" if the contact has no phone number
- If no email or phone is available, you MUST suggest "meeting" or "other"
- MINIMUM FOLLOW-UP: NEVER suggest same-day follow-up. Minimum is 1 day in the future (tomorrow at earliest)

Return JSON with:
- suggestedDate: ISO date string (YYYY-MM-DD) for the recommended follow-up date (MUST be at least 1 day in the future, never same day)
- suggestedMethod: one of "email", "call", "meeting", "text", or "other" - MUST match available contact methods
- message: personalized suggestion of what to discuss or send (reference personal details, recent interactions, donations, and context)
- priority: "low", "medium", or "high" based on urgency and opportunity
- reason: brief explanation of why this method and date were chosen (optional)

Guidelines:
- DONATIONS: IMPORTANT - "Donations" means WE (the bakery) gave products TO the contact/business. If we gave away products, this is HIGH PRIORITY - follow up within 1-3 days (but at least tomorrow) to check if they enjoyed the products and see if they're interested in ordering. DO NOT thank them for donating - we donated TO them.
- New contacts (0-1 reachouts): Suggest follow-up in 2-3 days (minimum 1 day)
- Active contacts (2-4 reachouts): Suggest follow-up in 3-7 days
- Engaged contacts (5+ reachouts or recent donations): Suggest follow-up in 1-5 days (minimum 1 day), consider meeting if interest is high
- If last contact was >7 days ago: Higher priority, but still minimum 1 day
- If contact mentioned interest/demo/proposal: Suggest meeting within 1-3 days (minimum 1 day)
- If contact has personal details: Reference them in the message for personalization
- Business days: Prefer weekdays for meetings and calls
- Urgency: High priority = 1 day (minimum 1), Medium = 2-3 days, Low = 4-10 days`;

  const userPrompt = `TODAY'S DATE: ${currentDateReadable} (${currentDateStr})

Contact: ${fullName}
Status: ${contact.status || 'new'}
Email: ${contact.email || 'NOT PROVIDED - cannot suggest email'}
Phone: ${contact.phone || 'NOT PROVIDED - cannot suggest call or text'}
Available contact methods: ${availableMethods.join(', ')}
Personal Details: ${contact.personalDetails || 'none'}
Has donations: ${hasDonations ? 'YES - HIGH PRIORITY follow-up needed' : 'No'}
Days since last contact: N/A (new contact)
Current date: ${currentDateStr}

Recent Reachouts (most recent first):
${reachoutHistory || 'No previous reachouts'}

IMPORTANT: 
- TODAY is ${currentDateReadable} (${currentDateStr})
- You MUST suggest a date that is AT LEAST 1 day in the future (tomorrow at earliest)
- Only suggest methods that are available
- If a donation occurred (products given to the contact), prioritize following up to check if they enjoyed the products, see if it led to business opportunities, and continue building the relationship
- Remember: donations are gifts FROM your business TO the contact, not the other way around

Analyze this contact and suggest the optimal follow-up strategy:`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 300,
  });

  const result = JSON.parse(response.choices[0]?.message?.content || '{}');

  // Validate suggested method
  if (result.suggestedMethod === 'email' && !hasEmail) {
    result.suggestedMethod = 'meeting';
    result.reason = (result.reason || '') + ' (Changed from email - no email available)';
  }

  if ((result.suggestedMethod === 'call' || result.suggestedMethod === 'text') && !hasPhone) {
    result.suggestedMethod = 'meeting';
    result.reason = (result.reason || '') + ' (Changed from call/text - no phone available)';
  }

  // Ensure suggestedDate is valid and at least 1 day in the future
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

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authentication is optional during testing
  // TODO: Re-enable authentication for production
  // const authHeader = req.headers.authorization;
  // const { apiKey } = req.body as RequestBody;
  // const hasAuth = (authHeader && authHeader.startsWith('Bearer ')) || apiKey;
  // if (!hasAuth) {
  //   return res.status(401).json({ error: 'Unauthorized - Authentication required (Bearer token or apiKey in body)' });
  // }
  // if (apiKey) {
  //   const app = getAdminApp();
  //   const db = getFirestore(app);
  //   const isValid = await validateApiKey(apiKey);
  //   if (!isValid) {
  //     return res.status(401).json({ error: 'Invalid API key' });
  //   }
  // }

  const { notes, storeName, businessName } = req.body as RequestBody;

  // Validate required fields
  if (!notes || typeof notes !== 'string' || notes.trim().length === 0) {
    return res.status(400).json({ error: 'Notes/transcript is required' });
  }

  if (!storeName || typeof storeName !== 'string') {
    return res.status(400).json({ error: 'storeName is required' });
  }

  if (!businessName || typeof businessName !== 'string') {
    return res.status(400).json({ error: 'businessName is required' });
  }

  // Verify OpenAI API key is configured
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ 
      error: 'OpenAI API key is not configured' 
    });
  }

  try {
    // Step 1: Look up store by name
    const finalStoreId = await lookupStoreByName(storeName, prisma);
    if (!finalStoreId) {
      return res.status(400).json({ 
        error: `Store "${storeName}" not found. Please check the store name.` 
      });
    }

    // Step 2: Extract contact info and donations from notes
    const extracted = await extractContactInfoFromNotes(notes);

    // Step 3: Handle business (look up by name or create if needed)
    let finalBusinessId = await lookupBusinessByName(businessName, finalStoreId, prisma);
    
    if (!finalBusinessId) {
      const newBiz = await prisma.business.create({
        data: {
          store_id: finalStoreId,
          name: businessName.trim(),
          created_by: 'ai-phone-system',
        },
      });
      finalBusinessId = newBiz.id;
    }

    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    const contactIdApp = `CONT-${timestamp}-${random}`;
    const now = new Date();
    const nowIso = now.toISOString();

    const d = extracted.donation || {};
    const initialReachout = {
      note: extracted.reachoutNote || 'Contact created from AI phone call',
      rawNotes: notes,
      createdBy: 'ai-phone-system',
      type: 'call' as const,
      storeId: finalStoreId,
      donation: extracted.donation,
    };

    let suggestedFollowUpDate: Date | null = null;
    let suggestedFollowUpMethod: 'email' | 'call' | 'meeting' | 'text' | 'other' | null = null;
    let suggestedFollowUpNote: string | null = null;
    let suggestedFollowUpPriority: 'low' | 'medium' | 'high' | null = null;

    try {
      const aiSuggestion = await generateFollowUpSuggestion({
        firstName: extracted.firstName,
        lastName: extracted.lastName,
        reachouts: [{ date: new Date(), note: extracted.reachoutNote || '', type: 'call', donation: extracted.donation }],
        personalDetails: extracted.personalDetails,
        status: 'new',
        email: extracted.email,
        phone: extracted.phone,
      });
      suggestedFollowUpDate = new Date(aiSuggestion.suggestedDate);
      suggestedFollowUpMethod = aiSuggestion.suggestedMethod;
      suggestedFollowUpNote = aiSuggestion.message;
      suggestedFollowUpPriority = aiSuggestion.priority;
    } catch (aiError) {
      console.error('AI follow-up generation failed:', aiError);
      const fallbackDate = new Date();
      fallbackDate.setDate(fallbackDate.getDate() + 3);
      suggestedFollowUpDate = fallbackDate;
      suggestedFollowUpMethod = extracted.email ? 'email' : extracted.phone ? 'call' : 'meeting';
      suggestedFollowUpNote = `Follow up with ${extracted.firstName || 'contact'}`;
      suggestedFollowUpPriority = 'medium';
    }

    const contactRow = await prisma.contact.create({
      data: {
        business_id: finalBusinessId,
        store_id: finalStoreId,
        contact_id: contactIdApp,
        first_name: extracted.firstName ?? null,
        last_name: extracted.lastName ?? null,
        email: extracted.email ?? null,
        phone: extracted.phone ?? null,
        personal_details: extracted.personalDetails ?? null,
        suggested_follow_up_date: suggestedFollowUpDate ?? null,
        suggested_follow_up_method: suggestedFollowUpMethod ?? null,
        suggested_follow_up_note: suggestedFollowUpNote ?? null,
        suggested_follow_up_priority: suggestedFollowUpPriority ?? null,
        last_reachout_date: now,
        status: 'new',
        created_by: 'ai-phone-system',
      },
    });
    const createdContactId = contactRow.id;

    await prisma.reachout.create({
      data: {
        contact_id: createdContactId,
        date: now,
        note: initialReachout.note,
        raw_notes: initialReachout.rawNotes ?? null,
        created_by: 'ai-phone-system',
        type: 'call',
        store_id: finalStoreId,
        free_bundlet_card: d.freeBundletCard ?? 0,
        dozen_bundtinis: d.dozenBundtinis ?? 0,
        cake_8inch: d.cake8inch ?? 0,
        cake_10inch: d.cake10inch ?? 0,
        sample_tray: d.sampleTray ?? 0,
        bundtlet_tower: d.bundtletTower ?? 0,
        cakes_donated_notes: d.cakesDonatedNotes ?? null,
        ordered_from_us: d.orderedFromUs === true,
        followed_up: d.followedUp === true,
      },
    });

    const contactName = `${extracted.firstName || ''} ${extracted.lastName || ''}`.trim() || extracted.email || 'Contact';
    const normalizedReachoutDate = new Date();
    normalizedReachoutDate.setHours(0, 0, 0, 0);

    await prisma.calendarEvent.create({
      data: {
        store_id: finalStoreId,
        title: `Reachout: ${contactName}`,
        description: extracted.reachoutNote || notes || null,
        date: normalizedReachoutDate,
        type: 'reachout',
        contact_id: createdContactId,
        business_id: finalBusinessId,
        priority: 'medium',
        status: 'completed',
        created_by: 'ai-phone-system',
        completed_at: now,
      },
    });

    if (suggestedFollowUpDate) {
      const normalizedFollowUpDate = new Date(suggestedFollowUpDate);
      normalizedFollowUpDate.setHours(0, 0, 0, 0);
      await prisma.calendarEvent.create({
        data: {
          store_id: finalStoreId,
          title: `Follow-up: ${contactName}`,
          description: suggestedFollowUpNote || `Follow up with ${contactName}`,
          date: normalizedFollowUpDate,
          type: 'followup',
          contact_id: createdContactId,
          business_id: finalBusinessId,
          priority: (suggestedFollowUpPriority as 'low' | 'medium' | 'high') || 'medium',
          status: 'scheduled',
          created_by: 'ai-phone-system',
        },
      });
    }

    const contactData = {
      businessId: finalBusinessId,
      storeId: finalStoreId,
      contactId: contactIdApp,
      firstName: extracted.firstName || null,
      lastName: extracted.lastName || null,
      email: extracted.email || null,
      phone: extracted.phone || null,
      personalDetails: extracted.personalDetails || null,
      suggestedFollowUpDate: suggestedFollowUpDate?.toISOString() || null,
      suggestedFollowUpMethod: suggestedFollowUpMethod || null,
      suggestedFollowUpNote: suggestedFollowUpNote || null,
      suggestedFollowUpPriority: suggestedFollowUpPriority || null,
      reachouts: [initialReachout],
      createdAt: nowIso,
      createdBy: 'ai-phone-system',
      lastReachoutDate: nowIso,
      status: 'new',
    };

    return res.status(200).json({
      success: true,
      contactId: createdContactId,
      contact: {
        id: createdContactId,
        ...contactData,
        suggestedFollowUpDate: suggestedFollowUpDate?.toISOString() || null,
      },
      message: 'Contact created successfully from call notes',
    });
  } catch (error: any) {
    console.error('Error creating contact from call:', error);
    return res.status(500).json({ 
      error: `Failed to create contact: ${error.message || 'Unknown error'}` 
    });
  }
}
