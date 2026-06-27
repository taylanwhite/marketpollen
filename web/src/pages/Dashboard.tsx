import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { useDonation } from '../contexts/DonationContext';
import { useOffline } from '../contexts/OfflineContext';
import { ContactForm } from '../components/ContactForm';

// Heavy modals — pulled in on demand to keep the contacts list snappy on
// first paint, especially on slow LTE.
const EditContactModal = lazy(() =>
  import('../components/EditContactModal').then((m) => ({ default: m.EditContactModal }))
);
const ContactActionsSheet = lazy(() =>
  import('../components/ContactActionsSheet').then((m) => ({ default: m.ContactActionsSheet }))
);
const GenerateEmailDialog = lazy(() =>
  import('../components/GenerateEmailDialog').then((m) => ({ default: m.GenerateEmailDialog }))
);
import { PullToRefreshIndicator } from '../components/PullToRefreshIndicator';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { ContactsListSkeleton } from '../components/ContactsListSkeleton';
import { haptics } from '../utils/haptics';
import { useTheme } from '@mui/material/styles';
import { useMediaQuery } from '@mui/material';
import { extractContactInfo, generateFollowUpSuggestion } from '../utils/openai';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { Contact, FollowUpSuggestion, Reachout, DonationData, SLUG_TO_FIELD } from '../types';
import { calculateMouths, createEmptyDonation } from '../utils/donationCalculations';
import { useCampaign } from '../contexts/CampaignContext';
import { DonationProductFields } from '../components/DonationProductFields';
import { OnlineOnlyNotice } from '../components/OnlineOnlyNotice';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  CardActions,
  Chip,
  Grid,
  Paper,
  InputAdornment,
  Collapse,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  MenuItem,
  FormControlLabel,
  Switch,
  Checkbox,
  Divider,
  Snackbar,
  Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Add as AddIcon,
  Close as CloseIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  Business as BusinessIcon,
  CalendarMonth as CalendarIcon,
  Person as PersonIcon,
  AddComment as AddCommentIcon,
  ContentCopy as ContentCopyIcon,
  Refresh as RefreshIcon,
  Mic as MicIcon,
  MicOff as MicOffIcon,
  AutoAwesome as AIIcon,
  Cake as CakeIcon,
  EventAvailable as EventAvailableIcon,
  Check as CheckIcon,
} from '@mui/icons-material';

export function Dashboard() {
  const { userId } = useAuth();
  const { permissions, canEdit, loading: permissionsLoading } = usePermissions();
  const { triggerRefresh, setLastDonationMouths, dataVersion, bumpDataVersion } = useDonation();
  const { syncedCount, isOnline } = useOffline();
  const { products } = useCampaign();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const businessFilter = searchParams.get('business');
  
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [businesses, setBusinesses] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [followUpSuggestions, setFollowUpSuggestions] = useState<FollowUpSuggestion[]>([]);
  const [followUpDialogOpen, setFollowUpDialogOpen] = useState(false);
  const [followUpDialogContact, setFollowUpDialogContact] = useState<Contact | null>(null);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [copyToastOpen, setCopyToastOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showNoDonationsOnly, setShowNoDonationsOnly] = useState(false);
  
  // Quick reachout dialog
  const [quickReachoutContact, setQuickReachoutContact] = useState<Contact | null>(null);
  const [actionSheetContact, setActionSheetContact] = useState<Contact | null>(null);
  const [emailDialogContact, setEmailDialogContact] = useState<Contact | null>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const pullState = usePullToRefresh({
    onRefresh: () => loadData(),
    enabled: isMobile,
  });
  const [quickReachoutData, setQuickReachoutData] = useState({ note: '', type: 'call' as 'call' | 'email' | 'meeting' | 'text' | 'other' });
  const [quickReachoutLoading, setQuickReachoutLoading] = useState(false);
  const [quickReachoutError, setQuickReachoutError] = useState('');
  const [aiProcessing, setAiProcessing] = useState(false);
  // Holds the marketer's original dictation/typing if they later tap "Clean
  // up with AI" — keeps the pre-AI version for the audit trail (rawNotes
  // column) without exposing it as a second textarea in the UI.
  const preAiTextRef = useRef<string | null>(null);
  // Snapshot of what was typed BEFORE the mic was tapped, so dictated speech
  // appends to existing notes instead of replacing them.
  const typedPrefixRef = useRef<string>('');
  
  // Donation fields for quick reachout
  const [includeDonation, setIncludeDonation] = useState(false);
  const [donationData, setDonationData] = useState<DonationData>(createEmptyDonation(products));
  
  const { transcript, interimTranscript, isListening, startListening, stopListening, clearTranscript, error: voiceError } = useVoiceInput();

  useEffect(() => {
    // Don't redirect if permissions are still loading
    if (permissionsLoading) return;
    
    // Everyone (including global admins) must have a store selected
    if (!permissions.currentStoreId && permissions.storePermissions.length > 0) {
      // User has permissions but no store selected - redirect to picker
      navigate('/select-store');
      return;
    }
    
    // Only load data if we have a store selected
    if (permissions.currentStoreId) {
      loadData();
    }
    // dataVersion fires after a save from elsewhere (the global QuickAdd
    // sheet, the action bottom sheet, etc.) so the list immediately re-fetches.
    // syncedCount fires after the offline queue drains a queued write to the
    // server — without this, contacts created offline would stay invisible
    // until pull-to-refresh.
  }, [permissions.currentStoreId, permissions.storePermissions.length, permissionsLoading, navigate, dataVersion, syncedCount]);

  useEffect(() => {
    let filtered = contacts;
    
    if (businessFilter) {
      filtered = filtered.filter(c => c.businessId === businessFilter);
    }

    if (showNoDonationsOnly) {
      filtered = filtered.filter(c => !c.reachouts.some(r => !!r.donation));
    }
    
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(c => {
        const name = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
        const businessName = (businesses.get(c.businessId) || '').toLowerCase();
        return (
          name.includes(term) ||
          (c.email?.toLowerCase() || '').includes(term) ||
          (c.phone?.toLowerCase() || '').includes(term) ||
          businessName.includes(term) ||
          (c.personalDetails?.toLowerCase() || '').includes(term)
        );
      });
    }
    
    setFilteredContacts(filtered);
  }, [businessFilter, contacts, searchTerm, businesses, showNoDonationsOnly]);

  // When the user taps Record, snapshot whatever they had already typed so
  // the dictated transcript appends to it instead of clobbering it.
  useEffect(() => {
    if (isListening) {
      typedPrefixRef.current = quickReachoutData.note;
    }
    // Intentionally only depend on isListening — we don't want to re-snapshot
    // every keystroke while the mic is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]);

  useEffect(() => {
    if (!quickReachoutContact) return;
    if (!transcript && !interimTranscript) return;
    const spoken = interimTranscript ? `${transcript} ${interimTranscript}` : transcript;
    const prefix = typedPrefixRef.current;
    const merged = prefix
      ? `${prefix.trimEnd()}${prefix.trim() ? ' ' : ''}${spoken}`
      : spoken;
    setQuickReachoutData(prev => ({ ...prev, note: merged }));
  }, [transcript, interimTranscript, quickReachoutContact]);

  // If the user loses signal mid-dictation, kill the mic immediately. Web
  // Speech recognition silently goes deaf without a connection on most
  // browsers and would otherwise look like it's still listening.
  useEffect(() => {
    if (!isOnline && isListening) stopListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const loadData = async () => {
    try {
      // Everyone (including global admins) must have a store selected
      if (!permissions.currentStoreId) {
        setContacts([]);
        setBusinesses(new Map());
        setLoading(false);
        return;
      }

      const businessList = await api.get<{ id: string; name: string }[]>(`/businesses?storeId=${permissions.currentStoreId}`);
      const businessMap = new Map<string, string>();
      businessList.forEach((b) => businessMap.set(b.id, b.name));
      setBusinesses(businessMap);

      const contactsData = await api.get<Contact[]>(`/contacts?storeId=${permissions.currentStoreId}`);
      contactsData.forEach((c) => {
        if (c.reachouts) {
          c.reachouts = c.reachouts.map((r) => ({
            ...r,
            date: r.date instanceof Date ? r.date : new Date(r.date),
          }));
        }
        if (c.createdAt && !(c.createdAt instanceof Date)) c.createdAt = new Date(c.createdAt);
        if (c.lastReachoutDate && !(c.lastReachoutDate instanceof Date)) c.lastReachoutDate = new Date(c.lastReachoutDate);
        if (c.suggestedFollowUpDate && !(c.suggestedFollowUpDate instanceof Date)) c.suggestedFollowUpDate = new Date(c.suggestedFollowUpDate);
      });
      contactsData.sort((a, b) => {
        const aDate = a.lastReachoutDate || a.createdAt;
        const bDate = b.lastReachoutDate || b.createdAt;
        return (bDate?.getTime() ?? 0) - (aDate?.getTime() ?? 0);
      });
      setContacts(contactsData);
    } catch (error) {
      console.error('Error loading data:', error);
      // On error, don't show any data to prevent leaking data
      setContacts([]);
      setBusinesses(new Map());
    } finally {
      setLoading(false);
    }
  };

  const handleContactClick = (contact: Contact) => {
    if (isMobile) {
      // On mobile, surface the high-frequency actions (call/text/email) first
      setActionSheetContact(contact);
    } else {
      setEditingContact(contact);
    }
  };

  const handleOpenFollowUpDialog = (contact: Contact) => {
    setFollowUpDialogContact(contact);
    setFollowUpDialogOpen(true);
    
    // Use stored follow-up suggestions from the contact (generated when contact was created/reachout was added)
    const suggestions: FollowUpSuggestion[] = [];
    
    if (contact.suggestedFollowUpDate && contact.suggestedFollowUpNote) {
      suggestions.push({
        suggestedDate: contact.suggestedFollowUpDate,
        message: contact.suggestedFollowUpNote,
        type: contact.suggestedFollowUpMethod || 'email',
        priority: contact.suggestedFollowUpPriority || 'medium',
        contactId: contact.id,
        contactName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'Contact'
      });
    }
    
    setFollowUpSuggestions(suggestions);
  };

  const handleCloseFollowUpDialog = () => {
    setFollowUpDialogOpen(false);
    setFollowUpDialogContact(null);
    setFollowUpSuggestions([]);
    setFollowUpLoading(false);
    setAddedToCalendar(false);
  };

  const handleRegenerateFollowUp = async () => {
    if (!followUpDialogContact) return;

    setFollowUpLoading(true);
    setAddedToCalendar(false);
    try {
      const aiSuggestion = await generateFollowUpSuggestion({
        firstName: followUpDialogContact.firstName || undefined,
        lastName: followUpDialogContact.lastName || undefined,
        reachouts: followUpDialogContact.reachouts.map(r => ({
          date: r.date instanceof Date ? r.date : new Date(r.date),
          note: r.note || '',
          type: r.type || 'other',
          donation: r.donation
        })),
        personalDetails: followUpDialogContact.personalDetails || undefined,
        status: followUpDialogContact.status || undefined,
        email: followUpDialogContact.email || undefined,
        phone: followUpDialogContact.phone || undefined,
      });

      // Normalize date to midnight local time to avoid timezone issues
      const suggestedDate = new Date(aiSuggestion.suggestedDate);
      const normalizedDate = new Date(suggestedDate);
      normalizedDate.setHours(0, 0, 0, 0);

      await api.queuePatch(`/contacts/${followUpDialogContact.id}`, {
        suggestedFollowUpDate: normalizedDate,
        suggestedFollowUpMethod: aiSuggestion.suggestedMethod || null,
        suggestedFollowUpNote: aiSuggestion.message || null,
        suggestedFollowUpPriority: aiSuggestion.priority || null,
      }, { label: 'Save follow-up suggestion' });

      // Update local contact state
      const updatedContact = {
        ...followUpDialogContact,
        suggestedFollowUpDate: normalizedDate,
        suggestedFollowUpMethod: aiSuggestion.suggestedMethod || null,
        suggestedFollowUpNote: aiSuggestion.message || null,
        suggestedFollowUpPriority: aiSuggestion.priority || null,
      };
      setFollowUpDialogContact(updatedContact);

      // Update suggestions in dialog
      const suggestions: FollowUpSuggestion[] = [{
        suggestedDate: normalizedDate,
        message: aiSuggestion.message,
        type: aiSuggestion.suggestedMethod || 'email',
        priority: aiSuggestion.priority || 'medium',
        contactId: updatedContact.id,
        contactName: `${updatedContact.firstName || ''} ${updatedContact.lastName || ''}`.trim() || updatedContact.email || 'Contact'
      }];
      setFollowUpSuggestions(suggestions);

      // Update the contact in the main contacts list
      setContacts(prev => prev.map(c => 
        c.id === updatedContact.id ? updatedContact : c
      ));
    } catch (error) {
      console.error('Error regenerating follow-up suggestion:', error);
    } finally {
      setFollowUpLoading(false);
    }
  };

  const [addingToCalendar, setAddingToCalendar] = useState(false);
  const [addedToCalendar, setAddedToCalendar] = useState(false);

  const handleAddSuggestionToCalendar = async (suggestion: FollowUpSuggestion) => {
    if (!followUpDialogContact || !permissions.currentStoreId) return;
    setAddingToCalendar(true);
    try {
      const contactName = `${followUpDialogContact.firstName || ''} ${followUpDialogContact.lastName || ''}`.trim() || followUpDialogContact.email || 'Contact';
      const suggestedDate = suggestion.suggestedDate instanceof Date
        ? suggestion.suggestedDate
        : new Date(suggestion.suggestedDate);
      const normalizedDate = new Date(suggestedDate);
      normalizedDate.setHours(0, 0, 0, 0);

      await api.queuePost(`/calendar-events?storeId=${permissions.currentStoreId}`, {
        id: crypto.randomUUID(),
        title: `Follow-up: ${contactName}`,
        description: suggestion.message,
        date: normalizedDate,
        type: 'followup',
        contactId: followUpDialogContact.id,
        businessId: followUpDialogContact.businessId,
        priority: suggestion.priority || 'medium',
        status: 'scheduled',
      }, { label: `Schedule follow-up · ${contactName}` });

      setAddedToCalendar(true);
    } catch (err) {
      console.error('Failed to add to calendar:', err);
    } finally {
      setAddingToCalendar(false);
    }
  };

  const handleCopySuggestion = async (suggestion: FollowUpSuggestion) => {
    try {
      await navigator.clipboard.writeText(suggestion.message);
      setCopyToastOpen(true);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const getContactName = (contact: Contact) => {
    if (contact.firstName || contact.lastName) {
      return `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
    }
    return contact.email || contact.phone || contact.contactId;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'success';
      case 'pending': return 'warning';
      case 'closed': return 'error';
      default: return 'info';
    }
  };

  const openQuickReachout = (contact: Contact) => {
    setQuickReachoutContact(contact);
    setQuickReachoutData({ note: '', type: 'call' });
    setQuickReachoutError('');
    setIncludeDonation(false);
    setDonationData(createEmptyDonation(products));
    preAiTextRef.current = null;
    typedPrefixRef.current = '';
    clearTranscript();
  };

  const closeQuickReachout = () => {
    setQuickReachoutContact(null);
    setQuickReachoutData({ note: '', type: 'call' });
    setQuickReachoutError('');
    setIncludeDonation(false);
    setDonationData(createEmptyDonation(products));
    preAiTextRef.current = null;
    typedPrefixRef.current = '';
    if (isListening) stopListening();
    clearTranscript();
  };

  const processWithAI = async () => {
    const original = quickReachoutData.note;
    if (!original.trim()) {
      setQuickReachoutError('Type or dictate something first.');
      return;
    }

    setAiProcessing(true);
    setQuickReachoutError('');
    haptics.tap();

    // Stash the user's pre-AI text so we can still write it to the rawNotes
    // column (audit trail) even though the textarea is about to be replaced.
    preAiTextRef.current = original;

    try {
      const extracted = await extractContactInfo(
        original,
        products.filter(p => p.isActive).map(p => ({
          slug: p.slug,
          name: p.name,
          mouthValue: p.mouthValue,
        })),
      );

      setQuickReachoutData(prev => ({
        ...prev,
        note: extracted.reachoutNote || original,
        type: extracted.reachoutType || prev.type,
      }));

      const donationKeywords = ['gave', 'gave away', 'gave them', 'gave her', 'gave him', 'for free', 'free', 'donated', 'sample', 'treat', 'gift', 'complimentary', 'bundt cake', 'bundtlet', 'cake'];
      const notesLower = original.toLowerCase();
      const hasDonationKeywords = donationKeywords.some(keyword => notesLower.includes(keyword));

      if (extracted.donation || hasDonationKeywords) {
        setIncludeDonation(true);
        if (extracted.donation) {
          const d = extracted.donation;
          const customItems: Record<string, number> = {};
          for (const product of products.filter(p => p.isActive)) {
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
        } else if (hasDonationKeywords) {
          setDonationData(prev => ({
            ...prev,
            cakesDonatedNotes: prev.cakesDonatedNotes || original,
            orderedFromUs: notesLower.includes('order') || notesLower.includes('ordered') || notesLower.includes('ordering') ? true : prev.orderedFromUs,
            followedUp: notesLower.includes('followed up') || notesLower.includes('follow up') ? true : prev.followedUp,
          }));
        }
      }
    } catch {
      // AI failed (offline / quota / etc.) — leave the original text in place
      // and let the marketer save anyway. preAiTextRef stays cleared since
      // the textarea content is still their own words.
      preAiTextRef.current = null;
    } finally {
      setAiProcessing(false);
    }
  };

  const handleQuickReachoutSubmit = async () => {
    if (!quickReachoutContact || !quickReachoutData.note.trim()) {
      setQuickReachoutError('Please enter a note');
      return;
    }

    setQuickReachoutLoading(true);
    setQuickReachoutError('');

    try {
      const reachout: Reachout = {
        id: `reach-${Date.now()}`,
        date: new Date(),
        note: quickReachoutData.note,
        // Audit trail: if the user tapped "Clean up with AI", store their
        // pre-AI dictation in rawNotes; otherwise it's just a copy of note.
        rawNotes: preAiTextRef.current ?? quickReachoutData.note,
        createdBy: userId || '',
        type: quickReachoutData.type,
        donation: includeDonation ? donationData : undefined,
      };

      const updatedReachouts = [...quickReachoutContact.reachouts, reachout];

      const contactName = `${quickReachoutContact.firstName || ''} ${quickReachoutContact.lastName || ''}`.trim()
        || quickReachoutContact.email
        || 'contact';
      await api.queuePatch(`/contacts/${quickReachoutContact.id}`, {
        reachouts: updatedReachouts,
        lastReachoutDate: new Date(),
      }, { label: `Log visit · ${contactName}` });

      // Trigger donation tracker refresh with celebration if donation was included
      if (includeDonation && donationData) {
        const mouths = calculateMouths(donationData, products);
        setLastDonationMouths(mouths);
        triggerRefresh();
      }
      bumpDataVersion();
      haptics.success();

      closeQuickReachout();
      loadData();
    } catch (err: any) {
      setQuickReachoutError(err.message || 'Failed to add reachout');
      haptics.error();
    } finally {
      setQuickReachoutLoading(false);
    }
  };

  if (loading) {
    return (
      <Box>
        <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
          Contacts
        </Typography>
        <ContactsListSkeleton count={isMobile ? 4 : 6} />
      </Box>
    );
  }

  return (
    <Box>
      <PullToRefreshIndicator
        pullDistance={pullState.pullDistance}
        refreshing={pullState.refreshing}
        willTrigger={pullState.willTrigger}
      />
      {/* Header */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            placeholder="Search contacts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            size="small"
            sx={{ flexGrow: 1, maxWidth: 400 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
          />
          
          {businessFilter && businesses.get(businessFilter) && (
            <Chip
              label={`Viewing: ${businesses.get(businessFilter)}`}
              onDelete={() => navigate('/dashboard')}
              color="primary"
              variant="outlined"
            />
          )}

          <FormControlLabel
            control={
              <Checkbox
                checked={showNoDonationsOnly}
                onChange={(e) => setShowNoDonationsOnly(e.target.checked)}
                size="small"
              />
            }
            label="No donations"
            sx={{ mr: 'auto' }}
          />
          
          {canEdit() && (
            <Button
              variant="contained"
              startIcon={showForm ? <CloseIcon /> : <AddIcon />}
              onClick={() => setShowForm(!showForm)}
            >
              {showForm ? 'Cancel' : 'Add Contact'}
            </Button>
          )}
        </Box>
      </Paper>

      {/* Contact Form */}
      <Collapse in={showForm && canEdit()}>
        <Paper sx={{ p: 3, mb: 3 }}>
          <ContactForm onSuccess={() => { loadData(); setShowForm(false); }} defaultBusinessId={businessFilter || undefined} />
        </Paper>
      </Collapse>

      {/* Edit Modal */}
      <Suspense fallback={null}>
        {editingContact && (
          <EditContactModal
            contact={editingContact}
            onClose={() => setEditingContact(null)}
            onSuccess={() => { loadData(); setEditingContact(null); }}
          />
        )}
      </Suspense>

      {/* Mobile bottom-sheet with call/text/email/log-visit actions */}
      <Suspense fallback={null}>
        <ContactActionsSheet
          open={!!actionSheetContact}
          contact={actionSheetContact}
          businessName={
            actionSheetContact ? businesses.get(actionSheetContact.businessId) : undefined
          }
          onClose={() => setActionSheetContact(null)}
          onLogVisit={(c) => openQuickReachout(c)}
          onAddFollowUp={(c) => handleOpenFollowUpDialog(c)}
          onGenerateEmail={(c) => setEmailDialogContact(c)}
          onEdit={(c) => setEditingContact(c)}
        />
      </Suspense>

      {/* AI email composer triggered from the bottom sheet */}
      <Suspense fallback={null}>
        {emailDialogContact && (
          <GenerateEmailDialog
            open={!!emailDialogContact}
            onClose={() => setEmailDialogContact(null)}
            contactId={emailDialogContact.id}
            contactName={getContactName(emailDialogContact)}
            onReachoutAdded={() => { loadData(); setEmailDialogContact(null); }}
          />
        )}
      </Suspense>

      {/* Quick Reachout Dialog */}
      <Dialog
        open={!!quickReachoutContact}
        onClose={closeQuickReachout}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
        PaperProps={{
          sx: {
            borderRadius: { xs: 0, sm: 3 },
            overscrollBehavior: 'contain',
          },
        }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>Quick Reachout</Typography>
            <Typography variant="body2" color="text.secondary">
              {quickReachoutContact && getContactName(quickReachoutContact)}
            </Typography>
          </Box>
          <IconButton onClick={closeQuickReachout} size="small" aria-label="Close">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pb: 2 }}>
          {quickReachoutError && <Alert severity="error" sx={{ mb: 2 }}>{quickReachoutError}</Alert>}
          {voiceError && isOnline && <Alert severity="warning" sx={{ mb: 2 }}>{voiceError}</Alert>}
          {/* When offline: tell the marketer up-front that AI cleanup &
              dictation are paused but typing + saving still work. */}
          <OnlineOnlyNotice
            feature="Dictation & AI cleanup"
            sx={{ mb: 2 }}
          />

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {/* Reachout type — compact selector */}
            <TextField
              select
              label="Type"
              value={quickReachoutData.type}
              onChange={(e) => setQuickReachoutData(prev => ({ ...prev, type: e.target.value as 'call' | 'email' | 'meeting' | 'text' | 'other' }))}
              size="small"
              fullWidth
              disabled={quickReachoutLoading}
            >
              <MenuItem value="call">📞 Call</MenuItem>
              <MenuItem value="text">💬 Text</MenuItem>
              <MenuItem value="email">📧 Email</MenuItem>
              <MenuItem value="meeting">🤝 Meeting</MenuItem>
              <MenuItem value="other">📝 Other</MenuItem>
            </TextField>

            {/* Single notes field — what you type or dictate is exactly what
                gets saved. The "Clean up with AI" action below rewrites this
                field in place; there is no second field to confuse with. */}
            <TextField
              label="What happened?"
              multiline
              minRows={isMobile ? 6 : 4}
              maxRows={12}
              value={quickReachoutData.note}
              onChange={(e) => {
                const next = e.target.value;
                setQuickReachoutData(prev => ({ ...prev, note: next }));
                // Any manual edit invalidates the AI provenance snapshot —
                // rawNotes should now mirror what the user actually saved.
                preAiTextRef.current = null;
              }}
              placeholder="Type, or tap Record to dictate. e.g. Stopped by, owner was busy. Left a sample tray."
              fullWidth
              disabled={quickReachoutLoading}
              autoFocus={!isMobile}
            />

            {/* Inline action row: dictate + AI cleanup. Both are gated on
                `isOnline` because both require live network calls (Web
                Speech API recognition + OpenAI). When offline, the buttons
                stay visible but disabled with a tooltip explaining why —
                so the marketer immediately understands what changed. */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
              <Tooltip
                title={!isOnline ? 'Dictation needs service' : ''}
                enterTouchDelay={0}
                disableHoverListener={isOnline}
                disableFocusListener={isOnline}
                disableTouchListener={isOnline}
              >
                <span>
                  <Button
                    variant={isListening ? 'contained' : 'outlined'}
                    color={isListening ? 'error' : 'primary'}
                    startIcon={isListening ? <MicOffIcon /> : <MicIcon />}
                    onClick={isListening ? stopListening : startListening}
                    disabled={aiProcessing || quickReachoutLoading || !isOnline}
                    size="small"
                  >
                    {isListening ? 'Stop' : 'Record'}
                  </Button>
                </span>
              </Tooltip>
              {isListening && <Chip label="Listening…" color="error" size="small" />}
              <Box sx={{ flex: 1 }} />
              <Tooltip
                title={!isOnline ? 'AI cleanup needs service' : ''}
                enterTouchDelay={0}
                disableHoverListener={isOnline}
                disableFocusListener={isOnline}
                disableTouchListener={isOnline}
              >
                <span>
                  <Button
                    variant="text"
                    size="small"
                    startIcon={aiProcessing ? <CircularProgress size={14} /> : <AIIcon />}
                    onClick={processWithAI}
                    disabled={aiProcessing || !quickReachoutData.note.trim() || quickReachoutLoading || !isOnline}
                    sx={{ textTransform: 'none' }}
                  >
                    {aiProcessing ? 'Cleaning up…' : 'Clean up with AI'}
                  </Button>
                </span>
              </Tooltip>
            </Box>

            {/* Donation Toggle */}
            <Divider sx={{ my: 1 }} />
            <FormControlLabel
              control={
                <Switch
                  checked={includeDonation}
                  onChange={(e) => setIncludeDonation(e.target.checked)}
                  disabled={quickReachoutLoading}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CakeIcon fontSize="small" />
                  <Typography>Include Donation</Typography>
                </Box>
              }
            />

            {/* Donation Fields */}
            <Collapse in={includeDonation}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1, p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CakeIcon fontSize="small" color="primary" />
                  Product Donations
                  {includeDonation && (
                    <Chip 
                      label={`${calculateMouths(donationData, products)} mouths`} 
                      size="small" 
                      color="primary" 
                      sx={{ ml: 'auto' }}
                    />
                  )}
                </Typography>

                <DonationProductFields
                  products={products}
                  donationData={donationData}
                  onChange={setDonationData}
                />

                <TextField
                  label="Donation Notes"
                  size="small"
                  fullWidth
                  value={donationData.cakesDonatedNotes || ''}
                  onChange={(e) => setDonationData(prev => ({ ...prev, cakesDonatedNotes: e.target.value }))}
                  placeholder="Any notes about the donation..."
                  disabled={quickReachoutLoading}
                />

                <Box sx={{ display: 'flex', gap: 2 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={donationData.orderedFromUs}
                        onChange={(e) => setDonationData(prev => ({ ...prev, orderedFromUs: e.target.checked }))}
                        disabled={quickReachoutLoading}
                      />
                    }
                    label="Ordered from us?"
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={donationData.followedUp}
                        onChange={(e) => setDonationData(prev => ({ ...prev, followedUp: e.target.checked }))}
                        disabled={quickReachoutLoading}
                      />
                    }
                    label="Followed up?"
                  />
                </Box>
              </Box>
            </Collapse>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={closeQuickReachout}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleQuickReachoutSubmit}
            disabled={quickReachoutLoading || !quickReachoutData.note.trim()}
            startIcon={quickReachoutLoading ? <CircularProgress size={20} color="inherit" /> : <AddIcon />}
          >
            {quickReachoutLoading ? 'Saving...' : 'Add Reachout'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Content */}
      <Grid container spacing={3}>
        {/* Contacts List */}
        <Grid size={{ xs: 12 }}>
          <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
            Contacts ({filteredContacts.length})
          </Typography>
          
          {filteredContacts.length === 0 ? (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">
                {searchTerm ? 'No contacts match your search' : 'No contacts yet. Add your first contact!'}
              </Typography>
            </Paper>
          ) : (
            <Grid container spacing={2}>
              {filteredContacts.map((contact) => (
                <Grid size={{ xs: 12, sm: 6, xl: 4 }} key={contact.id}>
                  <Card 
                    sx={{ 
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      '&:hover': { transform: 'translateY(-2px)', boxShadow: 4 },
                    }}
                    onClick={() => handleContactClick(contact)}
                  >
                    <CardContent>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>
                          {getContactName(contact)}
                        </Typography>
                        <Chip 
                          label={contact.status || 'new'} 
                          size="small" 
                          color={getStatusColor(contact.status || 'new') as any}
                        />
                      </Box>
                      
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <BusinessIcon fontSize="small" color="action" />
                          <Typography variant="body2" color="text.secondary">
                            {businesses.get(contact.businessId) || contact.businessId}
                          </Typography>
                        </Box>
                        
                        {contact.email && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <EmailIcon fontSize="small" color="action" />
                            <Typography variant="body2" color="text.secondary">{contact.email}</Typography>
                          </Box>
                        )}
                        
                        {contact.phone && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <PhoneIcon fontSize="small" color="action" />
                            <Typography variant="body2" color="text.secondary">{contact.phone}</Typography>
                          </Box>
                        )}
                      </Box>

                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <Chip 
                          label={`${contact.reachouts.length} reachouts`} 
                          size="small" 
                          variant="outlined"
                        />
                        {contact.suggestedFollowUpDate && (
                          <Chip 
                            icon={<CalendarIcon />}
                            label={contact.suggestedFollowUpDate.toLocaleDateString()} 
                            size="small" 
                            color="warning"
                            variant="outlined"
                          />
                        )}
                      </Box>

                      {contact.personalDetails && (
                        <Alert severity="info" sx={{ mt: 2, py: 0 }} icon={<PersonIcon fontSize="small" />}>
                          <Typography variant="body2">{contact.personalDetails}</Typography>
                        </Alert>
                      )}
                    </CardContent>
                    
                    <CardActions sx={{ justifyContent: 'space-between', pt: 0, px: 2, pb: 1.5 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        color="primary"
                        startIcon={<AddCommentIcon />}
                        onClick={(e) => {
                          e.stopPropagation();
                          openQuickReachout(contact);
                        }}
                      >
                        Quick Reachout
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="secondary"
                        startIcon={followUpLoading && followUpDialogContact?.id === contact.id ? <CircularProgress size={16} /> : <CalendarIcon />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenFollowUpDialog(contact);
                        }}
                        disabled={followUpLoading}
                      >
                        Follow-up
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </Grid>

        {/* Follow-up Suggestions Dialog */}
        <Dialog open={followUpDialogOpen} onClose={handleCloseFollowUpDialog} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography variant="h6">Follow-up Suggestions</Typography>
              {followUpDialogContact && (
                <Typography variant="body2" color="text.secondary">
                  {getContactName(followUpDialogContact)}
                </Typography>
              )}
            </Box>
            <IconButton onClick={handleCloseFollowUpDialog} size="small">
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          <DialogContent>
            {followUpDialogContact && (
              <Box sx={{ mb: 2, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {businesses.get(followUpDialogContact.businessId) || followUpDialogContact.businessId}
                </Typography>
                {followUpDialogContact.email && (
                  <Typography variant="body2" color="text.secondary">
                    {followUpDialogContact.email}
                  </Typography>
                )}
              </Box>
            )}

            {followUpLoading ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 4 }}>
                <CircularProgress sx={{ mb: 2 }} />
                <Typography color="text.secondary">
                  Generating follow-up suggestions...
                </Typography>
              </Box>
            ) : followUpSuggestions.length === 0 ? (
              <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                No follow-up suggestions at this time.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {followUpSuggestions.map((suggestion, index) => {
                  const sugDate = suggestion.suggestedDate instanceof Date
                    ? suggestion.suggestedDate
                    : new Date(suggestion.suggestedDate);
                  return (
                    <Card key={index} variant="outlined">
                      <CardContent sx={{ pb: 1 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <Chip label={suggestion.type} size="small" />
                            <Chip
                              label={suggestion.priority}
                              size="small"
                              color={suggestion.priority === 'high' ? 'error' : suggestion.priority === 'medium' ? 'warning' : 'default'}
                            />
                          </Box>
                          <IconButton size="small" onClick={() => handleCopySuggestion(suggestion)} title="Copy message">
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          📅 {sugDate.toLocaleDateString()}
                        </Typography>
                        <Typography variant="body2" sx={{ mb: 1.5 }}>
                          {suggestion.message}
                        </Typography>
                        {addedToCalendar ? (
                          <Alert severity="success" sx={{ py: 0.5 }} icon={<CheckIcon fontSize="small" />}>
                            Added to calendar for {sugDate.toLocaleDateString()}
                          </Alert>
                        ) : (
                          <Button
                            variant="contained"
                            size="small"
                            fullWidth
                            startIcon={addingToCalendar ? <CircularProgress size={16} color="inherit" /> : <EventAvailableIcon />}
                            onClick={() => handleAddSuggestionToCalendar(suggestion)}
                            disabled={addingToCalendar}
                          >
                            {addingToCalendar ? 'Adding...' : 'Add to Calendar'}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button 
              onClick={handleRegenerateFollowUp} 
              disabled={followUpLoading || !followUpDialogContact}
              startIcon={followUpLoading ? <CircularProgress size={16} /> : <RefreshIcon />}
            >
              Regenerate Followup
            </Button>
            <Button onClick={handleCloseFollowUpDialog}>Close</Button>
          </DialogActions>
        </Dialog>

        {/* Copy Toast Notification */}
        <Snackbar
          open={copyToastOpen}
          autoHideDuration={3000}
          onClose={() => setCopyToastOpen(false)}
          message="Reachout copied to clipboard"
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        />
      </Grid>
    </Box>
  );
}
