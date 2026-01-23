// User types
export interface User {
  uid: string;
  email: string;
  displayName?: string;
  createdAt: Date;
  isGlobalAdmin: boolean; // Can manage entire system
  storePermissions: StorePermission[]; // Permissions per store
}

export interface StorePermission {
  storeId: string;
  canEdit: boolean; // false = view only, true = full access (view + edit)
}

export interface UserInvite {
  id: string;
  email: string;
  storeId: string;
  canEdit: boolean; // false = view only, true = full access
  invitedBy: string; // admin uid
  invitedAt: Date;
  status: 'pending' | 'accepted' | 'rejected';
}

// Store types (formerly Location)
export interface Store {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  createdAt: Date;
  createdBy: string; // user uid
}

// Business types
export interface Business {
  id: string;
  name: string;
  storeId: string; // Business belongs to a store
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  createdAt: Date;
  createdBy: string; // user uid
}

// Donation data embedded in a reachout
export interface DonationData {
  freeBundletCard: number;   // 1 mouth each
  dozenBundtinis: number;    // 12 mouths each
  cake8inch: number;         // 10 mouths each
  cake10inch: number;        // 20 mouths each
  sampleTray: number;        // 40 mouths each
  bundtletTower: number;     // 1 mouth per bundtlet
  cakesDonatedNotes?: string;
  orderedFromUs: boolean;
  followedUp: boolean;
}

// Mouth values for calculating bundtini equivalents
export const MOUTH_VALUES = {
  freeBundletCard: 1,
  dozenBundtinis: 12,
  cake8inch: 10,
  cake10inch: 20,
  sampleTray: 40,
  bundtletTower: 1,
} as const;

// Quarterly goal for bundtinis per store
export const QUARTERLY_GOAL = 10000;

// Reachout/Note entry
export interface Reachout {
  id: string;
  date: Date;
  note: string;
  rawNotes?: string | null; // Original unprocessed meeting notes
  createdBy: string; // user uid
  type?: 'call' | 'email' | 'meeting' | 'other';
  storeId?: string; // Which store made this reachout
  donation?: DonationData; // Optional donation data
}

// File attachment for contacts
export interface FileAttachment {
  id: string;
  name: string;
  storagePath: string; // Firebase Storage path
  downloadURL: string;
  size: number; // File size in bytes
  mimeType: string;
  uploadedAt: Date;
  uploadedBy: string; // user uid
}

// Contact types
export interface Contact {
  id: string;
  businessId: string; // Business the contact works for
  storeId: string; // Store that owns/manages this contact
  contactId: string; // Unique contact identifier
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  employeeCount?: number | null; // Number of employees at the business
  reachouts: Reachout[]; // History of all interactions
  files?: FileAttachment[]; // Attached files
  personalDetails?: string | null; // AI-extracted personal info (hobbies, family, interests)
  suggestedFollowUpDate?: Date | null; // AI-suggested next follow-up date
  suggestedFollowUpMethod?: 'email' | 'call' | 'meeting' | 'text' | 'other' | null; // AI-suggested follow-up method
  suggestedFollowUpNote?: string | null; // AI-suggested follow-up message/note
  suggestedFollowUpPriority?: 'low' | 'medium' | 'high' | null; // AI-suggested priority
  createdAt: Date;
  createdBy: string; // user uid
  lastReachoutDate?: Date | null;
  status?: 'new' | 'contacted' | 'active' | 'converted' | 'inactive';
}

// Store-specific contact relationship (for future multi-store implementation)
export interface StoreContact {
  id: string;
  storeId: string;
  contactId: string; // References global Contact
  reachouts: Reachout[]; // Store-specific interaction history
  suggestedFollowUpDate?: Date;
  lastReachoutDate?: Date;
  status?: 'new' | 'contacted' | 'active' | 'converted' | 'inactive';
  addedAt: Date;
  addedBy: string; // user uid
}

// Follow-up suggestion types
export interface FollowUpSuggestion {
  suggestedDate: Date;
  message: string;
  type: 'email' | 'call' | 'meeting' | 'text' | 'other';
  priority: 'low' | 'medium' | 'high';
  contactId?: string;
  contactName?: string;
}

// Calendar Event types
export interface CalendarEvent {
  id: string;
  storeId: string; // Store that owns this event
  title: string;
  description?: string | null;
  date: Date;
  startTime?: string | null; // Optional time (HH:mm format)
  endTime?: string | null; // Optional time (HH:mm format)
  type: 'reachout' | 'followup' | 'meeting' | 'call' | 'email' | 'text' | 'other';
  contactId?: string | null; // Optional - links to a contact
  businessId?: string | null; // Optional - links to a business
  priority?: 'low' | 'medium' | 'high' | null;
  status?: 'scheduled' | 'completed' | 'cancelled' | null;
  location?: string | null;
  notes?: string | null;
  createdBy: string; // user uid
  createdAt: Date;
  updatedAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
}
