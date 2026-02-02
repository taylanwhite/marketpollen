-- BundtMarketer Neon Postgres schema (fresh dev, no migration)
-- Run this in Neon SQL Editor or via psql after creating a project.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users (keyed by Firebase UID; Firebase Auth remains)
CREATE TABLE users (
  id TEXT PRIMARY KEY,  -- Firebase UID
  email TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_global_admin BOOLEAN NOT NULL DEFAULT FALSE
);

-- Stores
CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL REFERENCES users(id)
);

-- Store-level permissions per user
CREATE TABLE store_permissions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, store_id)
);

-- Businesses
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  place_id TEXT,  -- Google Places ID; set when created from an opportunity
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_businesses_store_id ON businesses(store_id);
CREATE UNIQUE INDEX idx_businesses_place_id ON businesses(place_id) WHERE place_id IS NOT NULL;

-- Opportunities (nearby places to pursue; convert to business or dismiss)
CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'converted', 'dismissed')),
  business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL REFERENCES users(id),
  converted_at TIMESTAMPTZ,
  UNIQUE (store_id, place_id)
);

CREATE INDEX idx_opportunities_store_id ON opportunities(store_id);
CREATE INDEX idx_opportunities_status ON opportunities(store_id, status);

-- Contacts
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,  -- app-level unique per business
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  employee_count INTEGER,
  personal_details TEXT,
  suggested_follow_up_date TIMESTAMPTZ,
  suggested_follow_up_method TEXT CHECK (suggested_follow_up_method IN ('email', 'call', 'meeting', 'text', 'other')),
  suggested_follow_up_note TEXT,
  suggested_follow_up_priority TEXT CHECK (suggested_follow_up_priority IN ('low', 'medium', 'high')),
  last_reachout_date TIMESTAMPTZ,
  status TEXT CHECK (status IN ('new', 'contacted', 'active', 'converted', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL REFERENCES users(id),
  UNIQUE (business_id, contact_id)
);

CREATE INDEX idx_contacts_store_id ON contacts(store_id);
CREATE INDEX idx_contacts_business_id ON contacts(business_id);

-- Reachouts (donation fields embedded)
CREATE TABLE reachouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT NOT NULL,
  raw_notes TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('call', 'email', 'meeting', 'other')),
  store_id UUID REFERENCES stores(id),
  -- Donation fields
  free_bundlet_card INTEGER NOT NULL DEFAULT 0,
  dozen_bundtinis INTEGER NOT NULL DEFAULT 0,
  cake_8inch INTEGER NOT NULL DEFAULT 0,
  cake_10inch INTEGER NOT NULL DEFAULT 0,
  sample_tray INTEGER NOT NULL DEFAULT 0,
  bundtlet_tower INTEGER NOT NULL DEFAULT 0,
  cakes_donated_notes TEXT,
  ordered_from_us BOOLEAN NOT NULL DEFAULT FALSE,
  followed_up BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_reachouts_contact_id ON reachouts(contact_id);

-- Contact file attachments (metadata; files stay in Firebase Storage)
CREATE TABLE contact_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  download_url TEXT NOT NULL,
  size BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by TEXT NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_contact_files_contact_id ON contact_files(contact_id);

-- Calendar events
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  date TIMESTAMPTZ NOT NULL,
  start_time TEXT,
  end_time TEXT,
  type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('reachout', 'followup', 'meeting', 'call', 'email', 'text', 'other')),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  priority TEXT CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  location TEXT,
  notes TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX idx_calendar_events_store_date ON calendar_events(store_id, date);

-- Invites
CREATE TABLE invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  invited_by TEXT NOT NULL REFERENCES users(id),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  is_global_admin BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_invites_email_status ON invites(email, status);

-- API keys (optional; for voice/AI phone system)
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  key_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
