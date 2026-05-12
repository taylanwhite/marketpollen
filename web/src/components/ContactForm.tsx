import { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionContext';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { extractContactInfo, generateFollowUpSuggestion } from '../utils/openai';
import { Reachout, DonationData, Business, SLUG_TO_FIELD } from '../types';
import { createEmptyDonation, calculateMouths } from '../utils/donationCalculations';
import { useCampaign } from '../contexts/CampaignContext';
import { useDonation } from '../contexts/DonationContext';
import { useOffline } from '../contexts/OfflineContext';
import { DonationProductFields } from './DonationProductFields';
import { OnlineOnlyNotice } from './OnlineOnlyNotice';
import {
  Box,
  Button,
  Switch,
  FormControlLabel,
  Typography,
  Collapse,
  TextField,
  Chip,
  Stack,
  Autocomplete,
  CircularProgress,
  Alert,
  InputAdornment,
  ToggleButton,
  ToggleButtonGroup,
  IconButton,
  Tooltip,
} from '@mui/material';
import { type AddressData } from './AddressPicker';
import { useTheme, useMediaQuery } from '@mui/material';
import { PlaceMatchPicker, type PlaceResult } from './PlaceMatchPicker';
import { NearbyPlacesChips, type NearbyPlace } from './NearbyPlacesChips';
import { haptics } from '../utils/haptics';
import {
  Cake as CakeIcon,
  Mic as MicIcon,
  MicOff as MicOffIcon,
  AutoAwesome as AIIcon,
  Phone as PhoneIcon,
  Email as EmailIcon,
  EventAvailable as MeetingIcon,
  Sms as SmsIcon,
  HelpOutline as OtherIcon,
  Save as SaveIcon,
  Clear as ClearIcon,
  Business as BusinessIcon,
  Person as PersonIcon,
} from '@mui/icons-material';

type ReachoutType = 'meeting' | 'call' | 'email' | 'text' | 'other';

interface ContactFormProps {
  onSuccess?: () => void;
  defaultBusinessId?: string;
}

interface FormState {
  name: string; // combined "First Last"; we split on save
  email: string;
  phone: string;
  personalDetails: string;
  reachoutNote: string;
  reachoutType: ReachoutType;
  followUpDays: number;
}

const FOLLOW_UP_PRESETS: { label: string; days: number }[] = [
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
];

const REACHOUT_TYPES: { value: ReachoutType; label: string; icon: React.ReactNode }[] = [
  { value: 'meeting', label: 'Visit', icon: <MeetingIcon fontSize="small" /> },
  { value: 'call', label: 'Call', icon: <PhoneIcon fontSize="small" /> },
  { value: 'text', label: 'Text', icon: <SmsIcon fontSize="small" /> },
  { value: 'email', label: 'Email', icon: <EmailIcon fontSize="small" /> },
  { value: 'other', label: 'Other', icon: <OtherIcon fontSize="small" /> },
];

function splitName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function ContactForm({ onSuccess, defaultBusinessId }: ContactFormProps) {
  const { userId } = useAuth();
  const { products } = useCampaign();
  const { permissions } = usePermissions();
  const { triggerRefresh, setLastDonationMouths, bumpDataVersion } = useDonation();
  const { isOnline } = useOffline();
  const { transcript, interimTranscript, isListening, startListening, stopListening, clearTranscript, error: voiceError } = useVoiceInput();
  const theme = useTheme();
  // Match the Quick Reachout dialog: don't auto-focus the notes textarea on
  // mobile because that pops the on-screen keyboard the moment the sheet
  // opens — and our marketers almost always reach for the mic button first,
  // not the keyboard. Desktop users still get focus for typing speed.
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>(defaultBusinessId || '');

  const [showNewBusiness, setShowNewBusiness] = useState(false);
  const [newBusinessName, setNewBusinessName] = useState('');
  const [newBusinessAddress, setNewBusinessAddress] = useState<AddressData>({ address: '', city: '', state: '', zipCode: '' });
  const [newBusinessPlaceId, setNewBusinessPlaceId] = useState<string | null>(null);
  const [showPlacePicker, setShowPlacePicker] = useState(false);
  const [creatingBusiness, setCreatingBusiness] = useState(false);

  const [rawNotes, setRawNotes] = useState('');
  const [hasExtracted, setHasExtracted] = useState(false);
  // Snapshot of whatever the user had typed when they last started dictating,
  // so the live transcript appends instead of overwriting their text.
  const typedPrefixRef = useRef<string>('');

  const [form, setForm] = useState<FormState>({
    name: '',
    email: '',
    phone: '',
    personalDetails: '',
    reachoutNote: '',
    reachoutType: 'meeting',
    followUpDays: 3,
  });

  const [includeDonation, setIncludeDonation] = useState(false);
  const [donationData, setDonationData] = useState<DonationData>(createEmptyDonation(products));

  const [loading, setLoading] = useState(false);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('Saved!');

  // Hydrate the businesses list whenever the active store changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!permissions.currentStoreId) {
        setBusinesses([]);
        return;
      }
      try {
        const list = await api.get<Business[]>(`/businesses?storeId=${permissions.currentStoreId}`);
        if (cancelled) return;
        const sorted = list
          .map((b) => ({ ...b, createdAt: b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setBusinesses(sorted);
      } catch (err) {
        console.error('Error loading businesses:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [permissions.currentStoreId]);

  // When dictation starts, snapshot whatever the user typed first; then
  // append the live transcript to that snapshot instead of overwriting.
  useEffect(() => {
    if (isListening) {
      // Snapshot only on the rising edge of isListening
      typedPrefixRef.current = rawNotes;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]);

  useEffect(() => {
    if (!transcript && !interimTranscript) return;
    const live = interimTranscript ? `${transcript} ${interimTranscript}`.trim() : transcript;
    const prefix = typedPrefixRef.current;
    const sep = prefix && !prefix.endsWith(' ') && !prefix.endsWith('\n') ? ' ' : '';
    setRawNotes(prefix ? `${prefix}${sep}${live}` : live);
  }, [transcript, interimTranscript]);

  // Make sure speech recognition doesn't keep running if the form unmounts
  // (e.g. user dismisses the QuickAddDialog mid-dictation).
  useEffect(() => {
    return () => {
      if (isListening) stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the marketer is offline (or loses signal mid-form), AI extraction can't
  // run — but we don't want to leave them staring at a "Extract with AI" button
  // that will fail. Auto-reveal the manual review fields so they can fill the
  // form by hand and save normally. The save chain queues to the outbox.
  // We also flip the mic off — it depends on cloud speech recognition.
  useEffect(() => {
    if (!isOnline) {
      setHasExtracted(true);
      if (isListening) stopListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const selectedBusiness = useMemo(
    () => businesses.find((b) => b.id === selectedBusinessId) || null,
    [businesses, selectedBusinessId]
  );

  const totalMouths = useMemo(
    () => (includeDonation ? calculateMouths(donationData, products) : 0),
    [includeDonation, donationData, products]
  );

  const handleProcess = async () => {
    if (!rawNotes.trim()) {
      setError('Tell me about your visit first — type or dictate above.');
      return;
    }
    setError('');
    setAiProcessing(true);
    try {
      const activeProducts = products.filter((p) => p.isActive).map((p) => ({
        slug: p.slug,
        name: p.name,
        mouthValue: p.mouthValue,
      }));
      const extracted = await extractContactInfo(rawNotes, activeProducts);

      const combinedName = [extracted.firstName, extracted.lastName].filter(Boolean).join(' ').trim();
      setForm((prev) => ({
        ...prev,
        name: combinedName || prev.name,
        email: extracted.email || prev.email,
        phone: extracted.phone || prev.phone,
        personalDetails: extracted.personalDetails || prev.personalDetails,
        reachoutNote: extracted.reachoutNote || prev.reachoutNote,
        reachoutType: (extracted.reachoutType as ReachoutType) || prev.reachoutType,
        followUpDays: extracted.suggestedFollowUpDays || prev.followUpDays,
      }));

      // Auto-match the business by fuzzy name
      if (extracted.businessName) {
        const target = extracted.businessName.toLowerCase();
        const match = businesses.find((b) => {
          const n = b.name.toLowerCase();
          return n === target || n.includes(target) || target.includes(n);
        });
        if (match) {
          setSelectedBusinessId(match.id);
          setShowNewBusiness(false);
        } else {
          setShowNewBusiness(true);
          setNewBusinessName(extracted.businessName);
          setSelectedBusinessId('');
        }
      }

      // Carry the AI-extracted address into the "new business" payload so it
      // gets saved if the user creates the business without picking a Place.
      if (extracted.address || extracted.city || extracted.state || extracted.zipCode) {
        setNewBusinessAddress((prev) => ({
          address: extracted.address || prev.address,
          city: extracted.city || prev.city,
          state: extracted.state || prev.state,
          zipCode: extracted.zipCode || prev.zipCode,
        }));
      }

      // Donation detection: trust the AI's extracted donation, fall back to keyword scan
      const donationKeywords = ['gave', 'gave away', 'gave them', 'gave her', 'gave him', 'for free', 'free', 'donated', 'sample', 'treat', 'gift', 'complimentary', 'bundt cake', 'bundtlet', 'cake'];
      const notesLower = rawNotes.toLowerCase();
      const hasDonationKeywords = donationKeywords.some((k) => notesLower.includes(k));

      if (extracted.donation || hasDonationKeywords) {
        setIncludeDonation(true);
        if (extracted.donation) {
          const d = extracted.donation;
          const customItems: Record<string, number> = {};
          for (const product of products.filter((p) => p.isActive)) {
            if (!SLUG_TO_FIELD[product.slug] && typeof d[product.slug] === 'number' && (d[product.slug] as number) > 0) {
              customItems[product.id] = d[product.slug] as number;
            }
          }
          setDonationData({
            freeBundletCard: (d.freeBundletCard as number) ?? 0,
            dozenBundtinis: (d.dozenBundtinis as number) ?? 0,
            cake8inch: (d.cake8inch as number) ?? 0,
            cake10inch: (d.cake10inch as number) ?? 0,
            sampleTray: (d.sampleTray as number) ?? 0,
            bundtletTower: (d.bundtletTower as number) ?? 0,
            customItems: Object.keys(customItems).length > 0 ? customItems : undefined,
            cakesDonatedNotes: (d.cakesDonatedNotes as string) || '',
            orderedFromUs: (d.orderedFromUs as boolean) ?? false,
            followedUp: (d.followedUp as boolean) ?? false,
          });
        }
      }

      setHasExtracted(true);
    } catch (err) {
      console.error('AI extraction error:', err);
      setError('AI processing failed. You can fill the fields in manually below.');
      setHasExtracted(true);
    } finally {
      setAiProcessing(false);
    }
  };

  const handleClear = () => {
    setRawNotes('');
    setHasExtracted(false);
    setForm({
      name: '',
      email: '',
      phone: '',
      personalDetails: '',
      reachoutNote: '',
      reachoutType: 'meeting',
      followUpDays: 3,
    });
    setIncludeDonation(false);
    setDonationData(createEmptyDonation(products));
    setError('');
    setSuccess(false);
    setSelectedBusinessId(defaultBusinessId || '');
    setShowNewBusiness(false);
    setNewBusinessName('');
    setNewBusinessAddress({ address: '', city: '', state: '', zipCode: '' });
    setNewBusinessPlaceId(null);
    typedPrefixRef.current = '';
    clearTranscript();
    if (isListening) stopListening();
  };

  const handleCreateBusiness = () => {
    if (!newBusinessName.trim()) {
      setError('Business name is required');
      return;
    }
    if (!permissions.currentStoreId) {
      setError('Please select a store first');
      return;
    }
    setError('');
    setShowPlacePicker(true);
  };

  const finishCreateBusiness = async (placeId?: string) => {
    setCreatingBusiness(true);
    setError('');
    try {
      const storeId = permissions.currentStoreId!;
      // Generate the id client-side so the queued POST is idempotent on retry
      // and we can keep working offline.
      const newId = crypto.randomUUID();
      const optimistic: Business = {
        id: newId,
        storeId,
        name: newBusinessName.trim(),
        address: newBusinessAddress.address || undefined,
        city: newBusinessAddress.city || undefined,
        state: newBusinessAddress.state || undefined,
        zipCode: newBusinessAddress.zipCode || undefined,
        placeId: placeId || newBusinessPlaceId || undefined,
        createdAt: new Date(),
        createdBy: userId || '',
      };

      await api.queuePost(`/businesses?storeId=${storeId}`, {
        id: newId,
        name: optimistic.name,
        address: optimistic.address,
        city: optimistic.city,
        state: optimistic.state,
        zipCode: optimistic.zipCode,
        placeId: optimistic.placeId,
      }, { label: `New business · ${optimistic.name}` });

      // Optimistically add the business to the picker so the user can keep
      // working before the server replies.
      setBusinesses((prev) => {
        if (prev.some((b) => b.id === newId)) return prev;
        return [...prev, optimistic].sort((a, b) => a.name.localeCompare(b.name));
      });
      setSelectedBusinessId(newId);
      setNewBusinessName('');
      setNewBusinessAddress({ address: '', city: '', state: '', zipCode: '' });
      setNewBusinessPlaceId(null);
      setShowNewBusiness(false);
      setShowPlacePicker(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create business';
      setError(message);
    } finally {
      setCreatingBusiness(false);
    }
  };

  const handleSubmit = async () => {
    setError('');
    setSuccess(false);

    if (!userId) {
      setError('You must be logged in to save a visit');
      return;
    }
    if (!selectedBusinessId) {
      setError('Pick or create a business for this contact first');
      return;
    }
    if (!permissions.currentStoreId) {
      setError('Please select a store first');
      return;
    }

    setLoading(true);
    try {
      const now = new Date();
      const { firstName, lastName } = splitName(form.name);
      const storeId = permissions.currentStoreId;
      const contactName = `${firstName} ${lastName}`.trim() || form.email || 'New contact';

      // Client-generate everything that previously required server-side ids,
      // so the entire save chain can survive a network drop.
      const newContactId = crypto.randomUUID();
      const reachoutLogEventId = crypto.randomUUID();
      const followUpEventId = crypto.randomUUID();
      const initialReachout: Reachout = {
        id: `reach-${Date.now()}`,
        date: now,
        note: form.reachoutNote || rawNotes || 'Initial contact',
        rawNotes: rawNotes || null,
        createdBy: userId,
        type: form.reachoutType,
        donation: includeDonation ? donationData : undefined,
      };

      // Step 1 — try AI follow-up suggestion online. If it fails for any
      // reason (offline, slow, API down), fall back to the user-picked
      // "follow up in N days" preset. Either way, we never block saving.
      let suggestedFollowUpDate: Date;
      let suggestedFollowUpMethod: 'email' | 'call' | 'meeting' | 'text' | 'other' | null;
      let suggestedFollowUpNote: string | null = null;
      let suggestedFollowUpPriority: 'low' | 'medium' | 'high' | null = 'medium';
      let aiSuggestionApplied = false;

      try {
        if (navigator.onLine) {
          const aiSuggestion = await generateFollowUpSuggestion({
            firstName: firstName || undefined,
            lastName: lastName || undefined,
            reachouts: [
              {
                date: initialReachout.date,
                note: initialReachout.note || '',
                type: initialReachout.type || 'other',
                donation: initialReachout.donation,
              },
            ],
            personalDetails: form.personalDetails || undefined,
            status: 'new',
            email: form.email || undefined,
            phone: form.phone || undefined,
          });
          suggestedFollowUpDate = new Date(aiSuggestion.suggestedDate);
          suggestedFollowUpMethod = aiSuggestion.suggestedMethod || null;
          suggestedFollowUpNote = aiSuggestion.message || null;
          suggestedFollowUpPriority = aiSuggestion.priority || 'medium';
          aiSuggestionApplied = true;
        } else {
          throw new Error('offline');
        }
      } catch (aiErr) {
        if ((aiErr as Error)?.message !== 'offline') {
          console.warn('AI follow-up generation failed, using fallback:', aiErr);
        }
        suggestedFollowUpDate = new Date(now);
        suggestedFollowUpDate.setDate(suggestedFollowUpDate.getDate() + form.followUpDays);
        suggestedFollowUpMethod = form.email ? 'email' : form.phone ? 'call' : 'meeting';
      }

      // Step 2 — create the contact. Pass a client-generated UUID so the
      // POST is idempotent on retry and the rest of the chain can run
      // immediately (even offline) referencing this id.
      await api.queuePost(`/contacts?storeId=${storeId}`, {
        id: newContactId,
        businessId: selectedBusinessId,
        firstName: firstName || null,
        lastName: lastName || null,
        email: form.email || null,
        phone: form.phone || null,
        personalDetails: form.personalDetails || null,
        status: 'new',
      }, { label: `New contact · ${contactName}` });

      // Step 3 — attach the initial reachout + follow-up suggestion. PATCH
      // bodies send the full reachouts array, which makes them idempotent.
      await api.queuePatch(`/contacts/${newContactId}`, {
        suggestedFollowUpDate: suggestedFollowUpDate.toISOString(),
        suggestedFollowUpMethod: suggestedFollowUpMethod || null,
        suggestedFollowUpNote: suggestedFollowUpNote || null,
        suggestedFollowUpPriority: suggestedFollowUpPriority || null,
        lastReachoutDate: now.toISOString(),
        reachouts: [initialReachout],
      }, { label: `Log visit · ${contactName}` });

      // Step 4 — log the reachout on the calendar so it appears in history
      if (form.reachoutNote || rawNotes) {
        const normalizedNow = new Date(now);
        normalizedNow.setHours(0, 0, 0, 0);
        await api.queuePost(`/calendar-events?storeId=${storeId}`, {
          id: reachoutLogEventId,
          title: `Reachout: ${firstName || lastName || 'New Contact'}`,
          description: form.reachoutNote || rawNotes || null,
          date: normalizedNow.toISOString(),
          type: 'reachout',
          contactId: newContactId,
          businessId: selectedBusinessId,
          priority: 'medium',
          status: 'completed',
          createdBy: userId,
        }, { label: `Reachout log · ${contactName}` });
      }

      // Step 5 — schedule the follow-up event
      {
        const normalizedDate = new Date(suggestedFollowUpDate);
        normalizedDate.setHours(0, 0, 0, 0);
        await api.queuePost(`/calendar-events?storeId=${storeId}`, {
          id: followUpEventId,
          title: `Follow-up: ${contactName}`,
          description: suggestedFollowUpNote || `Follow up with ${contactName}`,
          date: normalizedDate.toISOString(),
          type: 'followup',
          contactId: newContactId,
          businessId: selectedBusinessId,
          priority: suggestedFollowUpPriority || 'medium',
          status: 'scheduled',
          createdBy: userId,
        }, { label: `Schedule follow-up · ${contactName}` });
      }

      // Donation tracker animation (only when mouths were actually given)
      if (includeDonation && totalMouths > 0) {
        setLastDonationMouths(totalMouths);
        triggerRefresh();
      }
      // Broadcast "data has changed" so any visible page reloads under us
      bumpDataVersion();

      // Tailor the success toast to what actually happened
      const wasOffline = !navigator.onLine;
      const parts: string[] = [];
      if (wasOffline) {
        parts.push('Saved offline');
      } else {
        parts.push('Saved');
      }
      if (includeDonation && totalMouths > 0) {
        parts.push(`${totalMouths} mouths logged`);
      }
      parts.push(
        aiSuggestionApplied
          ? 'follow-up scheduled'
          : `follow-up in ${form.followUpDays} day${form.followUpDays === 1 ? '' : 's'}`
      );
      setSuccessMessage(parts.join(' · '));
      setSuccess(true);
      haptics.success();
      handleClear();
      onSuccess?.();
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save visit';
      setError(message);
      haptics.error();
    } finally {
      setLoading(false);
    }
  };

  // Whether the user has dictated/typed at least *something* worth processing
  const hasNotes = rawNotes.trim().length > 0;

  const handleNearbyPlaceTap = (place: NearbyPlace) => {
    // Pre-fill: drop the business name into the raw notes so AI extraction will
    // pick it up, and stage the place as the new-business candidate. The
    // /places-nearby endpoint already filters out places we already have, so
    // this branch is always a "new business" — no need to also check `businesses`.
    const prefix = `Visited ${place.name}. `;
    setRawNotes((prev) => (prev.trim() ? `${prefix}${prev}` : prefix));
    setShowNewBusiness(true);
    setNewBusinessName(place.name);
    setNewBusinessPlaceId(place.placeId);
    setNewBusinessAddress((prev) => ({
      address: place.address || prev.address,
      city: prev.city,
      state: prev.state,
      zipCode: prev.zipCode,
    }));
    setSelectedBusinessId('');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Top-of-form offline notice — explains exactly which features are
          paused and reassures the marketer that their typing/save still
          works. The global ribbon in MainLayout covers the "you have no
          signal" headline; this one details the QuickAdd-specific impact. */}
      <OnlineOnlyNotice
        feature="AI fields & dictation"
        message="No service — AI fields and dictation are paused. Type your visit below and tap Save; it'll sync when you're back."
      />

      {/* Nearby business suggestions (geolocation-based, opt-in via browser prompt) */}
      <NearbyPlacesChips
        storeId={permissions.currentStoreId}
        onSelect={handleNearbyPlaceTap}
      />

      {/* Step 1: dictate / type the visit */}
      <Box>
        <TextField
          value={rawNotes}
          onChange={(e) => setRawNotes(e.target.value)}
          placeholder='e.g. "Visited Sarah at Lewis Bank, dropped off a sample tray. She loves hiking. Wants to chat about a corporate order next week."'
          multiline
          minRows={4}
          maxRows={10}
          fullWidth
          autoFocus={!isMobile}
          disabled={loading || aiProcessing}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end" sx={{ alignSelf: 'flex-start', mt: 1, mr: -0.5 }}>
                  <Tooltip
                    title={!isOnline ? 'Dictation needs service' : isListening ? 'Stop dictation' : 'Start dictation'}
                    enterTouchDelay={0}
                  >
                    {/* span wrapper lets the tooltip show even when the button is disabled */}
                    <span>
                      <IconButton
                        onClick={isListening ? stopListening : startListening}
                        size="small"
                        disabled={!isOnline}
                        aria-label={isListening ? 'Stop dictation' : 'Start dictation'}
                        sx={{
                          bgcolor: isListening ? '#e74c3c' : 'rgba(245, 200, 66, 0.2)',
                          color: isListening ? '#fff' : '#2d2d2d',
                          width: 40,
                          height: 40,
                          '&:hover': {
                            bgcolor: isListening ? '#c0392b' : 'rgba(245, 200, 66, 0.35)',
                          },
                          '&.Mui-disabled': {
                            bgcolor: 'rgba(0,0,0,0.04)',
                            color: 'rgba(0,0,0,0.26)',
                          },
                        }}
                      >
                        {isListening ? <MicOffIcon /> : <MicIcon />}
                      </IconButton>
                    </span>
                  </Tooltip>
                </InputAdornment>
              ),
            },
            htmlInput: {
              autoCapitalize: 'sentences',
              autoCorrect: 'on',
            },
          }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
          {isListening && (
            <Chip
              size="small"
              label="Listening…"
              sx={{
                bgcolor: 'rgba(231, 76, 60, 0.12)',
                color: '#c0392b',
                fontWeight: 600,
                '& .MuiChip-label': { px: 1 },
              }}
            />
          )}
          {!isListening && (
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
              {isOnline
                ? 'Tip: tap the mic key on your keyboard to dictate hands-free.'
                : 'No service — type your notes; we\'ll save them on this device.'}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          {hasNotes && !aiProcessing && (
            <Button size="small" startIcon={<ClearIcon />} onClick={handleClear} disabled={loading}>
              Clear
            </Button>
          )}
        </Box>
      </Box>

      {voiceError && (
        <Alert severity="info" sx={{ py: 0.5 }}>
          {voiceError}. You can still type or use the mic on your phone keyboard.
        </Alert>
      )}

      {/* Step 2: extract with AI — only shown when online. When offline, the
          useEffect above auto-flips `hasExtracted` so the manual review form
          is visible right away (no broken-button confusion). */}
      {!hasExtracted && isOnline && (
        <Button
          variant="contained"
          size="large"
          fullWidth
          startIcon={aiProcessing ? <CircularProgress size={18} color="inherit" /> : <AIIcon />}
          onClick={handleProcess}
          disabled={!hasNotes || aiProcessing || loading}
          sx={{
            bgcolor: '#f5c842',
            color: '#2d2d2d',
            py: 1.5,
            fontWeight: 700,
            fontSize: '1rem',
            '&:hover': { bgcolor: '#e8b923' },
            '&.Mui-disabled': { bgcolor: 'rgba(0,0,0,0.08)' },
          }}
        >
          {aiProcessing ? 'Extracting…' : 'Extract with AI'}
        </Button>
      )}

      {error && (
        <Alert severity="error" onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {success && <Alert severity="success">{successMessage}</Alert>}

      {/* Step 3: review extracted fields */}
      <Collapse in={hasExtracted} timeout={300} unmountOnExit>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 700 }}>
              {isOnline ? 'AI found' : 'Fill in the details'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {isOnline
                ? 'Tap any field to edit, then save.'
                : "We'll save your visit on this device and finish syncing when you're back online."}
            </Typography>
          </Box>

          {/* Contact name */}
          <TextField
            label="Contact name"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            fullWidth
            disabled={loading}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <PersonIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              },
              htmlInput: { autoCapitalize: 'words', autoComplete: 'name' },
            }}
          />

          {/* Business */}
          <Autocomplete
            value={selectedBusiness}
            options={businesses}
            getOptionLabel={(o) => o.name}
            onChange={(_, value) => {
              setSelectedBusinessId(value?.id || '');
              if (value) setShowNewBusiness(false);
            }}
            disabled={loading || showNewBusiness}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Business"
                placeholder="Search or pick a business"
                slotProps={{
                  input: {
                    ...params.InputProps,
                    startAdornment: (
                      <>
                        <InputAdornment position="start">
                          <BusinessIcon fontSize="small" color="action" />
                        </InputAdornment>
                        {params.InputProps.startAdornment}
                      </>
                    ),
                  },
                }}
              />
            )}
          />

          {!showNewBusiness ? (
            <Button
              size="small"
              startIcon={<BusinessIcon />}
              onClick={() => {
                setShowNewBusiness(true);
                setSelectedBusinessId('');
              }}
              disabled={loading}
              sx={{ alignSelf: 'flex-start' }}
            >
              + New business
            </Button>
          ) : (
            <Box
              sx={{
                p: 1.5,
                bgcolor: 'rgba(245, 200, 66, 0.08)',
                border: '1px solid rgba(245, 200, 66, 0.3)',
                borderRadius: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                New business
              </Typography>
              <TextField
                size="small"
                label="Business name"
                value={newBusinessName}
                onChange={(e) => setNewBusinessName(e.target.value)}
                autoFocus
                disabled={creatingBusiness}
                fullWidth
                slotProps={{ htmlInput: { autoCapitalize: 'words' } }}
              />
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Button
                  size="small"
                  onClick={() => {
                    setShowNewBusiness(false);
                    setNewBusinessName('');
                  }}
                  disabled={creatingBusiness}
                >
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleCreateBusiness}
                  disabled={creatingBusiness || !newBusinessName.trim()}
                  startIcon={creatingBusiness ? <CircularProgress size={14} /> : undefined}
                >
                  {creatingBusiness ? 'Creating…' : 'Create'}
                </Button>
              </Stack>
            </Box>
          )}

          {/* Email + phone (two-column on wider screens) */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              fullWidth
              disabled={loading}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <EmailIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                },
                htmlInput: { inputMode: 'email', autoComplete: 'email', autoCapitalize: 'none', autoCorrect: 'off' },
              }}
            />
            <TextField
              label="Phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              fullWidth
              disabled={loading}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <PhoneIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                },
                htmlInput: { inputMode: 'tel', autoComplete: 'tel' },
              }}
            />
          </Stack>

          {/* Reachout type chips */}
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
              How did you reach them?
            </Typography>
            <ToggleButtonGroup
              value={form.reachoutType}
              exclusive
              onChange={(_, val) => val && setForm((p) => ({ ...p, reachoutType: val as ReachoutType }))}
              fullWidth
              size="small"
              sx={{
                '& .MuiToggleButton-root': {
                  py: 1,
                  textTransform: 'none',
                  fontWeight: 500,
                  borderColor: 'rgba(0,0,0,0.15)',
                  '&.Mui-selected': {
                    bgcolor: 'rgba(245, 200, 66, 0.25)',
                    borderColor: '#f5c842',
                    color: '#2d2d2d',
                    fontWeight: 700,
                    '&:hover': { bgcolor: 'rgba(245, 200, 66, 0.35)' },
                  },
                },
              }}
            >
              {REACHOUT_TYPES.map((t) => (
                <ToggleButton key={t.value} value={t.value} aria-label={t.label}>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    {t.icon}
                    <span>{t.label}</span>
                  </Stack>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          {/* Personal details */}
          <TextField
            label="Personal details"
            placeholder="Hobbies, family, interests"
            value={form.personalDetails}
            onChange={(e) => setForm((p) => ({ ...p, personalDetails: e.target.value }))}
            fullWidth
            disabled={loading}
            multiline
            maxRows={3}
            helperText="Fun facts to build rapport later"
          />

          {/* Reachout summary note (always editable) */}
          <TextField
            label="Visit summary"
            value={form.reachoutNote}
            onChange={(e) => setForm((p) => ({ ...p, reachoutNote: e.target.value }))}
            fullWidth
            disabled={loading}
            multiline
            minRows={2}
            maxRows={6}
            helperText="Saved to the contact's history"
          />

          {/* Donation toggle + steppers */}
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={includeDonation}
                  onChange={(e) => {
                    setIncludeDonation(e.target.checked);
                    if (!e.target.checked) setDonationData(createEmptyDonation(products));
                  }}
                  disabled={loading}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CakeIcon fontSize="small" />
                  <Typography>Donated products</Typography>
                  {includeDonation && totalMouths > 0 && (
                    <Chip
                      size="small"
                      label={`${totalMouths} mouths`}
                      sx={{ bgcolor: '#f5c842', color: '#2d2d2d', fontWeight: 700, ml: 1 }}
                    />
                  )}
                </Box>
              }
            />
            <Collapse in={includeDonation}>
              <Box sx={{ mt: 1 }}>
                <DonationProductFields
                  products={products}
                  donationData={donationData}
                  onChange={setDonationData}
                />
                <TextField
                  label="Donation notes (optional)"
                  size="small"
                  fullWidth
                  multiline
                  maxRows={3}
                  value={donationData.cakesDonatedNotes || ''}
                  onChange={(e) => setDonationData((prev) => ({ ...prev, cakesDonatedNotes: e.target.value }))}
                  placeholder="e.g. dropped sample tray at front desk"
                  sx={{ mt: 2 }}
                  disabled={loading}
                />
              </Box>
            </Collapse>
          </Box>

          {/* Follow-up preset chips */}
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
              Follow up in
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              {FOLLOW_UP_PRESETS.map((preset) => {
                const active = form.followUpDays === preset.days;
                return (
                  <Chip
                    key={preset.days}
                    label={preset.label}
                    clickable
                    onClick={() => setForm((p) => ({ ...p, followUpDays: preset.days }))}
                    variant={active ? 'filled' : 'outlined'}
                    sx={{
                      bgcolor: active ? '#f5c842' : 'transparent',
                      color: '#2d2d2d',
                      fontWeight: active ? 700 : 500,
                      borderColor: active ? '#f5c842' : 'rgba(0,0,0,0.2)',
                      '&:hover': { bgcolor: active ? '#e8b923' : 'rgba(245, 200, 66, 0.12)' },
                    }}
                  />
                );
              })}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              AI may pick a smarter date based on the visit context.
            </Typography>
          </Box>

          {/* Save */}
          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={handleSubmit}
            disabled={loading || aiProcessing}
            startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
            sx={{
              bgcolor: '#f5c842',
              color: '#2d2d2d',
              py: 1.5,
              fontWeight: 700,
              fontSize: '1rem',
              '&:hover': { bgcolor: '#e8b923' },
              '&.Mui-disabled': { bgcolor: 'rgba(0,0,0,0.08)' },
              mt: 0.5,
            }}
          >
            {loading ? 'Saving…' : 'Save visit'}
          </Button>
        </Stack>
      </Collapse>

      <PlaceMatchPicker
        open={showPlacePicker}
        businessName={newBusinessName}
        businessAddress={newBusinessAddress.address}
        businessCity={newBusinessAddress.city}
        businessState={newBusinessAddress.state}
        businessZipCode={newBusinessAddress.zipCode}
        onSelect={(place: PlaceResult) => finishCreateBusiness(place.placeId)}
        onSkip={() => finishCreateBusiness()}
        onClose={() => setShowPlacePicker(false)}
      />
    </Box>
  );
}
