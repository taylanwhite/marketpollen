import { useState } from 'react';
import { api } from '../api/client';
import { Contact } from '../types';
import {
  Box, Typography, TextField, Button, Dialog, DialogTitle,
  DialogContent, DialogActions, CircularProgress, Alert, IconButton,
  Checkbox, FormControlLabel,
} from '@mui/material';
import {
  Email as EmailIcon, ContentCopy as CopyIcon,
  Refresh as RefreshIcon, Check as CheckIcon,
  NoteAdd as LogIcon,
} from '@mui/icons-material';

interface GenerateEmailDialogProps {
  open: boolean;
  onClose: () => void;
  contactId: string;
  contactName?: string;
  onReachoutAdded?: () => void;
}

interface EmailDraft {
  subject: string;
  body: string;
}

export function GenerateEmailDialog({ open, onClose, contactId, contactName, onReachoutAdded }: GenerateEmailDialogProps) {
  const [customPrompt, setCustomPrompt] = useState('');
  const [feedback, setFeedback] = useState('');
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'subject' | 'body' | 'all' | null>(null);
  const [showLogConfirm, setShowLogConfirm] = useState(false);
  const [logConfirmed, setLogConfirmed] = useState(false);
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);

  const generate = async (refinement?: string) => {
    setLoading(true);
    setError('');
    setCopied(null);

    const prompt = refinement
      ? `Previous email:\nSubject: ${draft?.subject}\n\n${draft?.body}\n\nPlease revise the email with these changes: ${refinement}`
      : customPrompt.trim() || undefined;

    try {
      const result = await api.post<EmailDraft>('/generate-email', {
        contactId,
        customPrompt: prompt,
      });
      setDraft(result);
      setFeedback('');
    } catch (err: any) {
      setError(err.message || 'Failed to generate email');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, type: 'subject' | 'body' | 'all') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Failed to copy to clipboard');
    }
  };

  const logAsReachout = async () => {
    if (!draft) return;
    setLogging(true);
    setError('');
    try {
      const contact = await api.get<Contact>(`/contacts/${contactId}`);
      const existingReachouts = (contact.reachouts || []).map(r => ({
        date: r.date,
        note: r.note || '',
        rawNotes: r.rawNotes ?? null,
        createdBy: r.createdBy,
        type: r.type || 'other',
        donation: r.donation,
      }));

      const newReachout = {
        date: new Date().toISOString(),
        note: `[Email] Subject: ${draft.subject}\n\n${draft.body}`,
        type: 'email' as const,
      };

      await api.patch(`/contacts/${contactId}`, {
        lastReachoutDate: new Date().toISOString(),
        reachouts: [...existingReachouts, newReachout],
      });

      setLogged(true);
      onReachoutAdded?.();
    } catch (err: any) {
      setError(err.message || 'Failed to log reachout');
    } finally {
      setLogging(false);
    }
  };

  const handleClose = () => {
    setDraft(null);
    setCustomPrompt('');
    setFeedback('');
    setError('');
    setCopied(null);
    setShowLogConfirm(false);
    setLogConfirmed(false);
    setLogging(false);
    setLogged(false);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <EmailIcon /> Generate Email{contactName ? ` for ${contactName}` : ''}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Custom instructions (optional)"
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
            placeholder="e.g. Follow up about the sample tray we dropped off"
            fullWidth
            size="small"
            multiline
            maxRows={3}
          />

          {!draft && !loading && (
            <Button
              variant="contained"
              onClick={() => generate()}
              startIcon={<EmailIcon />}
              fullWidth
            >
              Generate Email
            </Button>
          )}

          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={32} />
            </Box>
          )}

          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

          {draft && (
            <>
              <Box sx={{ bgcolor: 'grey.50', borderRadius: 1, p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Subject
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={() => copyToClipboard(draft.subject, 'subject')}
                    color={copied === 'subject' ? 'success' : 'default'}
                  >
                    {copied === 'subject' ? <CheckIcon fontSize="small" /> : <CopyIcon fontSize="small" />}
                  </IconButton>
                </Box>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  {draft.subject}
                </Typography>
              </Box>

              <Box sx={{ bgcolor: 'grey.50', borderRadius: 1, p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Body
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={() => copyToClipboard(draft.body, 'body')}
                    color={copied === 'body' ? 'success' : 'default'}
                  >
                    {copied === 'body' ? <CheckIcon fontSize="small" /> : <CopyIcon fontSize="small" />}
                  </IconButton>
                </Box>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                  {draft.body}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  value={feedback}
                  onChange={e => setFeedback(e.target.value)}
                  placeholder="e.g. Make it shorter, mention the upcoming holiday..."
                  size="small"
                  fullWidth
                  multiline
                  maxRows={3}
                  disabled={loading}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey && feedback.trim()) {
                      e.preventDefault();
                      generate(feedback.trim());
                    }
                  }}
                />
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
                  onClick={() => feedback.trim() ? generate(feedback.trim()) : generate()}
                  disabled={loading}
                  sx={{ whiteSpace: 'nowrap', minWidth: 'auto', mt: 0.25 }}
                >
                  Revise
                </Button>
              </Box>

              {logged ? (
                <Alert severity="success" sx={{ mt: 1 }}>
                  Email logged as a reachout on this contact.
                </Alert>
              ) : showLogConfirm ? (
                <Box sx={{ mt: 1, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={logConfirmed}
                        onChange={e => setLogConfirmed(e.target.checked)}
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">
                        I've sent this email and want it recorded as a reachout
                      </Typography>
                    }
                  />
                  <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={logging ? <CircularProgress size={14} /> : <LogIcon />}
                      onClick={logAsReachout}
                      disabled={!logConfirmed || logging}
                    >
                      Confirm
                    </Button>
                    <Button
                      size="small"
                      onClick={() => { setShowLogConfirm(false); setLogConfirmed(false); }}
                      disabled={logging}
                    >
                      Cancel
                    </Button>
                  </Box>
                </Box>
              ) : (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<LogIcon />}
                  onClick={() => setShowLogConfirm(true)}
                  sx={{ alignSelf: 'flex-start', mt: 1 }}
                >
                  Log as Reachout
                </Button>
              )}
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2, justifyContent: draft ? 'space-between' : 'flex-end' }}>
        {draft && (
          <Button
            variant="contained"
            startIcon={copied === 'all' ? <CheckIcon /> : <CopyIcon />}
            onClick={() => copyToClipboard(`Subject: ${draft.subject}\n\n${draft.body}`, 'all')}
            color={copied === 'all' ? 'success' : 'primary'}
          >
            {copied === 'all' ? 'Copied!' : 'Copy All'}
          </Button>
        )}
        <Button onClick={handleClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
