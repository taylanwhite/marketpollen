import { useState, useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { extractContactInfo } from '../utils/openai';
import { Contact, Reachout } from '../types';
import { calculateMouths } from '../utils/donationCalculations';
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
  const { transcript, interimTranscript, isListening, startListening, stopListening, clearTranscript, error: voiceError } = useVoiceInput();
  
  const [tabValue, setTabValue] = useState(0);
  const [formData, setFormData] = useState({
    firstName: contact.firstName || '',
    lastName: contact.lastName || '',
    email: contact.email || '',
    phone: contact.phone || '',
    address: contact.address || '',
    city: contact.city || '',
    state: contact.state || '',
    zipCode: contact.zipCode || '',
    personalDetails: contact.personalDetails || '',
    status: contact.status || 'new'
  });
  
  const [newReachout, setNewReachout] = useState({
    note: '',
    type: 'call' as 'call' | 'email' | 'meeting' | 'other'
  });
  
  const [rawNotes, setRawNotes] = useState('');
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

  const processWithAI = async () => {
    if (!rawNotes.trim()) {
      setError('Please enter notes to process');
      return;
    }

    setAiProcessing(true);
    setError('');

    try {
      const extracted = await extractContactInfo(rawNotes);
      setNewReachout(prev => ({
        ...prev,
        note: extracted.reachoutNote || rawNotes
      }));
      setSuccess('AI processed your notes!');
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
        type: newReachout.type
      };

      const updatedReachouts = [...contact.reachouts, reachout];

      await updateDoc(doc(db, 'contacts', contact.id), {
        reachouts: updatedReachouts,
        lastReachoutDate: new Date()
      });

      setNewReachout({ note: '', type: 'call' });
      setRawNotes('');
      clearTranscript();
      setSuccess('Reachout added!');
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to add reachout');
    } finally {
      setLoading(false);
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
        address: formData.address || null,
        city: formData.city || null,
        state: formData.state?.toUpperCase() || null,
        zipCode: formData.zipCode || null,
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
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {getContactName()}
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
          <Tab label="Add Reachout" />
          <Tab label="Contact Details" />
          <Tab label={`History (${contact.reachouts.length})`} />
          <Tab 
            label={`Donations (${contact.reachouts.filter(r => r.donation).length})`}
            icon={<CakeIcon sx={{ fontSize: 16 }} />}
            iconPosition="start"
          />
        </Tabs>
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
                  {aiProcessing ? 'Processing...' : 'Process with AI'}
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
                label="Address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }}>
              <TextField
                label="City"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                label="State"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                inputProps={{ maxLength: 2 }}
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TextField
                label="Zip Code"
                value={formData.zipCode}
                onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                inputProps={{ maxLength: 5 }}
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
                rows={2}
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
                    <Typography variant="body1" sx={{ mb: 1 }}>
                      {reachout.note}
                    </Typography>
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
      </DialogContent>

      <DialogActions sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
