import React, { useState, useEffect } from 'react';
import { doc, updateDoc, collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { extractContactInfo } from '../utils/openai';
import { Contact, Reachout, DonationData, MOUTH_VALUES, FileAttachment, CalendarEvent } from '../types';
import { calculateMouths, createEmptyDonation } from '../utils/donationCalculations';
import { usePermissions } from '../contexts/PermissionContext';
import { useDonation } from '../contexts/DonationContext';
import { uploadContactFile, deleteContactFile, formatFileSize, getFileIcon } from '../utils/fileUpload';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  Tabs,
  Tab,
  Grid,
  MenuItem,
  Chip,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Switch,
  FormControlLabel,
  Divider,
  Collapse,
  Checkbox,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Paper,
  LinearProgress,
  Dialog as PreviewDialog,
  DialogTitle as PreviewDialogTitle,
  DialogContent as PreviewDialogContent,
  DialogActions as PreviewDialogActions,
} from '@mui/material';
import {
  Close as CloseIcon,
  Mic as MicIcon,
  MicOff as MicOffIcon,
  AutoAwesome as AIIcon,
  Save as SaveIcon,
  Add as AddIcon,
  ExpandMore as ExpandMoreIcon,
  Phone as PhoneIcon,
  Email as EmailIcon,
  Handshake as MeetingIcon,
  MoreHoriz as OtherIcon,
  Cake as CakeIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Edit as EditIcon,
  AttachFile as AttachFileIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Visibility as VisibilityIcon,
  Search as SearchIcon,
} from '@mui/icons-material';

interface EditContactModalProps {
  contact: Contact;
  onClose: () => void;
  onSuccess: () => void;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div hidden={value !== index} style={{ paddingTop: 16 }}>
      {value === index && children}
    </div>
  );
}

const reachoutTypeIcons: Record<string, React.ReactElement> = {
  call: <PhoneIcon fontSize="small" />,
  email: <EmailIcon fontSize="small" />,
  meeting: <MeetingIcon fontSize="small" />,
  other: <OtherIcon fontSize="small" />,
};

export function EditContactModal({ contact, onClose, onSuccess }: EditContactModalProps) {
  const { currentUser } = useAuth();
  const { permissions } = usePermissions();
  const { triggerRefresh, setLastDonationMouths } = useDonation();
  const { transcript, interimTranscript, isListening, startListening, stopListening, clearTranscript, error: voiceError } = useVoiceInput();
  
  const [tabValue, setTabValue] = useState(0);
  const [formData, setFormData] = useState({
    firstName: contact.firstName || '',
    lastName: contact.lastName || '',
    email: contact.email || '',
    phone: contact.phone || '',
    personalDetails: contact.personalDetails || '',
    status: contact.status || 'new'
  });
  
  const [newReachout, setNewReachout] = useState({
    note: '',
    type: 'call' as 'call' | 'email' | 'meeting' | 'other'
  });
  
  const [rawNotes, setRawNotes] = useState('');
  const [includeDonation, setIncludeDonation] = useState(false);
  const [donationData, setDonationData] = useState<DonationData>(createEmptyDonation());
  const [editingReachoutId, setEditingReachoutId] = useState<string | null>(null);
  const [editingReachoutNote, setEditingReachoutNote] = useState('');
  const [editingReachoutDonation, setEditingReachoutDonation] = useState<DonationData | null>(null);
  const [editingIncludeDonation, setEditingIncludeDonation] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, number>>(new Map()); // file name -> progress
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<FileAttachment | null>(null);
  const [previewTextContent, setPreviewTextContent] = useState<string>('');
  const [loadingTextPreview, setLoadingTextPreview] = useState(false);
  const [attachmentSearchTerm, setAttachmentSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Update raw notes with transcript (combine final + interim for display)
  useEffect(() => {
    if (transcript || interimTranscript) {
      const fullText = interimTranscript ? `${transcript} ${interimTranscript}`.trim() : transcript;
      setRawNotes(fullText);
    }
  }, [transcript, interimTranscript]);

  // Load text content for preview
  useEffect(() => {
    if (previewFile && (previewFile.mimeType.startsWith('text/') || previewFile.mimeType.includes('json') || previewFile.mimeType.includes('xml'))) {
      setLoadingTextPreview(true);
      fetch(previewFile.downloadURL)
        .then(res => res.text())
        .then(text => setPreviewTextContent(text))
        .catch(err => {
          console.error('Error loading text preview:', err);
          setPreviewTextContent('Error loading file content');
        })
        .finally(() => setLoadingTextPreview(false));
    } else {
      setPreviewTextContent('');
    }
  }, [previewFile]);

  const processWithAI = async () => {
    if (!rawNotes.trim()) {
      setError('Please enter notes to process');
      return;
    }

    setAiProcessing(true);
    setError('');

    try {
      const extracted = await extractContactInfo(rawNotes);
      
      // Update reachout note (does NOT create a contact - just fills the form)
      setNewReachout(prev => ({
        ...prev,
        note: extracted.reachoutNote || rawNotes
      }));

      // Update contact form fields if they're empty
      setFormData(prev => ({
        ...prev,
        firstName: prev.firstName || extracted.firstName || '',
        lastName: prev.lastName || extracted.lastName || '',
        email: prev.email || extracted.email || '',
        phone: prev.phone || extracted.phone || '',
        personalDetails: prev.personalDetails || extracted.personalDetails || ''
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
      
      setSuccess('AI processed your notes! Review and adjust the extracted information.');
    } catch (err: any) {
      setError('AI processing failed. Using raw notes.');
      setNewReachout(prev => ({ ...prev, note: rawNotes }));
    } finally {
      setAiProcessing(false);
    }
  };

  const handleAddReachout = async () => {
    if (!newReachout.note.trim()) {
      setError('Please enter a note');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const reachout: Reachout = {
        id: `reach-${Date.now()}`,
        date: new Date(),
        note: newReachout.note,
        rawNotes: rawNotes || null,
        createdBy: currentUser?.uid || '',
        type: newReachout.type,
        storeId: permissions.currentStoreId || undefined,
        donation: includeDonation ? donationData : undefined,
      };

      const updatedReachouts = [...contact.reachouts, reachout];

      // Generate AI follow-up suggestion after adding reachout
      let followUpUpdate: any = {
        reachouts: updatedReachouts,
        lastReachoutDate: new Date(),
        suggestedFollowUpDate: null,
        suggestedFollowUpMethod: null,
        suggestedFollowUpNote: null,
        suggestedFollowUpPriority: null,
      };

      try {
        const { generateFollowUpSuggestion } = await import('../utils/openai');
        const aiSuggestion = await generateFollowUpSuggestion({
          firstName: contact.firstName || undefined,
          lastName: contact.lastName || undefined,
          reachouts: updatedReachouts.map(r => ({
            date: r.date instanceof Date ? r.date : new Date(r.date),
            note: r.note || '',
            type: r.type || 'other',
            donation: r.donation
          })),
          personalDetails: contact.personalDetails || undefined,
          status: contact.status || undefined,
          email: contact.email || undefined,
          phone: contact.phone || undefined,
        });

        followUpUpdate.suggestedFollowUpDate = new Date(aiSuggestion.suggestedDate);
        followUpUpdate.suggestedFollowUpMethod = aiSuggestion.suggestedMethod || null;
        followUpUpdate.suggestedFollowUpNote = aiSuggestion.message || null;
        followUpUpdate.suggestedFollowUpPriority = aiSuggestion.priority || null;
      } catch (aiError) {
        console.error('AI follow-up generation failed:', aiError);
        // Continue without AI suggestion - contact will keep existing or no suggestion
      }

      await updateDoc(doc(db, 'contacts', contact.id), followUpUpdate);

      // Create calendar event for the reachout
      try {
        const contactName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'Contact';
        // Normalize date to midnight local time
        const reachoutDate = reachout.date instanceof Date ? reachout.date : new Date(reachout.date);
        const normalizedReachoutDate = new Date(reachoutDate);
        normalizedReachoutDate.setHours(0, 0, 0, 0);
        
        await addDoc(collection(db, 'calendarEvents'), {
          storeId: permissions.currentStoreId || contact.storeId,
          title: `Reachout: ${contactName}`,
          description: reachout.note || null,
          date: normalizedReachoutDate,
          type: 'reachout',
          contactId: contact.id,
          businessId: contact.businessId,
          priority: 'medium',
          status: 'completed', // Past reachout is completed
          createdBy: currentUser?.uid || '',
          createdAt: new Date(),
          completedAt: new Date(),
        } as Omit<CalendarEvent, 'id'>);
      } catch (eventError) {
        console.error('Failed to create calendar event:', eventError);
        // Don't fail reachout creation if event creation fails
      }

      // Create calendar event for AI-suggested follow-up
      if (followUpUpdate.suggestedFollowUpDate) {
        try {
          const contactName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'Contact';
          // Normalize date to midnight local time to avoid timezone issues
          const followUpDate = followUpUpdate.suggestedFollowUpDate instanceof Date 
            ? followUpUpdate.suggestedFollowUpDate 
            : new Date(followUpUpdate.suggestedFollowUpDate);
          const normalizedFollowUpDate = new Date(followUpDate);
          normalizedFollowUpDate.setHours(0, 0, 0, 0);
          
          await addDoc(collection(db, 'calendarEvents'), {
            storeId: permissions.currentStoreId || contact.storeId,
            title: `Follow-up: ${contactName}`,
            description: followUpUpdate.suggestedFollowUpNote || `Follow up with ${contactName}`,
            date: normalizedFollowUpDate,
            type: 'followup',
            contactId: contact.id,
            businessId: contact.businessId,
            priority: followUpUpdate.suggestedFollowUpPriority || 'medium',
            status: 'scheduled',
            createdBy: currentUser?.uid || '',
            createdAt: new Date(),
          } as Omit<CalendarEvent, 'id'>);
        } catch (eventError) {
          console.error('Failed to create follow-up calendar event:', eventError);
          // Don't fail if event creation fails
        }
      }

      // Trigger donation tracker refresh if donation was included
      if (includeDonation && donationData) {
        const mouths = calculateMouths(donationData);
        setLastDonationMouths(mouths);
        triggerRefresh();
      }

      setNewReachout({ note: '', type: 'call' });
      setRawNotes('');
      setIncludeDonation(false);
      setDonationData(createEmptyDonation());
      clearTranscript();
      setSuccess('Reachout added!');
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to add reachout');
    } finally {
      setLoading(false);
    }
  };

  const handleEditReachout = (reachout: Reachout) => {
    setEditingReachoutId(reachout.id);
    setEditingReachoutNote(reachout.note);
    if (reachout.donation) {
      setEditingReachoutDonation({ ...reachout.donation });
      setEditingIncludeDonation(true);
    } else {
      setEditingReachoutDonation(createEmptyDonation());
      setEditingIncludeDonation(false);
    }
  };

  const handleSaveReachoutEdit = async (reachoutId: string) => {
    if (!editingReachoutNote.trim()) {
      setError('Note cannot be empty');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const originalReachout = contact.reachouts.find(r => r.id === reachoutId);
      const hadDonation = !!originalReachout?.donation;
      const originalMouths = originalReachout?.donation ? calculateMouths(originalReachout.donation) : 0;
      const newMouths = editingIncludeDonation && editingReachoutDonation ? calculateMouths(editingReachoutDonation) : 0;
      const mouthsDiff = newMouths - originalMouths;
      const donationChanged = hadDonation !== editingIncludeDonation || originalMouths !== newMouths;

      const updatedReachouts = contact.reachouts.map(r => {
        if (r.id === reachoutId) {
          const updated: Reachout = {
            ...r,
            note: editingReachoutNote,
            storeId: permissions.currentStoreId || r.storeId || undefined,
            donation: editingIncludeDonation && editingReachoutDonation ? editingReachoutDonation : undefined
          };
          return updated;
        }
        return r;
      });

      await updateDoc(doc(db, 'contacts', contact.id), {
        reachouts: updatedReachouts
      });

      // Trigger donation tracker refresh if donation was modified
      if (donationChanged) {
        if (mouthsDiff > 0) {
          // Positive change (adding donation or increasing amount) - animate with celebration
          setLastDonationMouths(mouthsDiff);
        } else {
          // Negative change or no change - refresh without celebration
          setLastDonationMouths(0);
        }
        // Always trigger refresh when donation changes, even if mouths are 0
        // This ensures the tracker updates correctly
        triggerRefresh();
      }

      setEditingReachoutId(null);
      setEditingReachoutNote('');
      setEditingReachoutDonation(null);
      setEditingIncludeDonation(false);
      setSuccess('Reachout updated!');
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to update reachout');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelReachoutEdit = () => {
    setEditingReachoutId(null);
    setEditingReachoutNote('');
    setEditingReachoutDonation(null);
    setEditingIncludeDonation(false);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0 || !currentUser) return;

    setError('');
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = file.name;
      
      try {
        // Update upload progress
        setUploadingFiles(prev => new Map(prev).set(fileName, 0));
        
        // Upload file
        const fileAttachment = await uploadContactFile(contact.id, file, currentUser.uid);
        
        // Add to contact's files array
        const currentFiles = contact.files || [];
        const updatedFiles = [...currentFiles, fileAttachment];
        
        await updateDoc(doc(db, 'contacts', contact.id), {
          files: updatedFiles
        });
        
        setUploadingFiles(prev => {
          const next = new Map(prev);
          next.delete(fileName);
          return next;
        });
        setSuccess(`File "${file.name}" uploaded successfully!`);
        onSuccess();
      } catch (err: any) {
        console.error('Error uploading file:', err);
        setError(`Failed to upload "${file.name}": ${err.message}`);
        setUploadingFiles(prev => {
          const next = new Map(prev);
          next.delete(fileName);
          return next;
        });
      }
    }
    
    // Reset file input
    event.target.value = '';
  };

  const handleFileDelete = async (fileId: string) => {
    if (!window.confirm('Are you sure you want to delete this file?')) {
      return;
    }

    const fileToDelete = contact.files?.find(f => f.id === fileId);
    if (!fileToDelete) return;

    setDeletingFileId(fileId);
    setError('');

    try {
      // Delete from Firebase Storage
      await deleteContactFile(fileToDelete.storagePath);
      
      // Remove from contact's files array
      const updatedFiles = (contact.files || []).filter(f => f.id !== fileId);
      
      await updateDoc(doc(db, 'contacts', contact.id), {
        files: updatedFiles
      });
      
      setSuccess('File deleted successfully!');
      onSuccess();
    } catch (err: any) {
      console.error('Error deleting file:', err);
      setError(`Failed to delete file: ${err.message}`);
    } finally {
      setDeletingFileId(null);
    }
  };

  const handleUpdateContact = async () => {
    setLoading(true);
    setError('');

    try {
      await updateDoc(doc(db, 'contacts', contact.id), {
        firstName: formData.firstName || null,
        lastName: formData.lastName || null,
        email: formData.email || null,
        phone: formData.phone || null,
        personalDetails: formData.personalDetails || null,
        status: formData.status
      });

      setSuccess('Contact updated!');
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to update contact');
    } finally {
      setLoading(false);
    }
  };

  const getContactName = () => {
    if (formData.firstName || formData.lastName) {
      return `${formData.firstName} ${formData.lastName}`.trim();
    }
    return formData.email || formData.phone || 'Contact';
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
        <Typography component="span" variant="h5" sx={{ fontWeight: 600 }}>
          {getContactName()}
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        {/* Mobile: Use Select dropdown */}
        <Box sx={{ display: { xs: 'block', sm: 'none' }, px: 2, py: 1.5 }}>
          <TextField
            select
            value={tabValue}
            onChange={(e) => setTabValue(Number(e.target.value))}
            fullWidth
            size="small"
            sx={{
              '& .MuiSelect-select': {
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                py: 1.5,
              }
            }}
          >
            <MenuItem value={0}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                <AddIcon fontSize="small" />
                <Typography>Add Reachout</Typography>
              </Box>
            </MenuItem>
            <MenuItem value={1}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                <Typography>Contact Details</Typography>
              </Box>
            </MenuItem>
            <MenuItem value={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                <Typography>History ({contact.reachouts.length})</Typography>
              </Box>
            </MenuItem>
            <MenuItem value={3}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                <CakeIcon fontSize="small" />
                <Typography>Donations ({contact.reachouts.filter(r => r.donation).length})</Typography>
              </Box>
            </MenuItem>
            <MenuItem value={4}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                <AttachFileIcon fontSize="small" />
                <Typography>Attachments ({contact.files?.length || 0})</Typography>
              </Box>
            </MenuItem>
          </TextField>
        </Box>
        
        {/* Desktop: Use horizontal scrollable tabs */}
        <Box sx={{ display: { xs: 'none', sm: 'block' }, px: 3 }}>
          <Tabs 
            value={tabValue} 
            onChange={(_, v) => setTabValue(v)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
          >
            <Tab label="Add Reachout" />
            <Tab label="Contact Details" />
            <Tab label={`History (${contact.reachouts.length})`} />
            <Tab 
              label={`Donations (${contact.reachouts.filter(r => r.donation).length})`}
              icon={<CakeIcon sx={{ fontSize: 16 }} />}
              iconPosition="start"
            />
            <Tab 
              label={`Attachments (${contact.files?.length || 0})`}
              icon={<AttachFileIcon sx={{ fontSize: 16 }} />}
              iconPosition="start"
            />
          </Tabs>
        </Box>
      </Box>

      <DialogContent sx={{ minHeight: 400 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

        {/* Tab 0: Add Reachout */}
        <TabPanel value={tabValue} index={0}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Voice Recording */}
            <Card variant="outlined">
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <Button
                    variant={isListening ? 'contained' : 'outlined'}
                    color={isListening ? 'error' : 'primary'}
                    startIcon={isListening ? <MicOffIcon /> : <MicIcon />}
                    onClick={isListening ? stopListening : startListening}
                    disabled={aiProcessing || loading}
                  >
                    {isListening ? 'Stop Recording' : 'Record Notes'}
                  </Button>
                  {isListening && (
                    <Chip label="🔴 Listening..." color="error" size="small" />
                  )}
                </Box>
                {voiceError && (
                  <Alert severity="warning" sx={{ mb: 2 }}>{voiceError}</Alert>
                )}
                <TextField
                  label="Meeting Notes"
                  multiline
                  rows={4}
                  value={rawNotes}
                  onChange={(e) => setRawNotes(e.target.value)}
                  placeholder="Type or speak your notes about this interaction..."
                  fullWidth
                  disabled={aiProcessing || loading}
                />
                <Button
                  variant="outlined"
                  startIcon={aiProcessing ? <CircularProgress size={16} /> : <AIIcon />}
                  onClick={processWithAI}
                  disabled={aiProcessing || !rawNotes.trim() || loading}
                  sx={{ mt: 1 }}
                >
                  {aiProcessing ? 'Processing...' : 'Process'}
                </Button>
              </CardContent>
            </Card>

            {/* Reachout Details */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                select
                label="Type"
                value={newReachout.type}
                onChange={(e) => setNewReachout(prev => ({ ...prev, type: e.target.value as any }))}
                sx={{ width: 150 }}
                disabled={loading}
              >
                <MenuItem value="call">📞 Call</MenuItem>
                <MenuItem value="email">📧 Email</MenuItem>
                <MenuItem value="meeting">🤝 Meeting</MenuItem>
                <MenuItem value="other">📝 Other</MenuItem>
              </TextField>
            </Box>

            <TextField
              label="Summary Note"
              multiline
              rows={3}
              value={newReachout.note}
              onChange={(e) => setNewReachout(prev => ({ ...prev, note: e.target.value }))}
              placeholder="Summarized note (AI will fill this, or type manually)"
              fullWidth
              disabled={loading}
            />

            {/* Donation Toggle */}
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
                  disabled={loading}
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
                      disabled={loading}
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
                      disabled={loading}
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
                      disabled={loading}
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
                      disabled={loading}
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
                      disabled={loading}
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
                      disabled={loading}
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
                  disabled={loading}
                />

                <Box sx={{ display: 'flex', gap: 2 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={donationData.orderedFromUs}
                        onChange={(e) => setDonationData(prev => ({ ...prev, orderedFromUs: e.target.checked }))}
                        disabled={loading}
                      />
                    }
                    label="Ordered from us?"
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={donationData.followedUp}
                        onChange={(e) => setDonationData(prev => ({ ...prev, followedUp: e.target.checked }))}
                        disabled={loading}
                      />
                    }
                    label="Followed up?"
                  />
                </Box>
              </Box>
            </Collapse>

            <Button
              variant="contained"
              size="large"
              startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <AddIcon />}
              onClick={handleAddReachout}
              disabled={loading || !newReachout.note.trim()}
            >
              {loading ? 'Saving...' : 'Add Reachout'}
            </Button>
          </Box>
        </TabPanel>

        {/* Tab 1: Contact Details */}
        <TabPanel value={tabValue} index={1}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="First Name"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Last Name"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Personal Details"
                value={formData.personalDetails}
                onChange={(e) => setFormData({ ...formData, personalDetails: e.target.value })}
                placeholder="Hobbies, family info, conversation starters..."
                helperText="Notes to help build rapport"
                fullWidth
                multiline
                rows={3}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select
                label="Status"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as 'new' | 'contacted' | 'active' | 'converted' | 'inactive' })}
                fullWidth
              >
                <MenuItem value="new">🆕 New</MenuItem>
                <MenuItem value="contacted">📞 Contacted</MenuItem>
                <MenuItem value="active">✅ Active</MenuItem>
                <MenuItem value="converted">🎉 Converted</MenuItem>
                <MenuItem value="inactive">💤 Inactive</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Button
                variant="contained"
                startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
                onClick={handleUpdateContact}
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </Button>
            </Grid>
          </Grid>
        </TabPanel>

        {/* Tab 2: Reachout History */}
        <TabPanel value={tabValue} index={2}>
          {contact.reachouts.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">No reachouts yet</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {contact.reachouts.slice().reverse().map((reachout, index) => (
                <Accordion key={reachout.id} defaultExpanded={index === 0}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                      <Chip
                        icon={reachoutTypeIcons[reachout.type || 'other']}
                        label={reachout.type || 'other'}
                        size="small"
                        variant="outlined"
                      />
                      <Typography variant="body2" color="text.secondary">
                        {reachout.date.toLocaleDateString()} at {reachout.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Typography>
                      {reachout.donation && (
                        <Chip
                          icon={<CakeIcon sx={{ fontSize: 14 }} />}
                          label={`${calculateMouths(reachout.donation)} mouths`}
                          size="small"
                          color="primary"
                          sx={{ ml: 'auto' }}
                        />
                      )}
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    {editingReachoutId === reachout.id ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <TextField
                          label="Reachout Note"
                          multiline
                          rows={4}
                          value={editingReachoutNote}
                          onChange={(e) => setEditingReachoutNote(e.target.value)}
                          fullWidth
                          disabled={loading}
                        />

                        {/* Donation Toggle for Editing */}
                        <Divider sx={{ my: 1 }} />
                        <FormControlLabel
                          control={
                            <Switch
                              checked={editingIncludeDonation}
                              onChange={(e) => {
                                const isChecked = e.target.checked;
                                setEditingIncludeDonation(isChecked);
                                if (!isChecked) {
                                  setEditingReachoutDonation(createEmptyDonation());
                                } else {
                                  // Ensure donation object exists when toggling on
                                  if (!editingReachoutDonation) {
                                    setEditingReachoutDonation(createEmptyDonation());
                                  }
                                }
                              }}
                              disabled={loading}
                            />
                          }
                          label={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <CakeIcon fontSize="small" />
                              <Typography>Include Donation</Typography>
                            </Box>
                          }
                        />

                        {/* Donation Fields for Editing */}
                        {editingIncludeDonation && (
                          <Collapse in={editingIncludeDonation}>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1, p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <CakeIcon fontSize="small" color="primary" />
                                Product Donations
                                <Chip 
                                  label={`${editingReachoutDonation ? calculateMouths(editingReachoutDonation) : 0} mouths`} 
                                  size="small" 
                                  color="primary" 
                                  sx={{ ml: 'auto' }}
                                />
                              </Typography>

                              <Grid container spacing={2}>
                                <Grid size={{ xs: 6, sm: 4 }}>
                                  <TextField
                                    label="FREE Bundtlet Card"
                                    type="number"
                                    size="small"
                                    fullWidth
                                    value={editingReachoutDonation?.freeBundletCard || ''}
                                    onChange={(e) => setEditingReachoutDonation(prev => prev ? { ...prev, freeBundletCard: parseInt(e.target.value) || 0 } : createEmptyDonation())}
                                    helperText={`${MOUTH_VALUES.freeBundletCard} mouth each`}
                                    disabled={loading}
                                    slotProps={{ htmlInput: { min: 0 } }}
                                  />
                                </Grid>
                                <Grid size={{ xs: 6, sm: 4 }}>
                                  <TextField
                                    label="Dozen Bundtinis"
                                    type="number"
                                    size="small"
                                    fullWidth
                                    value={editingReachoutDonation?.dozenBundtinis || ''}
                                    onChange={(e) => setEditingReachoutDonation(prev => prev ? { ...prev, dozenBundtinis: parseInt(e.target.value) || 0 } : createEmptyDonation())}
                                    helperText={`${MOUTH_VALUES.dozenBundtinis} mouths each`}
                                    disabled={loading}
                                    slotProps={{ htmlInput: { min: 0 } }}
                                  />
                                </Grid>
                                <Grid size={{ xs: 6, sm: 4 }}>
                                  <TextField
                                    label="8&quot; Cake"
                                    type="number"
                                    size="small"
                                    fullWidth
                                    value={editingReachoutDonation?.cake8inch || ''}
                                    onChange={(e) => setEditingReachoutDonation(prev => prev ? { ...prev, cake8inch: parseInt(e.target.value) || 0 } : createEmptyDonation())}
                                    helperText={`${MOUTH_VALUES.cake8inch} mouths each`}
                                    disabled={loading}
                                    slotProps={{ htmlInput: { min: 0 } }}
                                  />
                                </Grid>
                                <Grid size={{ xs: 6, sm: 4 }}>
                                  <TextField
                                    label="10&quot; Cake"
                                    type="number"
                                    size="small"
                                    fullWidth
                                    value={editingReachoutDonation?.cake10inch || ''}
                                    onChange={(e) => setEditingReachoutDonation(prev => prev ? { ...prev, cake10inch: parseInt(e.target.value) || 0 } : createEmptyDonation())}
                                    helperText={`${MOUTH_VALUES.cake10inch} mouths each`}
                                    disabled={loading}
                                    slotProps={{ htmlInput: { min: 0 } }}
                                  />
                                </Grid>
                                <Grid size={{ xs: 6, sm: 4 }}>
                                  <TextField
                                    label="Sample Tray"
                                    type="number"
                                    size="small"
                                    fullWidth
                                    value={editingReachoutDonation?.sampleTray || ''}
                                    onChange={(e) => setEditingReachoutDonation(prev => prev ? { ...prev, sampleTray: parseInt(e.target.value) || 0 } : createEmptyDonation())}
                                    helperText={`${MOUTH_VALUES.sampleTray} mouths each`}
                                    disabled={loading}
                                    slotProps={{ htmlInput: { min: 0 } }}
                                  />
                                </Grid>
                                <Grid size={{ xs: 6, sm: 4 }}>
                                  <TextField
                                    label="Bundtlet/Tower"
                                    type="number"
                                    size="small"
                                    fullWidth
                                    value={editingReachoutDonation?.bundtletTower || ''}
                                    onChange={(e) => setEditingReachoutDonation(prev => prev ? { ...prev, bundtletTower: parseInt(e.target.value) || 0 } : createEmptyDonation())}
                                    helperText={`${MOUTH_VALUES.bundtletTower} mouth each`}
                                    disabled={loading}
                                    slotProps={{ htmlInput: { min: 0 } }}
                                  />
                                </Grid>
                              </Grid>

                              <TextField
                                label="Cakes Donated Notes"
                                size="small"
                                fullWidth
                                value={editingReachoutDonation?.cakesDonatedNotes || ''}
                                onChange={(e) => setEditingReachoutDonation(prev => prev ? { ...prev, cakesDonatedNotes: e.target.value } : createEmptyDonation())}
                                placeholder="Any notes about the donation..."
                                disabled={loading}
                              />

                              <Box sx={{ display: 'flex', gap: 2 }}>
                                <FormControlLabel
                                  control={
                                    <Checkbox
                                      checked={editingReachoutDonation?.orderedFromUs || false}
                                      onChange={(e) => setEditingReachoutDonation(prev => prev ? { ...prev, orderedFromUs: e.target.checked } : createEmptyDonation())}
                                      disabled={loading}
                                    />
                                  }
                                  label="Ordered from us?"
                                />
                                <FormControlLabel
                                  control={
                                    <Checkbox
                                      checked={editingReachoutDonation?.followedUp || false}
                                      onChange={(e) => setEditingReachoutDonation(prev => prev ? { ...prev, followedUp: e.target.checked } : createEmptyDonation())}
                                      disabled={loading}
                                    />
                                  }
                                  label="Followed up?"
                                />
                              </Box>
                            </Box>
                          </Collapse>
                        )}

                        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                          <Button
                            size="small"
                            onClick={handleCancelReachoutEdit}
                            disabled={loading}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="contained"
                            size="small"
                            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                            onClick={() => handleSaveReachoutEdit(reachout.id)}
                            disabled={loading || !editingReachoutNote.trim()}
                          >
                            Save
                          </Button>
                        </Box>
                      </Box>
                    ) : (
                      <>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                          <Typography variant="body1" sx={{ flex: 1 }}>
                            {reachout.note}
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={() => handleEditReachout(reachout)}
                            sx={{ ml: 1 }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Box>
                        {reachout.rawNotes && (
                          <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                              Original Notes:
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                              {reachout.rawNotes}
                            </Typography>
                          </Box>
                        )}
                      </>
                    )}
                  </AccordionDetails>
                </Accordion>
              ))}
            </Box>
          )}
        </TabPanel>

        {/* Tab 3: Donations History */}
        <TabPanel value={tabValue} index={3}>
          {(() => {
            const donationReachouts = contact.reachouts.filter(r => r.donation);
            const totalMouths = donationReachouts.reduce(
              (sum, r) => sum + (r.donation ? calculateMouths(r.donation) : 0),
              0
            );

            if (donationReachouts.length === 0) {
              return (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <CakeIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
                  <Typography color="text.secondary">No donations recorded yet</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Add a donation when creating a reachout using the "Include Donation" toggle
                  </Typography>
                </Box>
              );
            }

            return (
              <Box>
                {/* Summary Card */}
                <Card sx={{ mb: 2, bgcolor: 'primary.main', color: 'white' }}>
                  <CardContent sx={{ py: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Box>
                        <Typography variant="body2" sx={{ opacity: 0.8 }}>
                          Total Contribution
                        </Typography>
                        <Typography variant="h4" sx={{ fontWeight: 700 }}>
                          {totalMouths.toLocaleString()} mouths
                        </Typography>
                      </Box>
                      <Chip
                        label={`${donationReachouts.length} donation${donationReachouts.length !== 1 ? 's' : ''}`}
                        sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }}
                      />
                    </Box>
                  </CardContent>
                </Card>

                {/* Donation List */}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {donationReachouts.slice().reverse().map((reachout) => (
                    <Card key={reachout.id} variant="outlined">
                      <CardContent sx={{ py: 1.5 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                          <Typography variant="body2" color="text.secondary">
                            {reachout.date.toLocaleDateString()}
                          </Typography>
                          <Chip
                            label={`${calculateMouths(reachout.donation!)} mouths`}
                            size="small"
                            color="primary"
                          />
                        </Box>

                        <Grid container spacing={1} sx={{ mt: 1 }}>
                          {reachout.donation!.freeBundletCard > 0 && (
                            <Grid size={{ xs: 6, sm: 4 }}>
                              <Typography variant="caption" color="text.secondary">
                                Bundtlet Cards: <strong>{reachout.donation!.freeBundletCard}</strong>
                              </Typography>
                            </Grid>
                          )}
                          {reachout.donation!.dozenBundtinis > 0 && (
                            <Grid size={{ xs: 6, sm: 4 }}>
                              <Typography variant="caption" color="text.secondary">
                                Dozen Bundtinis: <strong>{reachout.donation!.dozenBundtinis}</strong>
                              </Typography>
                            </Grid>
                          )}
                          {reachout.donation!.cake8inch > 0 && (
                            <Grid size={{ xs: 6, sm: 4 }}>
                              <Typography variant="caption" color="text.secondary">
                                8" Cakes: <strong>{reachout.donation!.cake8inch}</strong>
                              </Typography>
                            </Grid>
                          )}
                          {reachout.donation!.cake10inch > 0 && (
                            <Grid size={{ xs: 6, sm: 4 }}>
                              <Typography variant="caption" color="text.secondary">
                                10" Cakes: <strong>{reachout.donation!.cake10inch}</strong>
                              </Typography>
                            </Grid>
                          )}
                          {reachout.donation!.sampleTray > 0 && (
                            <Grid size={{ xs: 6, sm: 4 }}>
                              <Typography variant="caption" color="text.secondary">
                                Sample Trays: <strong>{reachout.donation!.sampleTray}</strong>
                              </Typography>
                            </Grid>
                          )}
                          {reachout.donation!.bundtletTower > 0 && (
                            <Grid size={{ xs: 6, sm: 4 }}>
                              <Typography variant="caption" color="text.secondary">
                                Bundtlet/Tower: <strong>{reachout.donation!.bundtletTower}</strong>
                              </Typography>
                            </Grid>
                          )}
                        </Grid>

                        {reachout.donation!.cakesDonatedNotes && (
                          <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
                            "{reachout.donation!.cakesDonatedNotes}"
                          </Typography>
                        )}

                        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {reachout.donation!.orderedFromUs ? (
                              <CheckCircleIcon fontSize="small" color="success" />
                            ) : (
                              <CancelIcon fontSize="small" color="disabled" />
                            )}
                            <Typography variant="caption" color="text.secondary">
                              Ordered
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {reachout.donation!.followedUp ? (
                              <CheckCircleIcon fontSize="small" color="success" />
                            ) : (
                              <CancelIcon fontSize="small" color="disabled" />
                            )}
                            <Typography variant="caption" color="text.secondary">
                              Followed Up
                            </Typography>
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              </Box>
            );
          })()}
        </TabPanel>

        {/* Tab 4: Attachments */}
        <TabPanel value={tabValue} index={4}>
          <Box>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
              <AttachFileIcon />
              Attached Files
            </Typography>
            
            {/* File Upload */}
            <Box sx={{ mb: 2 }}>
              <input
                accept="*/*"
                style={{ display: 'none' }}
                id="file-upload-input"
                type="file"
                multiple
                onChange={handleFileUpload}
                disabled={loading || uploadingFiles.size > 0}
              />
              <label htmlFor="file-upload-input">
                <Button
                  variant="outlined"
                  component="span"
                  startIcon={<AttachFileIcon />}
                  disabled={loading || uploadingFiles.size > 0}
                  sx={{ mb: 2 }}
                >
                  Upload Files
                </Button>
              </label>
              
              {/* Upload Progress */}
              {uploadingFiles.size > 0 && (
                <Box sx={{ mt: 1 }}>
                  {Array.from(uploadingFiles.keys()).map((fileName) => (
                    <Box key={fileName} sx={{ mb: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        Uploading {fileName}...
                      </Typography>
                      <LinearProgress variant="indeterminate" sx={{ mt: 0.5 }} />
                    </Box>
                  ))}
                </Box>
              )}
            </Box>

            {/* Search Bar */}
            {contact.files && contact.files.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Search attachments..."
                  value={attachmentSearchTerm}
                  onChange={(e) => setAttachmentSearchTerm(e.target.value)}
                  InputProps={{
                    startAdornment: <SearchIcon sx={{ color: 'text.secondary', mr: 1, fontSize: 20 }} />,
                  }}
                />
              </Box>
            )}

            {/* File List */}
            {(() => {
              const filteredFiles = contact.files?.filter(file => 
                file.name.toLowerCase().includes(attachmentSearchTerm.toLowerCase())
              ) || [];

              if (!contact.files || contact.files.length === 0) {
                return (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <AttachFileIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
                    <Typography color="text.secondary">No files attached</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Upload files to attach them to this contact
                    </Typography>
                  </Box>
                );
              }

              if (filteredFiles.length === 0) {
                return (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <SearchIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
                    <Typography color="text.secondary">No files match your search</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Try a different search term
                    </Typography>
                  </Box>
                );
              }

              return (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <List>
                    {filteredFiles.map((file, index) => (
                    <React.Fragment key={file.id}>
                      {index > 0 && <Divider />}
                      <ListItem>
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="body2">{getFileIcon(file.mimeType)}</Typography>
                              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                {file.name}
                              </Typography>
                            </Box>
                          }
                          secondary={
                            <Typography variant="caption" color="text.secondary" component="span">
                              {formatFileSize(file.size)} • {file.uploadedAt.toLocaleDateString()}
                            </Typography>
                          }
                        />
                        <ListItemSecondaryAction>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <IconButton
                              edge="end"
                              size="small"
                              onClick={() => setPreviewFile(file)}
                              title="Preview"
                            >
                              <VisibilityIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              edge="end"
                              size="small"
                              onClick={() => window.open(file.downloadURL, '_blank')}
                              title="Download"
                            >
                              <DownloadIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              edge="end"
                              size="small"
                              onClick={() => handleFileDelete(file.id)}
                              disabled={deletingFileId === file.id}
                              color="error"
                              title="Delete"
                            >
                              {deletingFileId === file.id ? (
                                <CircularProgress size={16} />
                              ) : (
                                <DeleteIcon fontSize="small" />
                              )}
                            </IconButton>
                          </Box>
                        </ListItemSecondaryAction>
                      </ListItem>
                    </React.Fragment>
                    ))}
                  </List>
                </Paper>
              );
            })()}
          </Box>
        </TabPanel>
      </DialogContent>

      <DialogActions sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      {/* File Preview Dialog */}
      <PreviewDialog
        open={!!previewFile}
        onClose={() => setPreviewFile(null)}
        maxWidth="md"
        fullWidth
      >
        {previewFile && (
          <>
            <PreviewDialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6">{previewFile.name}</Typography>
              <IconButton onClick={() => setPreviewFile(null)} size="small">
                <CloseIcon />
              </IconButton>
            </PreviewDialogTitle>
            <PreviewDialogContent>
              {previewFile.mimeType.startsWith('image/') ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
                  <img
                    src={previewFile.downloadURL}
                    alt={previewFile.name}
                    style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
                  />
                </Box>
              ) : previewFile.mimeType.includes('pdf') ? (
                <Box sx={{ width: '100%', height: '70vh' }}>
                  <iframe
                    src={previewFile.downloadURL}
                    style={{ width: '100%', height: '100%', border: 'none' }}
                    title={previewFile.name}
                  />
                </Box>
              ) : previewFile.mimeType.startsWith('text/') || previewFile.mimeType.includes('json') || previewFile.mimeType.includes('xml') ? (
                <Box sx={{ width: '100%', maxHeight: '70vh', overflow: 'auto' }}>
                  {loadingTextPreview ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
                      <CircularProgress />
                    </Box>
                  ) : (
                    <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                      {previewTextContent}
                    </Typography>
                  )}
                </Box>
              ) : (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                    Preview not available for this file type
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {previewFile.mimeType}
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<DownloadIcon />}
                    onClick={() => window.open(previewFile.downloadURL, '_blank')}
                  >
                    Download to View
                  </Button>
                </Box>
              )}
            </PreviewDialogContent>
            <PreviewDialogActions>
              <Button onClick={() => window.open(previewFile.downloadURL, '_blank')} startIcon={<DownloadIcon />}>
                Download
              </Button>
              <Button onClick={() => setPreviewFile(null)}>Close</Button>
            </PreviewDialogActions>
          </>
        )}
      </PreviewDialog>
    </Dialog>
  );
}
