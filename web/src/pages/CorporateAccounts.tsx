import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  InputAdornment,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { Business, Contact } from '../types';
import { PhoneLink } from '../components/PhoneLink';
import { knownOrganizationTypes } from '../utils/organizationTypes';

function contactName(contact: Contact): string {
  const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
  return name || 'Unnamed contact';
}

function companyNames(contact: Contact, businesses: Map<string, string>): string {
  const ids = contact.businessIds?.length ? contact.businessIds : [contact.businessId];
  return [...new Set(ids)].map((id) => businesses.get(id) || 'Unknown company').join(', ');
}

function touchedAt(contact: Contact): Date {
  const value = contact.updatedAt || contact.lastReachoutDate || contact.createdAt;
  return value instanceof Date ? value : new Date(value);
}

function formatDay(value: Date): string {
  if (Number.isNaN(value.getTime())) return '';
  return value.toLocaleDateString();
}

export function CorporateAccounts() {
  const navigate = useNavigate();
  const { permissions } = usePermissions();
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [businesses, setBusinesses] = useState<Map<string, string>>(new Map());
  const [search, setSearch] = useState('');
  const [orgType, setOrgType] = useState('');
  const [status, setStatus] = useState('');
  const [modifiedFrom, setModifiedFrom] = useState('');
  const [modifiedTo, setModifiedTo] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!permissions.currentStoreId) {
        setContacts([]);
        setBusinesses(new Map());
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [contactList, businessList] = await Promise.all([
          api.get<Contact[]>(`/contacts?storeId=${permissions.currentStoreId}`),
          api.get<Business[]>(`/businesses?storeId=${permissions.currentStoreId}`),
        ]);
        if (cancelled) return;
        const names = new Map<string, string>();
        businessList.forEach((business) => names.set(business.id, business.name));
        setBusinesses(names);
        setContacts(contactList.filter((contact) => contact.isCorporateAccount));
      } catch (error) {
        console.error('Error loading corporate accounts:', error);
        if (!cancelled) {
          setContacts([]);
          setBusinesses(new Map());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [permissions.currentStoreId]);

  const typeOptions = useMemo(() => {
    const extras = contacts
      .map((contact) => contact.organizationType?.trim())
      .filter((type): type is string => !!type);
    return [...new Set([...knownOrganizationTypes(), ...extras])].sort((a, b) => a.localeCompare(b));
  }, [contacts]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contacts
      .filter((contact) => {
        const company = companyNames(contact, businesses);
        if (orgType && (contact.organizationType || '') !== orgType) return false;
        if (status && (contact.corporateStatus || 'active') !== status) return false;
        const modified = touchedAt(contact);
        if (modifiedFrom) {
          const start = new Date(`${modifiedFrom}T00:00:00`);
          if (modified < start) return false;
        }
        if (modifiedTo) {
          const end = new Date(`${modifiedTo}T23:59:59`);
          if (modified > end) return false;
        }
        if (!term) return true;
        const haystack = [
          contactName(contact),
          company,
          contact.organizationType,
          contact.email,
          contact.phone,
          contact.taxExemptNumber,
          contact.cardOnFileLast4,
          contact.corporateStatus,
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => companyNames(a, businesses).localeCompare(companyNames(b, businesses))
        || contactName(a).localeCompare(contactName(b)));
  }, [contacts, businesses, search, orgType, status, modifiedFrom, modifiedTo]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>Corporate Accounts</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Each contact with a corporate account is its own row. Two people at the same company show up twice.
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Search contact, company, phone, email, or tax exempt #"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={{ flex: '1 1 240px', minWidth: 0 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
          />
          <TextField
            select
            size="small"
            label="Organization type"
            value={orgType}
            onChange={(event) => setOrgType(event.target.value)}
            sx={{ minWidth: 200, flex: '1 1 180px' }}
          >
            <MenuItem value="">Any type</MenuItem>
            {typeOptions.map((type) => (
              <MenuItem key={type} value={type}>{type}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="">Any status</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
          </TextField>
          <TextField
            type="date"
            size="small"
            label="Modified from"
            value={modifiedFrom}
            onChange={(event) => setModifiedFrom(event.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 160 }}
          />
          <TextField
            type="date"
            size="small"
            label="Modified to"
            value={modifiedTo}
            onChange={(event) => setModifiedTo(event.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 160 }}
          />
          <Chip label={`${rows.length} account${rows.length === 1 ? '' : 's'}`} variant="outlined" />
        </Box>
      </Paper>

      {rows.length === 0 ? (
        <Alert severity="info">
          {contacts.length === 0
            ? 'No corporate accounts yet. Open a contact and turn on Corporate account.'
            : 'No corporate accounts match these filters.'}
        </Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell>Contact</TableCell>
                <TableCell>Company</TableCell>
                <TableCell>Organization type</TableCell>
                <TableCell>Phone</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Tax exempt #</TableCell>
                <TableCell>Card on file</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Modified</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((contact) => {
                const accountStatus = contact.corporateStatus === 'inactive' ? 'Inactive' : 'Active';
                return (
                  <TableRow
                    key={contact.id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/dashboard?contact=${contact.id}`)}
                  >
                    <TableCell>{contactName(contact)}</TableCell>
                    <TableCell>{companyNames(contact, businesses)}</TableCell>
                    <TableCell>{contact.organizationType || '—'}</TableCell>
                    <TableCell>
                      {contact.phone ? <PhoneLink phone={contact.phone} stopPropagation /> : '—'}
                    </TableCell>
                    <TableCell>{contact.email || '—'}</TableCell>
                    <TableCell>{contact.taxExemptNumber || '—'}</TableCell>
                    <TableCell>{contact.cardOnFileLast4 ? `•••• ${contact.cardOnFileLast4}` : '—'}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={accountStatus}
                        color={accountStatus === 'Active' ? 'success' : 'default'}
                      />
                    </TableCell>
                    <TableCell>{formatDay(touchedAt(contact))}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
