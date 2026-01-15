import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, setDoc, doc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { extractContactInfo } from '../utils/openai';
import { Contact, Reachout } from '../types';

interface ContactFormProps {
  onSuccess?: () => void;
}

interface Business {
  id: string;
  name: string;
}

export function ContactForm({ onSuccess }: ContactFormProps) {
  const { currentUser } = useAuth();
  const { transcript, interimTranscript, isListening, startListening, stopListening, clearTranscript, error: voiceError } = useVoiceInput();
  
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState('');
  const [newBusinessName, setNewBusinessName] = useState('');
  const [showNewBusiness, setShowNewBusiness] = useState(false);
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    personalDetails: '',
    reachoutNote: '',
    reachoutType: 'call' as 'call' | 'email' | 'meeting' | 'other',
    suggestedFollowUpDays: 3
  });

  const [rawNotes, setRawNotes] = useState(''); // Editable raw meeting notes
  
  const [loading, setLoading] = useState(false);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Load businesses on mount
  useEffect(() => {
    loadBusinesses();
  }, []);

  const loadBusinesses = async () => {
    try {
      // Get all businesses (no ordering to avoid index requirements)
      const querySnapshot = await getDocs(collection(db, 'businesses'));
      const businessList: Business[] = [];
      querySnapshot.forEach((doc) => {
        businessList.push({ id: doc.id, name: doc.data().name });
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
      
      setFormData(prev => ({
        ...prev,
        firstName: extracted.firstName || prev.firstName,
        lastName: extracted.lastName || prev.lastName,
        email: extracted.email || prev.email,
        phone: extracted.phone || prev.phone,
        address: extracted.address || prev.address,
        city: extracted.city || prev.city,
        state: extracted.state || prev.state,
        zipCode: extracted.zipCode || prev.zipCode,
        personalDetails: extracted.personalDetails || prev.personalDetails,
        reachoutNote: extracted.reachoutNote || prev.reachoutNote,
        suggestedFollowUpDays: extracted.suggestedFollowUpDays || prev.suggestedFollowUpDays
      }));
      
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

    try {
      const businessId = newBusinessName.trim().toUpperCase().replace(/\s+/g, '-');
      await setDoc(doc(db, 'businesses', businessId), {
        id: businessId,
        name: newBusinessName.trim(),
        createdAt: new Date(),
        createdBy: currentUser?.uid
      });
      
      await loadBusinesses();
      setSelectedBusinessId(businessId);
      setNewBusinessName('');
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

    setLoading(true);

    try {
      const now = new Date();
      
      // Calculate suggested follow-up date
      const suggestedFollowUpDate = new Date(now);
      suggestedFollowUpDate.setDate(suggestedFollowUpDate.getDate() + formData.suggestedFollowUpDays);
      
      // Create initial reachout if note provided
      const initialReachout: Reachout = {
        id: `reach-${Date.now()}`,
        date: now,
        note: formData.reachoutNote || 'Initial contact created',
        rawNotes: rawNotes || null,
        createdBy: currentUser.uid,
        type: formData.reachoutType
      };

      const contactData: Omit<Contact, 'id'> = {
        businessId: selectedBusinessId,
        contactId: generateContactId(),
        firstName: formData.firstName || null,
        lastName: formData.lastName || null,
        email: formData.email || null,
        phone: formData.phone || null,
        address: formData.address || null,
        city: formData.city || null,
        state: formData.state || null,
        zipCode: formData.zipCode || null,
        personalDetails: formData.personalDetails || null,
        suggestedFollowUpDate,
        reachouts: [initialReachout],
        createdAt: now,
        createdBy: currentUser.uid,
        lastReachoutDate: now,
        status: 'new'
      };

      await addDoc(collection(db, 'contacts'), contactData);
      
      setSuccess(true);
      setFormData({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        state: '',
        zipCode: '',
        personalDetails: '',
        reachoutNote: '',
        reachoutType: 'call',
        suggestedFollowUpDays: 3
      });
      setRawNotes('');
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
          Edit your notes below, then click "Process with AI" to extract contact information.
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
          {aiProcessing ? '🤖 Processing...' : '🤖 Process with AI'}
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
              />
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
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
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
