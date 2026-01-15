import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionContext';
import { useDonation } from '../contexts/DonationContext';
import { ContactForm } from '../components/ContactForm';
import { EditContactModal } from '../components/EditContactModal';
import { generateFollowUpSuggestions } from '../utils/followUpSuggestions';
import { extractContactInfo } from '../utils/openai';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { Contact, FollowUpSuggestion, Reachout, DonationData, MOUTH_VALUES } from '../types';
import { calculateMouths, createEmptyDonation } from '../utils/donationCalculations';
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
} from '@mui/material';
import {
  Search as SearchIcon,
  Add as AddIcon,
  Close as CloseIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  LocationOn as LocationIcon,
  Business as BusinessIcon,
  CalendarMonth as CalendarIcon,
  Edit as EditIcon,
  Person as PersonIcon,
  AddComment as AddCommentIcon,
  Mic as MicIcon,
  MicOff as MicOffIcon,
  AutoAwesome as AIIcon,
  Cake as CakeIcon,
} from '@mui/icons-material';

export function Dashboard() {
  const { currentUser } = useAuth();
  const { permissions, canEdit } = usePermissions();
  const { triggerRefresh, setLastDonationMouths } = useDonation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const businessFilter = searchParams.get('business');
  
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [businesses, setBusinesses] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [followUpSuggestions, setFollowUpSuggestions] = useState<FollowUpSuggestion[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Quick reachout dialog
  const [quickReachoutContact, setQuickReachoutContact] = useState<Contact | null>(null);
  const [quickReachoutData, setQuickReachoutData] = useState({ note: '', type: 'call' as 'call' | 'email' | 'meeting' | 'other', rawNotes: '' });
  const [quickReachoutLoading, setQuickReachoutLoading] = useState(false);
  const [quickReachoutError, setQuickReachoutError] = useState('');
  const [aiProcessing, setAiProcessing] = useState(false);
  
  // Donation fields for quick reachout
  const [includeDonation, setIncludeDonation] = useState(false);
  const [donationData, setDonationData] = useState<DonationData>(createEmptyDonation());
  
  const { transcript, interimTranscript, isListening, startListening, stopListening, clearTranscript, error: voiceError } = useVoiceInput();

  useEffect(() => {
    if (!permissions.currentLocationId && !permissions.isGlobalAdmin) {
      navigate('/select-location');
      return;
    }
    loadData();
  }, [permissions.currentLocationId, permissions.isGlobalAdmin, navigate]);

  useEffect(() => {
    let filtered = contacts;
    
    if (businessFilter) {
      filtered = filtered.filter(c => c.businessId === businessFilter);
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
          (c.city?.toLowerCase() || '').includes(term) ||
          (c.personalDetails?.toLowerCase() || '').includes(term)
        );
      });
    }
    
    setFilteredContacts(filtered);
  }, [businessFilter, contacts, searchTerm, businesses]);

  // Update raw notes when transcript changes (only use final transcript)
  useEffect(() => {
    if (transcript && quickReachoutContact) {
      // Combine final transcript with any interim text for display
      const fullText = interimTranscript ? `${transcript} ${interimTranscript}` : transcript;
      setQuickReachoutData(prev => ({
        ...prev,
        rawNotes: fullText
      }));
    }
  }, [transcript, interimTranscript, quickReachoutContact]);

  const loadData = async () => {
    try {
      const businessSnapshot = await getDocs(collection(db, 'businesses'));
      const businessMap = new Map<string, string>();
      businessSnapshot.forEach((doc) => {
        businessMap.set(doc.id, doc.data().name);
      });
      setBusinesses(businessMap);

      const querySnapshot = await getDocs(collection(db, 'contacts'));
      const contactsData: Contact[] = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const reachouts = (data.reachouts || []).map((r: any) => ({
          ...r,
          date: r.date?.toDate() || new Date()
        }));
        
        contactsData.push({
          id: doc.id,
          ...data,
          reachouts,
          createdAt: data.createdAt?.toDate() || new Date(),
          lastReachoutDate: data.lastReachoutDate?.toDate(),
          suggestedFollowUpDate: data.suggestedFollowUpDate?.toDate(),
        } as Contact);
      });
      
      contactsData.sort((a, b) => {
        const aDate = a.lastReachoutDate || a.createdAt;
        const bDate = b.lastReachoutDate || b.createdAt;
        return bDate.getTime() - aDate.getTime();
      });
      setContacts(contactsData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleContactClick = (contact: Contact) => {
    setSelectedContact(contact);
    const suggestions = generateFollowUpSuggestions(contact);
    setFollowUpSuggestions(suggestions);
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
    setQuickReachoutData({ note: '', type: 'call', rawNotes: '' });
    setQuickReachoutError('');
    setIncludeDonation(false);
    setDonationData(createEmptyDonation());
    clearTranscript();
  };

  const closeQuickReachout = () => {
    setQuickReachoutContact(null);
    setQuickReachoutData({ note: '', type: 'call', rawNotes: '' });
    setQuickReachoutError('');
    setIncludeDonation(false);
    setDonationData(createEmptyDonation());
    if (isListening) stopListening();
    clearTranscript();
  };

  const processWithAI = async () => {
    if (!quickReachoutData.rawNotes.trim()) {
      setQuickReachoutError('Please enter notes to process');
      return;
    }

    setAiProcessing(true);
    setQuickReachoutError('');

    try {
      const extracted = await extractContactInfo(quickReachoutData.rawNotes);
      setQuickReachoutData(prev => ({
        ...prev,
        note: extracted.reachoutNote || quickReachoutData.rawNotes
      }));
    } catch (err) {
      setQuickReachoutData(prev => ({ ...prev, note: quickReachoutData.rawNotes }));
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
        rawNotes: quickReachoutData.rawNotes || null,
        createdBy: currentUser?.uid || '',
        type: quickReachoutData.type,
        locationId: permissions.currentLocationId || undefined,
        donation: includeDonation ? donationData : undefined,
      };

      const updatedReachouts = [...quickReachoutContact.reachouts, reachout];

      await updateDoc(doc(db, 'contacts', quickReachoutContact.id), {
        reachouts: updatedReachouts,
        lastReachoutDate: new Date()
      });

      // Trigger donation tracker refresh with celebration if donation was included
      if (includeDonation && donationData) {
        const mouths = calculateMouths(donationData);
        setLastDonationMouths(mouths);
        triggerRefresh();
      }

      closeQuickReachout();
      loadData();
    } catch (err: any) {
      setQuickReachoutError(err.message || 'Failed to add reachout');
    } finally {
      setQuickReachoutLoading(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
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
          <ContactForm onSuccess={() => { loadData(); setShowForm(false); }} />
        </Paper>
      </Collapse>

      {/* Edit Modal */}
      {editingContact && (
        <EditContactModal
          contact={editingContact}
          onClose={() => setEditingContact(null)}
          onSuccess={() => { loadData(); setEditingContact(null); }}
        />
      )}

      {/* Quick Reachout Dialog */}
      <Dialog open={!!quickReachoutContact} onClose={closeQuickReachout} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h6">Quick Reachout</Typography>
            <Typography variant="body2" color="text.secondary">
              {quickReachoutContact && getContactName(quickReachoutContact)}
            </Typography>
          </Box>
          <IconButton onClick={closeQuickReachout} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {quickReachoutError && <Alert severity="error" sx={{ mb: 2 }}>{quickReachoutError}</Alert>}
          {voiceError && <Alert severity="warning" sx={{ mb: 2 }}>{voiceError}</Alert>}
          
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {/* Voice + Type Row */}
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <Button
                variant={isListening ? 'contained' : 'outlined'}
                color={isListening ? 'error' : 'primary'}
                startIcon={isListening ? <MicOffIcon /> : <MicIcon />}
                onClick={isListening ? stopListening : startListening}
                disabled={aiProcessing || quickReachoutLoading}
              >
                {isListening ? 'Stop' : 'Record'}
              </Button>
              {isListening && <Chip label="🔴 Listening..." color="error" size="small" />}
              <TextField
                select
                label="Type"
                value={quickReachoutData.type}
                onChange={(e) => setQuickReachoutData(prev => ({ ...prev, type: e.target.value as any }))}
                size="small"
                sx={{ width: 140 }}
                disabled={quickReachoutLoading}
              >
                <MenuItem value="call">📞 Call</MenuItem>
                <MenuItem value="email">📧 Email</MenuItem>
                <MenuItem value="meeting">🤝 Meeting</MenuItem>
                <MenuItem value="other">📝 Other</MenuItem>
              </TextField>
            </Box>

            {/* Raw Notes */}
            <TextField
              label="Meeting Notes"
              multiline
              rows={3}
              value={quickReachoutData.rawNotes}
              onChange={(e) => setQuickReachoutData(prev => ({ ...prev, rawNotes: e.target.value }))}
              placeholder="Type or speak your notes..."
              fullWidth
              disabled={aiProcessing || quickReachoutLoading}
            />
            
            <Button
              variant="outlined"
              size="small"
              startIcon={aiProcessing ? <CircularProgress size={16} /> : <AIIcon />}
              onClick={processWithAI}
              disabled={aiProcessing || !quickReachoutData.rawNotes.trim() || quickReachoutLoading}
            >
              {aiProcessing ? 'Processing...' : 'Process with AI'}
            </Button>

            {/* Summary Note */}
            <TextField
              label="Summary Note"
              multiline
              rows={2}
              value={quickReachoutData.note}
              onChange={(e) => setQuickReachoutData(prev => ({ ...prev, note: e.target.value }))}
              placeholder="AI will summarize, or type manually"
              fullWidth
              disabled={quickReachoutLoading}
            />

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
                      label={`${calculateMouths(donationData)} mouths`} 
                      size="small" 
                      color="primary" 
                      sx={{ ml: 'auto' }}
                    />
                  )}
                </Typography>

                <Grid container spacing={2}>
                  <Grid size={{ xs: 6, sm: 4 }}>
                    <TextField
                      label="FREE Bundtlet Card"
                      type="number"
                      size="small"
                      fullWidth
                      value={donationData.freeBundletCard || ''}
                      onChange={(e) => setDonationData(prev => ({ ...prev, freeBundletCard: parseInt(e.target.value) || 0 }))}
                      helperText={`${MOUTH_VALUES.freeBundletCard} mouth each`}
                      disabled={quickReachoutLoading}
                      slotProps={{ htmlInput: { min: 0 } }}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 4 }}>
                    <TextField
                      label="Dozen Bundtinis"
                      type="number"
                      size="small"
                      fullWidth
                      value={donationData.dozenBundtinis || ''}
                      onChange={(e) => setDonationData(prev => ({ ...prev, dozenBundtinis: parseInt(e.target.value) || 0 }))}
                      helperText={`${MOUTH_VALUES.dozenBundtinis} mouths each`}
                      disabled={quickReachoutLoading}
                      slotProps={{ htmlInput: { min: 0 } }}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 4 }}>
                    <TextField
                      label="8&quot; Cake"
                      type="number"
                      size="small"
                      fullWidth
                      value={donationData.cake8inch || ''}
                      onChange={(e) => setDonationData(prev => ({ ...prev, cake8inch: parseInt(e.target.value) || 0 }))}
                      helperText={`${MOUTH_VALUES.cake8inch} mouths each`}
                      disabled={quickReachoutLoading}
                      slotProps={{ htmlInput: { min: 0 } }}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 4 }}>
                    <TextField
                      label="10&quot; Cake"
                      type="number"
                      size="small"
                      fullWidth
                      value={donationData.cake10inch || ''}
                      onChange={(e) => setDonationData(prev => ({ ...prev, cake10inch: parseInt(e.target.value) || 0 }))}
                      helperText={`${MOUTH_VALUES.cake10inch} mouths each`}
                      disabled={quickReachoutLoading}
                      slotProps={{ htmlInput: { min: 0 } }}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 4 }}>
                    <TextField
                      label="Sample Tray"
                      type="number"
                      size="small"
                      fullWidth
                      value={donationData.sampleTray || ''}
                      onChange={(e) => setDonationData(prev => ({ ...prev, sampleTray: parseInt(e.target.value) || 0 }))}
                      helperText={`${MOUTH_VALUES.sampleTray} mouths each`}
                      disabled={quickReachoutLoading}
                      slotProps={{ htmlInput: { min: 0 } }}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 4 }}>
                    <TextField
                      label="Bundtlet/Tower"
                      type="number"
                      size="small"
                      fullWidth
                      value={donationData.bundtletTower || ''}
                      onChange={(e) => setDonationData(prev => ({ ...prev, bundtletTower: parseInt(e.target.value) || 0 }))}
                      helperText={`${MOUTH_VALUES.bundtletTower} mouth each`}
                      disabled={quickReachoutLoading}
                      slotProps={{ htmlInput: { min: 0 } }}
                    />
                  </Grid>
                </Grid>

                <TextField
                  label="Cakes Donated Notes"
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
        <Grid size={{ xs: 12, lg: selectedContact ? 8 : 12 }}>
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
                      border: selectedContact?.id === contact.id ? 2 : 0,
                      borderColor: 'primary.main',
                      transition: 'all 0.2s',
                      '&:hover': { transform: 'translateY(-2px)' },
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
                        
                        {(contact.city || contact.state) && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <LocationIcon fontSize="small" color="action" />
                            <Typography variant="body2" color="text.secondary">
                              {[contact.city, contact.state].filter(Boolean).join(', ')}
                            </Typography>
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
                        startIcon={<EditIcon />}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingContact(contact);
                        }}
                      >
                        Edit
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </Grid>

        {/* Follow-up Suggestions Sidebar */}
        {selectedContact && (
          <Grid size={{ xs: 12, lg: 4 }}>
            <Paper sx={{ p: 3, position: 'sticky', top: 80 }}>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                Follow-up Suggestions
              </Typography>
              
              <Box sx={{ mb: 2, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {getContactName(selectedContact)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {businesses.get(selectedContact.businessId)}
                </Typography>
              </Box>

              {followUpSuggestions.length === 0 ? (
                <Typography color="text.secondary">
                  No follow-up suggestions at this time.
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {followUpSuggestions.map((suggestion, index) => (
                    <Card key={index} variant="outlined">
                      <CardContent sx={{ pb: '12px !important' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                          <Chip label={suggestion.type} size="small" />
                          <Chip 
                            label={suggestion.priority} 
                            size="small" 
                            color={suggestion.priority === 'high' ? 'error' : suggestion.priority === 'medium' ? 'warning' : 'default'}
                          />
                        </Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          📅 {suggestion.suggestedDate.toLocaleDateString()}
                        </Typography>
                        <Typography variant="body2">
                          {suggestion.message}
                        </Typography>
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              )}
            </Paper>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
