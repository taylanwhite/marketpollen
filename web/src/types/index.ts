// User types
export interface User {
  uid: string;
  email: string;
  displayName?: string;
  createdAt: Date;
  isGlobalAdmin: boolean; // Can manage entire system
  locationPermissions: LocationPermission[]; // Permissions per location
}

export interface LocationPermission {
  locationId: string;
  canEdit: boolean; // false = view only, true = full access (view + edit)
}

export interface UserInvite {
  id: string;
  email: string;
  locationId: string;
  canEdit: boolean; // false = view only, true = full access
  invitedBy: string; // admin uid
  invitedAt: Date;
  status: 'pending' | 'accepted' | 'rejected';
}

// Location types (formerly Business)
export interface Location {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  createdAt: Date;
  createdBy: string; // user uid
}

// Business types (kept for backwards compatibility, but Location is the main concept now)
export interface Business {
  id: string;
  name: string;
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

// Quarterly goal for bundtinis per location
export const QUARTERLY_GOAL = 10000;

// Reachout/Note entry
export interface Reachout {
  id: string;
  date: Date;
  note: string;
  rawNotes?: string | null; // Original unprocessed meeting notes
  createdBy: string; // user uid
  type?: 'call' | 'email' | 'meeting' | 'other';
  locationId?: string; // Which location made this reachout
  donation?: DonationData; // Optional donation data
}

// Contact types
export interface Contact {
  id: string;
  businessId: string;
  contactId: string; // Unique contact identifier
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  employeeCount?: number | null; // Number of employees at the business
  reachouts: Reachout[]; // History of all interactions
  personalDetails?: string | null; // AI-extracted personal info (hobbies, family, interests)
  suggestedFollowUpDate?: Date | null; // AI-suggested next follow-up date
  createdAt: Date;
  createdBy: string; // user uid
  lastReachoutDate?: Date | null;
  status?: 'new' | 'contacted' | 'active' | 'converted' | 'inactive';
}

// Location-specific contact relationship (for future multi-location implementation)
export interface LocationContact {
  id: string;
  locationId: string;
  contactId: string; // References global Contact
  reachouts: Reachout[]; // Location-specific interaction history
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
  type: 'email' | 'call' | 'meeting' | 'other';
  priority: 'low' | 'medium' | 'high';
}
