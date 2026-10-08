import { useRef, useState, type ChangeEvent } from 'react';
import { api } from '../api/client';

interface ImportRow {
  businessName: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
  businessAlreadyOnFile: boolean;
  contactAlreadyOnFile: boolean;
}
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Close as CloseIcon, UploadFile as UploadIcon } from '@mui/icons-material';

const ROW_CAP = 200;

interface PreviewRow extends ImportRow {
  id: string;
  include: boolean;
}

interface ImportCustomersDialogProps {
  open: boolean;
  storeId: string;
  onClose: () => void;
  onImported: (summary: string) => void;
}

async function fileToText(file: File): Promise<{ text: string; truncated: boolean }> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('That file has no sheets');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][];
  const filled = rows.filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim()));
  const limited = filled.slice(0, ROW_CAP + 1);
  return {
    text: XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(limited)),
    truncated: filled.length > ROW_CAP + 1,
  };
}

function pastedToText(value: string): { text: string; truncated: boolean } {
  const lines = value.split(/\r?\n/).filter((line) => line.trim());
  return {
    text: lines.slice(0, ROW_CAP + 1).join('\n'),
    truncated: lines.length > ROW_CAP + 1,
  };
}

export function ImportCustomersDialog({ open, storeId, onClose, onImported }: ImportCustomersDialogProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pasted, setPasted] = useState('');
  const [fileName, setFileName] = useState('');
  const [spreadsheetText, setSpreadsheetText] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [emptyMessage, setEmptyMessage] = useState('');

  const reset = () => {
    setPasted('');
    setFileName('');
    setSpreadsheetText('');
    setTruncated(false);
    setRows([]);
    setReading(false);
    setSaving(false);
    setError('');
    setEmptyMessage('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setEmptyMessage('');
    setRows([]);
    try {
      const parsed = await fileToText(file);
      setFileName(file.name);
      setSpreadsheetText(parsed.text);
      setTruncated(parsed.truncated);
      setPasted('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file');
    }
  };

  const preview = async () => {
    const source = spreadsheetText.trim() || pastedToText(pasted);
    const text = typeof source === 'string' ? source : source.text;
    const wasTruncated = typeof source === 'string' ? truncated : source.truncated;
    if (!text.trim()) {
      setError('Upload a spreadsheet or paste the rows first.');
      return;
    }
    setReading(true);
    setError('');
    setEmptyMessage('');
    setTruncated(wasTruncated);
    try {
      const result = await api.post<{ rows: ImportRow[]; message?: string }>(`/import-customers?storeId=${storeId}`, {
        action: 'preview',
        spreadsheetText: text,
      });
      const next = (result.rows || []).map((row) => ({
        ...row,
        id: crypto.randomUUID(),
        include: !row.contactAlreadyOnFile,
      }));
      setRows(next);
      setEmptyMessage(next.length === 0 ? (result.message || 'Nothing in that file looked like a customer.') : '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that spreadsheet');
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    const selected = rows.filter((row) => row.include);
    if (selected.length === 0) {
      setError('Select at least one row to create.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await api.post<{ createdBusinesses: number; createdContacts: number; skipped: number }>(
        `/import-customers?storeId=${storeId}`,
        { action: 'commit', rows: selected },
      );
      const parts = [
        `${result.createdBusinesses} business${result.createdBusinesses === 1 ? '' : 'es'}`,
        `${result.createdContacts} contact${result.createdContacts === 1 ? '' : 's'}`,
      ];
      if (result.skipped) parts.push(`${result.skipped} already on file`);
      onImported(`Created ${parts.join(', ')}.`);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save these customers');
      setSaving(false);
    }
  };

  const selectedCount = rows.filter((row) => row.include).length;

  return (
    <Dialog open={open} onClose={saving ? undefined : close} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        Import customers
        <IconButton onClick={close} disabled={saving} aria-label="Close" size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Upload a spreadsheet of businesses and people. We’ll read it and show you exactly what will be created. Nothing is saved until you confirm.
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {truncated && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Only the first {ROW_CAP} rows were read. Import the rest in another pass.
          </Alert>
        )}

        {rows.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls"
              hidden
              onChange={onFile}
            />
            <Button
              variant="outlined"
              startIcon={<UploadIcon />}
              onClick={() => fileRef.current?.click()}
              disabled={reading}
              sx={{ alignSelf: 'flex-start' }}
            >
              {fileName || 'Choose a spreadsheet'}
            </Button>
            <TextField
              label="Or paste rows"
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value);
                setSpreadsheetText('');
                setFileName('');
              }}
              multiline
              minRows={6}
              fullWidth
              placeholder={'Business, Contact, Email, Phone, Address'}
              disabled={reading}
            />
            {emptyMessage && <Alert severity="warning">{emptyMessage}</Alert>}
          </Box>
        ) : (
          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {selectedCount} of {rows.length} will be created. Uncheck anything you don’t want.
            </Typography>
            <Box sx={{ overflow: 'auto', maxHeight: 420 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>Business</TableCell>
                    <TableCell>Contact</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>Phone</TableCell>
                    <TableCell>City</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const contact = [row.firstName, row.lastName].filter(Boolean).join(' ') || 'Business only';
                    return (
                      <TableRow key={row.id} hover selected={row.include}>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={row.include}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setRows((prev) => prev.map((item) => item.id === row.id ? { ...item, include: checked } : item));
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          {row.businessName}
                          {row.businessAlreadyOnFile && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              Already in this store
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          {contact}
                          {row.contactAlreadyOnFile && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              Already on file
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>{row.email}</TableCell>
                        <TableCell>{row.phone}</TableCell>
                        <TableCell>{[row.city, row.state].filter(Boolean).join(', ')}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {rows.length > 0 && (
          <Button onClick={() => { setRows([]); setEmptyMessage(''); }} disabled={saving}>
            Back
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={close} disabled={saving}>Cancel</Button>
        {rows.length === 0 ? (
          <Button
            variant="contained"
            onClick={preview}
            disabled={reading}
            startIcon={reading ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={{ bgcolor: '#f5c842', color: '#2d2d2d', fontWeight: 700, '&:hover': { bgcolor: '#e8b923' } }}
          >
            {reading ? 'Reading…' : 'Preview'}
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={save}
            disabled={saving || selectedCount === 0}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={{ bgcolor: '#f5c842', color: '#2d2d2d', fontWeight: 700, '&:hover': { bgcolor: '#e8b923' } }}
          >
            {saving ? 'Saving…' : `Create ${selectedCount}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
