import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, setDoc, doc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionContext';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { extractContactInfo, generateFollowUpSuggestion } from '../utils/openai';
import { Contact, Reachout, DonationData, MOUTH_VALUES, Business, CalendarEvent } from '../types';
import { createEmptyDonation, calculateMouths } from '../utils/donationCalculations';
import { Box, Switch, FormControlLabel, Typography, Divider, Collapse, TextField, Grid, Checkbox, Chip } from '@mui/material';
import { AddressPicker, AddressData } from './AddressPicker';
import { Cake as CakeIcon } from '@mui/icons-material';

interface ContactFormProps {
  onSuccess?: () => void;
}

export function ContactForm({ onSuccess }: ContactFormProps) {
  const { currentUser } = useAuth();
  const { permissions } = usePermissions();
  const { transcript, interimTranscript, isListening, startListening, stopListening, clearTranscript, error: voiceError } = useVoiceInput();
  
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState('');
  const [newBusinessName, setNewBusinessName] = useState('');
  const [showNewBusiness, setShowNewBusiness] = useState(false);
  const [newBusinessAddress, setNewBusinessAddress] = useState<AddressData>({
    address: '',
    city: '',
    state: '',
    zipCode: '',
  });
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    personalDetails: '',
    reachoutNote: '',
    reachoutType: 'call' as 'call' | 'email' | 'meeting' | 'other',
    suggestedFollowUpDays: 3
  });

  const [rawNotes, setRawNotes] = useState(''); // Editable raw meeting notes
  const [includeDonation, setIncludeDonation] = useState(false);
  const [donationData, setDonationData] = useState<DonationData>(createEmptyDonation());
  
  const [loading, setLoading] = useState(false);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Load businesses on mount and when store changes
  useEffect(() => {
    loadBusinesses();
  }, [permissions.currentStoreId]);

  const loadBusinesses = async () => {
    try {
      if (!permissions.currentStoreId) {
        setBusinesses([]);
        return;
      }

      // Get businesses for the current store
      const { query, where } = await import('firebase/firestore');
      const businessesQuery = query(
        collection(db, 'businesses'),
        where('storeId', '==', permissions.currentStoreId)
      );
      const querySnapshot = await getDocs(businessesQuery);
      const businessList: Business[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        businessList.push({ 
          id: doc.id, 
          name: data.name,
          storeId: data.storeId || permissions.currentStoreId || '',
          createdAt: data.createdAt?.toDate() || new Date(),
          createdBy: data.createdBy || '',
        });
      });
      // Sort businesses alphabetically
      businessList.sort((a, b) => a.name.localeCompare(b.name));
      setBusinesses(businessList);
    } catch (error) {
      console.error('Error loading businesses:', error);
    }
  };

  // Update raw notes with transcript (combine final + interim for display)
  useEffect(() => {
    if (transcript || interimTranscript) {
      const fullText = interimTranscript ? `${transcript} ${interimTranscript}`.trim() : transcript;
      setRawNotes(fullText);
    }
  }, [transcript, interimTranscript]);

  const processNotesWithAI = async () => {
    if (!rawNotes.trim()) {
      setError('Please enter meeting notes to process');
      return;
    }

    setAiProcessing(true);
    setError('');
    
    try {
      const extracted = await extractContactInfo(rawNotes);
      
      // Update form fields (does NOT create a contact - just fills the form)
      setFormData(prev => ({
        ...prev,
        firstName: extracted.firstName || prev.firstName,
        lastName: extracted.lastName || prev.lastName,
        email: extracted.email || prev.email,
        phone: extracted.phone || prev.phone,
        personalDetails: extracted.personalDetails || prev.personalDetails,
        reachoutNote: extracted.reachoutNote || prev.reachoutNote,
        suggestedFollowUpDays: extracted.suggestedFollowUpDays || prev.suggestedFollowUpDays
      }));

      // Auto-fill donation data if detected
      if (extracted.donation) {
        setIncludeDonation(true);
        setDonationData(prev => ({
          freeBundletCard: extracted.donation?.freeBundletCard || prev.freeBundletCard || 0,
          dozenBundtinis: extracted.donation?.dozenBundtinis || prev.dozenBundtinis || 0,
          cake8inch: extracted.donation?.cake8inch || prev.cake8inch || 0,
          cake10inch: extracted.donation?.cake10inch || prev.cake10inch || 0,
          sampleTray: extracted.donation?.sampleTray || prev.sampleTray || 0,
          bundtletTower: extracted.donation?.bundtletTower || prev.bundtletTower || 0,
          cakesDonatedNotes: extracted.donation?.cakesDonatedNotes || prev.cakesDonatedNotes || '',
          orderedFromUs: extracted.donation?.orderedFromUs !== undefined ? extracted.donation.orderedFromUs : prev.orderedFromUs || false,
          followedUp: extracted.donation?.followedUp !== undefined ? extracted.donation.followedUp : prev.followedUp || false,
        }));
      }
      
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      console.error('AI extraction error:', err);
      setError('AI processing failed. You can still fill the form manually.');
    } finally {
      setAiProcessing(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const generateContactId = () => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `CONT-${timestamp}-${random}`;
  };

  const handleCreateBusiness = async () => {
    if (!newBusinessName.trim()) {
      setError('Business name is required');
      return;
    }

    if (!permissions.currentStoreId) {
      setError('Please select a store first');
      return;
    }

    try {
      const businessId = newBusinessName.trim().toUpperCase().replace(/\s+/g, '-');
      await setDoc(doc(db, 'businesses', businessId), {
        id: businessId,
        name: newBusinessName.trim(),
        storeId: permissions.currentStoreId,
        address: newBusinessAddress.address || null,
        city: newBusinessAddress.city || null,
        state: newBusinessAddress.state || null,
        zipCode: newBusinessAddress.zipCode || null,
        createdAt: new Date(),
        createdBy: currentUser?.uid
      });
      
      await loadBusinesses();
      setSelectedBusinessId(businessId);
      setNewBusinessName('');
      setNewBusinessAddress({ address: '', city: '', state: '', zipCode: '' });
      setShowNewBusiness(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create business');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (!currentUser) {
      setError('You must be logged in to create a contact');
      return;
    }

    if (!selectedBusinessId) {
      setError('Please select or create a business');
      return;
    }

    if (!permissions.currentStoreId) {
      setError('Please select a store first');
      return;
    }

    setLoading(true);

    try {
      const now = new Date();
      
      // Create initial reachout if note provided
      const initialReachout: Reachout = {
        id: `reach-${Date.now()}`,
        date: now,
        note: formData.reachoutNote || 'Initial contact created',
        rawNotes: rawNotes || null,
        createdBy: currentUser.uid,
        type: formData.reachoutType,
        storeId: permissions.currentStoreId,
        donation: includeDonation ? donationData : undefined,
      };

      // Generate AI follow-up suggestion
      let suggestedFollowUpDate: Date | null = null;
      let suggestedFollowUpMethod: 'email' | 'call' | 'meeting' | 'text' | 'other' | null = null;
      let suggestedFollowUpNote: string | null = null;
      let suggestedFollowUpPriority: 'low' | 'medium' | 'high' | null = null;

      try {
        const aiSuggestion = await generateFollowUpSuggestion({
          firstName: formData.firstName || undefined,
          lastName: formData.lastName || undefined,
          reachouts: [{
            date: initialReachout.date,
            note: initialReachout.note || '',
            type: initialReachout.type || 'other',
            donation: initialReachout.donation
          }],
          personalDetails: formData.personalDetails || undefined,
          status: 'new',
          email: formData.email || undefined,
          phone: formData.phone || undefined,
        });

        suggestedFollowUpDate = new Date(aiSuggestion.suggestedDate);
        suggestedFollowUpMethod = aiSuggestion.suggestedMethod || null;
        suggestedFollowUpNote = aiSuggestion.message || null;
        suggestedFollowUpPriority = aiSuggestion.priority || null;
      } catch (aiError) {
        console.error('AI follow-up generation failed, using fallback:', aiError);
        // Fallback to simple calculation
        suggestedFollowUpDate = new Date(now);
        suggestedFollowUpDate.setDate(suggestedFollowUpDate.getDate() + formData.suggestedFollowUpDays);
        suggestedFollowUpMethod = formData.email ? 'email' : formData.phone ? 'call' : 'email';
        suggestedFollowUpNote = null;
        suggestedFollowUpPriority = 'medium';
      }

      const contactData: Omit<Contact, 'id'> = {
        businessId: selectedBusinessId,
        storeId: permissions.currentStoreId,
        contactId: generateContactId(),
        firstName: formData.firstName || null,
        lastName: formData.lastName || null,
        email: formData.email || null,
        phone: formData.phone || null,
        personalDetails: formData.personalDetails || null,
        suggestedFollowUpDate: suggestedFollowUpDate || null,
        suggestedFollowUpMethod: suggestedFollowUpMethod || null,
        suggestedFollowUpNote: suggestedFollowUpNote || null,
        suggestedFollowUpPriority: suggestedFollowUpPriority || null,
        reachouts: [initialReachout],
        createdAt: now,
        createdBy: currentUser.uid,
        lastReachoutDate: now,
        status: 'new'
      };

      const contactRef = await addDoc(collection(db, 'contacts'), contactData);
      const contactId = contactRef.id;

      // Create calendar event for the initial reachout
      if (formData.reachoutNote || rawNotes) {
        try {
          // Normalize date to midnight local time for today's reachout
          const normalizedNow = new Date(now);
          normalizedNow.setHours(0, 0, 0, 0);
          
          await addDoc(collection(db, 'calendarEvents'), {
            storeId: permissions.currentStoreId,
            title: `Reachout: ${formData.firstName || formData.lastName || 'New Contact'}`,
            description: formData.reachoutNote || rawNotes || null,
            date: normalizedNow,
            type: 'reachout',
            contactId: contactId,
            businessId: selectedBusinessId,
            priority: 'medium',
            status: 'completed', // Past reachout is completed
            createdBy: currentUser.uid,
            createdAt: now,
            completedAt: now,
          } as Omit<CalendarEvent, 'id'>);
        } catch (eventError) {
          console.error('Failed to create calendar event:', eventError);
          // Don't fail contact creation if event creation fails
        }
      }

      // Create calendar event for AI-suggested follow-up
      if (suggestedFollowUpDate) {
        try {
          const contactName = `${formData.firstName || ''} ${formData.lastName || ''}`.trim() || formData.email || 'Contact';
          // Normalize date to midnight local time to avoid timezone issues
          const normalizedDate = new Date(suggestedFollowUpDate);
          normalizedDate.setHours(0, 0, 0, 0);
          
          await addDoc(collection(db, 'calendarEvents'), {
            storeId: permissions.currentStoreId,
            title: `Follow-up: ${contactName}`,
            description: suggestedFollowUpNote || `Follow up with ${contactName}`,
            date: normalizedDate,
            type: 'followup',
            contactId: contactId,
            businessId: selectedBusinessId,
            priority: suggestedFollowUpPriority || 'medium',
            status: 'scheduled',
            createdBy: currentUser.uid,
            createdAt: now,
          } as Omit<CalendarEvent, 'id'>);
        } catch (eventError) {
          console.error('Failed to create follow-up calendar event:', eventError);
          // Don't fail contact creation if event creation fails
        }
      }
      
      setSuccess(true);
      setFormData({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        personalDetails: '',
        reachoutNote: '',
        reachoutType: 'call',
        suggestedFollowUpDays: 3
      });
      setRawNotes('');
      setIncludeDonation(false);
      setDonationData(createEmptyDonation());
      clearTranscript();
      
      if (onSuccess) {
        onSuccess();
      }
      
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to create contact');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="contact-form-container">
      <h2>Add New Contact</h2>
      
      {/* Voice Input Section */}
      <div className="voice-input-section">
        <div className="voice-controls">
          <button
            type="button"
            onClick={isListening ? stopListening : startListening}
            className={`btn-voice ${isListening ? 'listening' : ''}`}
          >
            {isListening ? '🛑 Stop Recording' : '🎤 Start Voice Input'}
          </button>
          {transcript && (
            <button
              type="button"
              onClick={clearTranscript}
              className="btn-clear"
            >
              Clear
            </button>
          )}
        </div>
        {isListening && (
          <div className="listening-indicator">
            <span className="pulse"></span> Listening...
          </div>
        )}
        {transcript && (
          <div className="transcript-preview">
            <strong>Transcript:</strong> {transcript}
          </div>
        )}
        {voiceError && (
          <div className="error-message">{voiceError}</div>
        )}
      </div>

      {/* Raw Meeting Notes Section */}
      <div className="raw-notes-section">
        <h3>Raw Meeting Notes</h3>
        <p className="field-description">
          Edit your notes below, then click "Process" to extract contact information.
        </p>
        <textarea
          value={rawNotes}
          onChange={(e) => setRawNotes(e.target.value)}
          placeholder="Type or speak your meeting notes here. The AI will extract contact information, personal details, and create a summary."
          rows={8}
          className="raw-notes-textarea"
          disabled={aiProcessing}
        />
        <button
          type="button"
          onClick={processNotesWithAI}
          disabled={aiProcessing || !rawNotes.trim()}
          className="btn-primary btn-ai-process"
        >
          {aiProcessing ? '🤖 Processing...' : 'Process'}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="contact-form">
        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">Contact created successfully!</div>}

        {/* Business Selection */}
        <div className="form-group">
          <label htmlFor="business">Business *</label>
          {!showNewBusiness ? (
            <div className="business-select-container">
              <select
                id="business"
                value={selectedBusinessId}
                onChange={(e) => setSelectedBusinessId(e.target.value)}
                required
                className="business-select"
              >
                <option value="">Select a business...</option>
                {businesses.map((business) => (
                  <option key={business.id} value={business.id}>
                    {business.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowNewBusiness(true)}
                className="btn-secondary"
              >
                + New Business
              </button>
            </div>
          ) : (
            <div className="new-business-container">
              <input
                type="text"
                value={newBusinessName}
                onChange={(e) => setNewBusinessName(e.target.value)}
                placeholder="Enter business name"
                className="new-business-input"
                style={{ marginBottom: '8px', width: '100%' }}
              />
              <Box sx={{ mb: 2 }}>
                <AddressPicker
                  value={newBusinessAddress}
                  onChange={setNewBusinessAddress}
                  label="Business Address"
                  fullWidth
                />
              </Box>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={handleCreateBusiness}
                  className="btn-primary"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewBusiness(false);
                    setNewBusinessName('');
                    setNewBusinessAddress({ address: '', city: '', state: '', zipCode: '' });
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="firstName">First Name</label>
            <input
              id="firstName"
              name="firstName"
              type="text"
              value={formData.firstName}
              onChange={handleChange}
            />
          </div>
          <div className="form-group">
            <label htmlFor="lastName">Last Name</label>
            <input
              id="lastName"
              name="lastName"
              type="text"
              value={formData.lastName}
              onChange={handleChange}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
            />
          </div>
          <div className="form-group">
            <label htmlFor="phone">Phone</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              value={formData.phone}
              onChange={handleChange}
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="reachoutType">Reachout Type</label>
          <select
            id="reachoutType"
            name="reachoutType"
            value={formData.reachoutType}
            onChange={(e) => setFormData(prev => ({ ...prev, reachoutType: e.target.value as any }))}
            className="business-select"
          >
            <option value="call">Phone Call</option>
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="personalDetails">Personal Details (AI-extracted)</label>
          <input
            id="personalDetails"
            name="personalDetails"
            type="text"
            value={formData.personalDetails}
            onChange={handleChange}
            placeholder="e.g., Has a sister, likes blue, plays golf..."
          />
          <small>Fun facts to build rapport and familiarity</small>
        </div>

        <div className="form-group">
          <label htmlFor="reachoutNote">Initial Reachout Note</label>
          <textarea
            id="reachoutNote"
            name="reachoutNote"
            value={formData.reachoutNote}
            onChange={handleChange}
            rows={4}
            placeholder="What was discussed in this contact?"
          />
        </div>

        <div className="form-group">
          <label htmlFor="suggestedFollowUpDays">Follow Up In (Days)</label>
          <input
            id="suggestedFollowUpDays"
            name="suggestedFollowUpDays"
            type="number"
            min="1"
            max="30"
            value={formData.suggestedFollowUpDays}
            onChange={(e) => setFormData(prev => ({ ...prev, suggestedFollowUpDays: parseInt(e.target.value) || 3 }))}
          />
          <small>AI suggests: {formData.suggestedFollowUpDays} days</small>
        </div>

        <Box sx={{ my: 2 }}>
          <Divider sx={{ my: 1 }} />
          <FormControlLabel
            control={
              <Switch
                checked={includeDonation}
                onChange={(e) => {
                  setIncludeDonation(e.target.checked);
                  if (!e.target.checked) {
                    setDonationData(createEmptyDonation());
                  }
                }}
                disabled={loading || aiProcessing}
              />
            }
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CakeIcon fontSize="small" />
                <Typography>Include Donation</Typography>
              </Box>
            }
          />
        </Box>

        <Collapse in={includeDonation}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1, p: 2, bgcolor: 'grey.50', borderRadius: 2, mb: 2 }}>
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
                  disabled={loading || aiProcessing}
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
                  disabled={loading || aiProcessing}
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
                  disabled={loading || aiProcessing}
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
                  disabled={loading || aiProcessing}
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
                  disabled={loading || aiProcessing}
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
                  disabled={loading || aiProcessing}
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
              disabled={loading || aiProcessing}
              multiline
              rows={2}
            />

            <Box sx={{ display: 'flex', gap: 2 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={donationData.orderedFromUs}
                    onChange={(e) => setDonationData(prev => ({ ...prev, orderedFromUs: e.target.checked }))}
                    disabled={loading || aiProcessing}
                  />
                }
                label="Ordered from us?"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={donationData.followedUp}
                    onChange={(e) => setDonationData(prev => ({ ...prev, followedUp: e.target.checked }))}
                    disabled={loading || aiProcessing}
                  />
                }
                label="Followed up?"
              />
            </Box>
          </Box>
        </Collapse>

        {aiProcessing && (
          <div className="ai-processing">
            <span className="spinner"></span> AI is extracting information...
          </div>
        )}

        <button type="submit" disabled={loading || aiProcessing} className="btn-primary">
          {loading ? 'Saving...' : aiProcessing ? 'Processing...' : 'Save Contact'}
        </button>
      </form>
    </div>
  );
}
