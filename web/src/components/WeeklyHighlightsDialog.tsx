import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, IconButton, InputAdornment, TextField, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  AutoAwesome as SparkleIcon, ContentCopy as CopyIcon, Send as SendIcon, Check as CheckIcon,
  Mic as MicIcon, MicOff as MicOffIcon, PlaylistAdd as AddDetailsIcon, Person as MeIcon,
} from '@mui/icons-material';
import { api } from '../api/client';
import { useOffline } from '../contexts/OfflineContext';
import { OnlineOnlyNotice } from './OnlineOnlyNotice';
import { useVoiceInput } from '../hooks/useVoiceInput';

interface Recipient { email: string; name: string; admin: boolean }

interface Draft {
  subject: string;
  intro: string;
  bullets: string[];
  statsLine: string;
  recipients: Recipient[];
  empty: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  storeId: string;
  /** Whose visits to summarize. Leave out for the signed-in person. */
  marketerId?: string;
  marketerName?: string;
}

function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Monday to Sunday of the week `weeksAgo` weeks back. */
function weekRange(weeksAgo: number): { from: string; to: string } {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) - weeksAgo * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: isoDay(monday), to: isoDay(sunday) };
}

function toBody(intro: string, bullets: string[]): string {
  return `${intro}\n\n${bullets.map((b) => `- ${b}`).join('\n')}`.trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function WeeklyHighlightsDialog({ open, onClose, storeId, marketerId, marketerName }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const { isOnline } = useOffline();

  // On Mondays people are usually writing up the week that just ended.
  const defaultWeeksAgo = new Date().getDay() === 1 ? 1 : 0;
  const [range, setRange] = useState(() => weekRange(defaultWeeksAgo));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [includeStats, setIncludeStats] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [extraEmail, setExtraEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [extra, setExtra] = useState('');
  const [adding, setAdding] = useState(false);
  const [sendingToMe, setSendingToMe] = useState(false);
  const [sentToSelf, setSentToSelf] = useState(false);

  // Dictation appends to whatever was typed before the mic started.
  const { transcript, interimTranscript, isListening, startListening, stopListening, clearTranscript, error: voiceError } = useVoiceInput();
  const typedPrefixRef = useRef('');
  useEffect(() => {
    if (isListening) typedPrefixRef.current = extra;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]);
  useEffect(() => {
    if (!transcript && !interimTranscript) return;
    const live = interimTranscript ? `${transcript} ${interimTranscript}`.trim() : transcript;
    const prefix = typedPrefixRef.current;
    const sep = prefix && !prefix.endsWith(' ') && !prefix.endsWith('\n') ? ' ' : '';
    setExtra(prefix ? `${prefix}${sep}${live}` : live);
  }, [transcript, interimTranscript]);
  useEffect(() => {
    if (!open && isListening) stopListening();
  }, [open, isListening, stopListening]);
  const toggleMic = () => {
    if (isListening) {
      stopListening();
    } else {
      clearTranscript();
      startListening();
    }
  };

  useEffect(() => {
    if (!open) return;
    setRange(weekRange(defaultWeeksAgo));
    setDraft(null);
    setError('');
    setSentTo(null);
    setExtraEmail('');
    setExtra('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, marketerId, storeId]);

  const thisWeek = weekRange(0);
  const lastWeek = weekRange(1);
  const onThisWeek = range.from === thisWeek.from && range.to === thisWeek.to;
  const onLastWeek = range.from === lastWeek.from && range.to === lastWeek.to;

  const write = async () => {
    if (isListening) stopListening();
    setLoading(true);
    setError('');
    setSentTo(null);
    try {
      const result = await api.post<Draft>('/weekly-highlights', {
        action: 'draft', storeId, marketerId, from: range.from, to: range.to, extra,
      });
      setDraft(result);
      setSubject(result.subject);
      setBody(result.empty ? '' : toBody(result.intro, result.bullets));
      // The details are in the email now; clear them so "Add to email" only adds new ones.
      if (!result.empty) setExtra('');
      // Keep anyone already picked; otherwise start with the admins (the owners).
      setSelected((prev) => (prev.length ? prev : result.recipients.filter((r) => r.admin).map((r) => r.email)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write the highlights');
    } finally {
      setLoading(false);
    }
  };

  /** Works the typed or dictated details into the email that's already written. */
  const addDetails = async () => {
    if (isListening) stopListening();
    setAdding(true);
    setError('');
    try {
      const result = await api.post<{ intro: string; bullets: string[] }>('/weekly-highlights', {
        action: 'add', storeId, marketerId, extra, currentBody: body,
      });
      setBody(toBody(result.intro, result.bullets));
      setExtra('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add those details');
    } finally {
      setAdding(false);
    }
  };

  const fullText = useMemo(
    () => (includeStats && draft?.statsLine ? `${body.trim()}\n\nThis week: ${draft.statsLine}` : body.trim()),
    [body, includeStats, draft],
  );

  const toggle = (email: string) =>
    setSelected((prev) => (prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]));

  const addExtra = () => {
    const emails = extraEmail.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
    const bad = emails.find((e) => !EMAIL_RE.test(e));
    if (bad) {
      setError(`"${bad}" is not an email address`);
      return;
    }
    setError('');
    setSelected((prev) => [...new Set([...prev, ...emails])]);
    setExtraEmail('');
  };

  const copy = async () => {
    await navigator.clipboard.writeText(`${subject}\n\n${fullText}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const send = async (toSelf = false) => {
    const pending = extraEmail.trim();
    const to = pending && EMAIL_RE.test(pending) ? [...new Set([...selected, pending])] : selected;
    if (!toSelf && to.length === 0) {
      setError('Pick at least one person to send it to, or send it to yourself');
      return;
    }
    const setBusy = toSelf ? setSendingToMe : setSending;
    setBusy(true);
    setError('');
    try {
      const result = await api.post<{ to: string[]; cc: string[] }>('/weekly-highlights', {
        action: 'send', storeId, marketerId, subject, body: fullText, to: toSelf ? [] : to, toSelf,
      });
      setSentTo(result.to);
      setSentToSelf(toSelf);
      if (!toSelf) setExtraEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The email did not send');
    } finally {
      setBusy(false);
    }
  };

  const recipientChips = [
    ...(draft?.recipients || []),
    ...selected.filter((e) => !draft?.recipients.some((r) => r.email === e)).map((email) => ({ email, name: email, admin: false })),
  ];
  const forSomeoneElse = !!marketerId && !!marketerName;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SparkleIcon sx={{ color: '#d4a017' }} />
        Weekly highlights{forSomeoneElse ? ` for ${marketerName}` : ''}
      </DialogTitle>
      <DialogContent dividers>
        <OnlineOnlyNotice feature="Weekly highlights" message="Writing and sending highlights needs service." />

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Writes the highlights email from {forSomeoneElse ? 'their' : 'your'} visits, notes, and calendar for the week. Edit anything before sending.
        </Typography>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
          <Chip label="This week" color={onThisWeek ? 'primary' : 'default'} onClick={() => setRange(thisWeek)} />
          <Chip label="Last week" color={onLastWeek ? 'primary' : 'default'} onClick={() => setRange(lastWeek)} />
          <TextField
            type="date" size="small" label="From" value={range.from}
            onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))}
            InputLabelProps={{ shrink: true }} sx={{ flex: '1 1 140px', maxWidth: 180 }}
          />
          <TextField
            type="date" size="small" label="To" value={range.to}
            onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
            InputLabelProps={{ shrink: true }} sx={{ flex: '1 1 140px', maxWidth: 180 }}
          />
        </Box>

        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2">Add additional details</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Anything you didn't log as a visit: a call, an event, a win, something you learned. Type or dictate it; AI works it into the email.
          </Typography>
          <TextField
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="e.g. Got added to the vendor list for two funeral homes. The real estate group wants 5 cakes next week."
            fullWidth
            multiline
            minRows={3}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end" sx={{ alignSelf: 'flex-start', mt: 1 }}>
                  <Tooltip title={isListening ? 'Stop dictation' : 'Dictate'}>
                    <span>
                      <IconButton
                        onClick={toggleMic}
                        disabled={!isOnline}
                        aria-label={isListening ? 'Stop dictation' : 'Start dictation'}
                        sx={{
                          bgcolor: isListening ? '#e74c3c' : 'rgba(245, 200, 66, 0.2)',
                          color: isListening ? '#fff' : '#2d2d2d',
                          '&:hover': { bgcolor: isListening ? '#c0392b' : 'rgba(245, 200, 66, 0.35)' },
                        }}
                      >
                        {isListening ? <MicOffIcon /> : <MicIcon />}
                      </IconButton>
                    </span>
                  </Tooltip>
                </InputAdornment>
              ),
            }}
          />
          {voiceError && <Typography variant="caption" color="error">{voiceError}</Typography>}
          {draft && (
            <Button
              sx={{ mt: 1 }}
              variant="contained"
              size="small"
              onClick={addDetails}
              disabled={adding || !extra.trim() || !isOnline}
              startIcon={adding ? <CircularProgress size={16} color="inherit" /> : <AddDetailsIcon />}
            >
              {adding ? 'Adding…' : 'Add to email'}
            </Button>
          )}
        </Box>

        <Button
          variant={draft ? 'outlined' : 'contained'}
          onClick={write}
          disabled={loading || !isOnline}
          startIcon={loading ? <CircularProgress size={16} /> : <SparkleIcon />}
          fullWidth={fullScreen}
        >
          {loading ? 'Reading the week…' : draft ? 'Rewrite' : 'Write my highlights'}
        </Button>

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

        {draft?.empty && (
          <Alert severity="info" sx={{ mt: 2 }}>
            No visits or calendar items were logged for these dates. Pick another week, or write it yourself below.
          </Alert>
        )}

        {draft && (
          <Box sx={{ mt: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} fullWidth size="small" />
            <TextField
              label="Message"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              fullWidth
              multiline
              minRows={8}
              helperText='Lines starting with "-" become bullet points.'
            />
            {draft.statsLine && (
              <FormControlLabel
                control={<Checkbox checked={includeStats} onChange={(e) => setIncludeStats(e.target.checked)} />}
                label={<Typography variant="body2">Add the numbers: <b>{draft.statsLine}</b></Typography>}
              />
            )}

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Send to</Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                {recipientChips.map((r) => (
                  <Chip
                    key={r.email}
                    label={r.name === r.email ? r.email : `${r.name}`}
                    title={r.email}
                    color={selected.includes(r.email) ? 'primary' : 'default'}
                    variant={selected.includes(r.email) ? 'filled' : 'outlined'}
                    onClick={() => toggle(r.email)}
                    icon={selected.includes(r.email) ? <CheckIcon /> : undefined}
                  />
                ))}
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  placeholder="Add an email"
                  value={extraEmail}
                  onChange={(e) => setExtraEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExtra(); } }}
                  fullWidth
                />
                <Button onClick={addExtra} disabled={!extraEmail.trim()}>Add</Button>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                You get a copy, and replies go straight to you.
              </Typography>
            </Box>
          </Box>
        )}
      </DialogContent>
      {sentTo && (
        <Alert severity="success" sx={{ mx: 3, mt: 1.5 }}>
          {sentToSelf ? `Sent to you (${sentTo.join(', ')}).` : `Sent to ${sentTo.join(', ')}. You got a copy.`}
        </Alert>
      )}
      <DialogActions
        sx={{
          px: { xs: 2, sm: 3 },
          py: 1.5,
          flexWrap: 'wrap',
          gap: 1,
          '& > :not(style) ~ :not(style)': { ml: 0 },
          '& .MuiButton-root': { whiteSpace: 'nowrap' },
        }}
      >
        <Button onClick={onClose}>{sentTo ? 'Done' : 'Close'}</Button>
        {draft && (
          <>
            <Button startIcon={copied ? <CheckIcon /> : <CopyIcon />} onClick={copy} disabled={!body.trim()}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              startIcon={sendingToMe ? <CircularProgress size={16} color="inherit" /> : <MeIcon />}
              onClick={() => send(true)}
              disabled={sending || sendingToMe || !isOnline || !body.trim() || !subject.trim()}
            >
              {sendingToMe ? 'Sending…' : 'Send to me'}
            </Button>
            <Button
              variant="contained"
              startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
              onClick={() => send()}
              disabled={sending || sendingToMe || !isOnline || !body.trim() || !subject.trim()}
            >
              {sending ? 'Sending…' : sentTo && !sentToSelf ? 'Send again' : 'Send email'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
