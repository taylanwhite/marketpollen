import { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { prisma } from './lib/db.js';
import type { PrismaClient } from '@prisma/client';
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
    if (envKey) {
      const valid = providedKey === envKey;
      if (valid) apiKeyCache = { key: envKey, timestamp: Date.now() };
      return valid;
    }
    return false;
  } catch (error) {
    console.error('Error validating API key:', error);
    return false;
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
async function lookupStoreByName(storeName: string, prisma: PrismaClient): Promise<string | null> {
  console.log(`[lookupStoreByName] Looking up store: "${storeName}"`);
  try {
    const rows = await prisma.store.findMany({ select: { id: true, name: true } });
    const stores: Array<{ id: string; name: string }> = rows.map((r) => ({
      id: String(r.id),
      name: r.name || '',
    }));
    console.log(`[lookupStoreByName] Found ${stores.length} stores`);

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
    let finalStoreId: string | null = null;
    if (storeName) {
      try {
        finalStoreId = await lookupStoreByName(storeName, prisma);
        if (!finalStoreId) {
          return res.status(400).json({ error: `Store "${storeName}" not found. Please check the store name.` });
        }
      } catch (storeError: any) {
        console.error('[get-calendar-events] Store lookup failed:', storeError);
        return res.status(500).json({ error: `Store lookup failed: ${storeError.message || 'Unknown error'}` });
      }
    }

    console.log(`[get-calendar-events] Parsing date: ${date}`);
    let targetDate: Date;
    if (typeof date === 'string') {
      const [year, month, day] = date.split('-').map(Number);
      if (!year || !month || !day) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }
      targetDate = new Date(year, month - 1, day);
    } else {
      targetDate = new Date(date);
    }

    const normalizedDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const startIso = new Date(normalizedDate.getFullYear(), normalizedDate.getMonth(), normalizedDate.getDate(), 0, 0, 0, 0).toISOString();
    const endIso = new Date(normalizedDate.getFullYear(), normalizedDate.getMonth(), normalizedDate.getDate(), 23, 59, 59, 999).toISOString();

    console.log(`[get-calendar-events] Querying events for date: ${normalizedDate.toISOString()}, storeId: ${finalStoreId || 'all'}`);

    const startDate = new Date(startIso);
    const endDate = new Date(endIso);
    const rows = await prisma.calendarEvent.findMany({
      where: finalStoreId
        ? { store_id: finalStoreId, date: { gte: startDate, lt: endDate } }
        : { date: { gte: startDate, lt: endDate } },
      orderBy: [{ date: 'asc' }, { start_time: 'asc' }],
    });

    const events: CalendarEventResponse[] = rows.map((r) => ({
      id: String(r.id),
      storeId: String(r.store_id),
      title: r.title || 'Untitled Event',
      description: r.description ?? null,
      date: (r.date instanceof Date ? r.date : new Date(r.date)).toISOString().split('T')[0],
      startTime: r.start_time ?? null,
      endTime: r.end_time ?? null,
      type: (r.type || 'other') as CalendarEventResponse['type'],
      contactId: r.contact_id ? String(r.contact_id) : null,
      businessId: r.business_id ? String(r.business_id) : null,
      priority: (r.priority ?? null) as CalendarEventResponse['priority'],
      status: (r.status ?? 'scheduled') as CalendarEventResponse['status'],
      location: null,
      notes: null,
      createdBy: r.created_by || '',
      createdAt: (r.created_at instanceof Date ? r.created_at : new Date(r.created_at)).toISOString(),
      updatedAt: null,
      completedAt: r.completed_at ? (r.completed_at instanceof Date ? r.completed_at : new Date(r.completed_at)).toISOString() : null,
      cancelledAt: null,
      contact: null,
      business: null,
    }));

    const contactIds = [...new Set(events.map((e) => e.contactId).filter(Boolean))] as string[];
    const businessIds = [...new Set(events.map((e) => e.businessId).filter(Boolean))] as string[];

    const contactsMap = new Map<string, any>();
    if (contactIds.length > 0) {
      const contactRows = await prisma.contact.findMany({
        where: { id: { in: contactIds } },
        select: { id: true, first_name: true, last_name: true, email: true, phone: true },
      });
      contactRows.forEach((r) => {
        contactsMap.set(String(r.id), {
          id: String(r.id),
          firstName: r.first_name ?? null,
          lastName: r.last_name ?? null,
          email: r.email ?? null,
          phone: r.phone ?? null,
        });
      });
    }

    const businessesMap = new Map<string, any>();
    if (businessIds.length > 0) {
      const businessRows = await prisma.business.findMany({
        where: { id: { in: businessIds } },
        select: { id: true, name: true },
      });
      businessRows.forEach((r) => {
        businessesMap.set(String(r.id), { id: String(r.id), name: r.name || 'Unknown Business' });
      });
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
