import { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Timestamp, Firestore } from 'firebase-admin/firestore';
import OpenAI from 'openai';
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

// Cache for API key validation (5 minute TTL)
let apiKeyCache: { key: string; timestamp: number } | null = null;
const API_KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Validate API key against Firestore
 * Uses caching to avoid reading from Firestore on every request
 */
async function validateApiKey(providedKey: string, db: any): Promise<boolean> {
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
    // Read from Firestore apiKeys collection
    // Expected structure: apiKeys/{docId} with field: key (string)
    const apiKeysSnapshot = await db.collection('apiKeys').limit(10).get();
    
    let validKey: string | null = null;
    apiKeysSnapshot.forEach((doc: any) => {
      const data = doc.data();
      if (data.key && typeof data.key === 'string') {
        // Use the first valid key found, or check all if multiple
        if (!validKey) {
          validKey = data.key;
        }
        // If provided key matches any stored key, it's valid
        if (providedKey === data.key) {
          validKey = data.key;
        }
      }
    });

    if (validKey) {
      // Update cache
      apiKeyCache = {
        key: validKey,
        timestamp: Date.now()
      };
      return providedKey === validKey;
    }

    // No valid key found in Firestore
    return false;
  } catch (error) {
    console.error('Error validating API key from Firestore:', error);
    // Fallback to environment variable if Firestore read fails
    return envKey ? providedKey === envKey : false;
  }
}

interface RequestBody {
  date: string; // ISO date string (YYYY-MM-DD) or Date object
  storeName?: string; // Optional: Store name (will be looked up using AI fuzzy matching)
  apiKey?: string; // Optional: API key for authentication (alternative to Bearer token)
}

interface CalendarEventResponse {
  id: string;
  storeId: string;
  title: string;
  description?: string | null;
  date: string; // ISO date string
  startTime?: string | null;
  endTime?: string | null;
  type: 'reachout' | 'followup' | 'meeting' | 'call' | 'email' | 'text' | 'other';
  contactId?: string | null;
  businessId?: string | null;
  priority?: 'low' | 'medium' | 'high' | null;
  status?: 'scheduled' | 'completed' | 'cancelled' | null;
  location?: string | null;
  notes?: string | null;
  createdBy: string;
  createdAt: string; // ISO date string
  updatedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  // Related data
  contact?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  business?: {
    id: string;
    name: string;
  } | null;
}

/**
 * Look up store by name using AI for fuzzy matching
 */
async function lookupStoreByName(storeName: string, db: any): Promise<string | null> {
  console.log(`[lookupStoreByName] Looking up store: "${storeName}"`);
  
  try {
    // First try exact match (case-insensitive)
    console.log('[lookupStoreByName] Querying stores collection...');
    const storesSnapshot = await Promise.race([
      db.collection('stores').get(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Store query timeout after 5 seconds')), 5000)
      )
    ]) as any;
    
    console.log(`[lookupStoreByName] Found ${storesSnapshot.size} stores`);
    const stores: Array<{ id: string; name: string }> = [];
    
    storesSnapshot.forEach((doc: any) => {
      stores.push({ id: doc.id, name: doc.data().name || '' });
    });

    // Exact match (case-insensitive)
    const exactMatch = stores.find(s => s.name.toLowerCase() === storeName.toLowerCase());
    if (exactMatch) {
      console.log(`[lookupStoreByName] Exact match found: ${exactMatch.id}`);
      return exactMatch.id;
    }

    // If no exact match and we have multiple stores, use AI to find best match
    if (stores.length > 0) {
      console.log('[lookupStoreByName] No exact match, trying AI fuzzy matching...');
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

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
        const response = await Promise.race([
          openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 200,
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('AI lookup timeout after 10 seconds')), 10000)
          )
        ]) as any;

        const result = JSON.parse(response.choices[0]?.message?.content || '{}');
        if (result.matchedStoreId && (result.confidence === 'high' || result.confidence === 'medium')) {
          console.log(`[lookupStoreByName] AI match found: ${result.matchedStoreId} (${result.confidence})`);
          return result.matchedStoreId;
        }
      } catch (error: any) {
        console.error('[lookupStoreByName] AI store lookup failed:', error.message || error);
        // Continue to fallback
      }

      // Fallback: simple contains match
      const containsMatch = stores.find(s => 
        s.name.toLowerCase().includes(storeName.toLowerCase()) ||
        storeName.toLowerCase().includes(s.name.toLowerCase())
      );
      if (containsMatch) {
        console.log(`[lookupStoreByName] Fallback match found: ${containsMatch.id}`);
        return containsMatch.id;
      }
    }

    console.log('[lookupStoreByName] No match found');
    return null;
  } catch (error: any) {
    console.error('[lookupStoreByName] Error:', error.message || error);
    throw error;
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  console.log('[get-calendar-events] Request received:', req.method, req.url);
  
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
  
  const { date, storeName } = req.body as RequestBody;

  // Validate required fields
  if (!date) {
    return res.status(400).json({ error: 'Date is required (ISO date string YYYY-MM-DD)' });
  }

  try {
    console.log('[get-calendar-events] Starting request processing');
    
    // Initialize Firebase Admin (needed for API key validation and store lookup)
    let app: App;
    let db: Firestore;
    try {
      console.log('[get-calendar-events] Initializing Firebase Admin...');
      app = getAdminApp();
      db = getFirestore(app);
      console.log('[get-calendar-events] Firebase Admin initialized');
    } catch (firebaseError: any) {
      console.error('[get-calendar-events] Firebase Admin initialization failed:', firebaseError);
      return res.status(500).json({ 
        error: `Firebase initialization failed: ${firebaseError.message || 'Unknown error'}`,
        details: process.env.NODE_ENV === 'development' ? firebaseError.stack : undefined
      });
    }

    // API key validation disabled during testing
    // TODO: Re-enable for production
    // if (apiKey) {
    //   const isValid = await validateApiKey(apiKey, db);
    //   if (!isValid) {
    //     return res.status(401).json({ error: 'Invalid API key' });
    //   }
    // }

    // Look up store by name if provided
    // TEMPORARILY DISABLED: Skip store lookup to avoid hanging - will re-enable after fixing
    let finalStoreId: string | null = null;
    if (storeName) {
      console.log(`[get-calendar-events] Store lookup temporarily disabled for testing. Using storeName: ${storeName}`);
      // TODO: Re-enable store lookup after fixing hanging issue
      // try {
      //   finalStoreId = await lookupStoreByName(storeName, db);
      //   if (!finalStoreId) {
      //     return res.status(400).json({ 
      //       error: `Store "${storeName}" not found. Please check the store name.` 
      //     });
      //   }
      // } catch (storeError: any) {
      //   console.error('[get-calendar-events] Store lookup failed:', storeError);
      //   return res.status(500).json({ 
      //     error: `Store lookup failed: ${storeError.message || 'Unknown error'}` 
      //   });
      // }
    }

    // Parse and normalize date
    console.log(`[get-calendar-events] Parsing date: ${date}`);
    let targetDate: Date;
    if (typeof date === 'string') {
      // Parse ISO date string (YYYY-MM-DD)
      const [year, month, day] = date.split('-').map(Number);
      if (!year || !month || !day) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }
      targetDate = new Date(year, month - 1, day); // month is 0-indexed
    } else {
      targetDate = new Date(date);
    }

    // Normalize to local midnight for comparison
    const normalizedDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const startOfDay = Timestamp.fromDate(new Date(normalizedDate.getFullYear(), normalizedDate.getMonth(), normalizedDate.getDate(), 0, 0, 0, 0));
    const endOfDay = Timestamp.fromDate(new Date(normalizedDate.getFullYear(), normalizedDate.getMonth(), normalizedDate.getDate(), 23, 59, 59, 999));

    console.log(`[get-calendar-events] Querying events for date: ${normalizedDate.toISOString()}, storeId: ${finalStoreId || 'all'}`);

    // Build query - Simplified: always query all events and filter in memory to avoid index issues
    let eventsSnapshot;
    try {
      // Query all calendar events (we'll filter by date and store in memory)
      console.log('[get-calendar-events] Executing Firestore query...');
      const allEventsQuery = db.collection('calendarEvents');
      eventsSnapshot = await Promise.race([
        allEventsQuery.get(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Firestore query timeout after 10 seconds')), 10000)
        )
      ]) as any;
      console.log(`[get-calendar-events] Query completed, got ${eventsSnapshot.size} total events`);
    } catch (error: any) {
      console.error('[get-calendar-events] Firestore query failed:', error);
      if (error.message?.includes('timeout')) {
        return res.status(504).json({ 
          error: 'Query timeout - Firestore took too long to respond' 
        });
      }
      return res.status(500).json({ 
        error: `Failed to query calendar events: ${error.message || 'Unknown error'}` 
      });
    }

    // Process events
    console.log('[get-calendar-events] Processing events...');
    const events: CalendarEventResponse[] = [];
    const contactIds = new Set<string>();
    const businessIds = new Set<string>();

    eventsSnapshot.forEach((docSnap) => {
      try {
        const data = docSnap.data();
        
        // Filter by storeId if provided (store lookup temporarily disabled, so this won't filter for now)
        // if (finalStoreId && data.storeId !== finalStoreId) {
        //   return;
        // }

        // Convert Firestore Timestamp to Date
        const eventDate = data.date?.toDate() || new Date();
        const normalizedEventDate = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
        
        // Check if event date matches target date (normalized to midnight)
        if (normalizedEventDate.getTime() !== normalizedDate.getTime()) {
          return;
        }

      const event: CalendarEventResponse = {
        id: docSnap.id,
        storeId: data.storeId || '',
        title: data.title || 'Untitled Event',
        description: data.description || null,
        date: eventDate.toISOString().split('T')[0], // YYYY-MM-DD format
        startTime: data.startTime || null,
        endTime: data.endTime || null,
        type: data.type || 'other',
        contactId: data.contactId || null,
        businessId: data.businessId || null,
        priority: data.priority || null,
        status: data.status || 'scheduled',
        location: data.location || null,
        notes: data.notes || null,
        createdBy: data.createdBy || '',
        createdAt: data.createdAt?.toDate()?.toISOString() || new Date().toISOString(),
        updatedAt: data.updatedAt?.toDate()?.toISOString() || null,
        completedAt: data.completedAt?.toDate()?.toISOString() || null,
        cancelledAt: data.cancelledAt?.toDate()?.toISOString() || null,
        contact: null,
        business: null,
      };

      if (data.contactId) {
        contactIds.add(data.contactId);
      }
      if (data.businessId) {
        businessIds.add(data.businessId);
      }

        events.push(event);
      } catch (eventError) {
        console.error(`[get-calendar-events] Error processing event ${docSnap.id}:`, eventError);
        // Continue processing other events
      }
    });

    console.log(`[get-calendar-events] Filtered to ${events.length} events for target date`);

    // Load related contacts
    const contactsMap = new Map<string, any>();
    if (contactIds.size > 0) {
      console.log(`[get-calendar-events] Loading ${contactIds.size} contacts...`);
      try {
        const contactPromises = Array.from(contactIds).map(async (contactId) => {
          try {
            const contactDoc = await db.collection('contacts').doc(contactId).get();
            if (contactDoc.exists) {
              const contactData = contactDoc.data();
              contactsMap.set(contactId, {
                id: contactId,
                firstName: contactData?.firstName || null,
                lastName: contactData?.lastName || null,
                email: contactData?.email || null,
                phone: contactData?.phone || null,
              });
            }
          } catch (error) {
            console.error(`[get-calendar-events] Error loading contact ${contactId}:`, error);
          }
        });
        await Promise.all(contactPromises);
        console.log(`[get-calendar-events] Loaded ${contactsMap.size} contacts`);
      } catch (error) {
        console.error('[get-calendar-events] Error loading contacts:', error);
        // Continue without contact data
      }
    }

    // Load related businesses
    const businessesMap = new Map<string, any>();
    if (businessIds.size > 0) {
      console.log(`[get-calendar-events] Loading ${businessIds.size} businesses...`);
      try {
        const businessPromises = Array.from(businessIds).map(async (businessId) => {
          try {
            const businessDoc = await db.collection('businesses').doc(businessId).get();
            if (businessDoc.exists) {
              const businessData = businessDoc.data();
              businessesMap.set(businessId, {
                id: businessId,
                name: businessData?.name || 'Unknown Business',
              });
            }
          } catch (error) {
            console.error(`[get-calendar-events] Error loading business ${businessId}:`, error);
          }
        });
        await Promise.all(businessPromises);
        console.log(`[get-calendar-events] Loaded ${businessesMap.size} businesses`);
      } catch (error) {
        console.error('[get-calendar-events] Error loading businesses:', error);
        // Continue without business data
      }
    }

    // Attach related data to events
    events.forEach((event) => {
      if (event.contactId && contactsMap.has(event.contactId)) {
        event.contact = contactsMap.get(event.contactId);
      }
      if (event.businessId && businessesMap.has(event.businessId)) {
        event.business = businessesMap.get(event.businessId);
      }
    });

    // Sort events by startTime (if available) or by creation time
    events.sort((a, b) => {
      if (a.startTime && b.startTime) {
        return a.startTime.localeCompare(b.startTime);
      }
      if (a.startTime) return -1;
      if (b.startTime) return 1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    console.log(`[get-calendar-events] Returning ${events.length} events`);
    return res.status(200).json({
      success: true,
      date: normalizedDate.toISOString().split('T')[0],
      storeId: finalStoreId || null,
      storeName: storeName || null,
      events: events,
      count: events.length,
    });
  } catch (error: any) {
    console.error('[get-calendar-events] Error fetching calendar events:', error);
    console.error('[get-calendar-events] Error stack:', error.stack);
    return res.status(500).json({ 
      error: `Failed to fetch calendar events: ${error.message || 'Unknown error'}`,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
