import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { useDonation } from '../contexts/DonationContext';
import { useOffline } from '../contexts/OfflineContext';
import { useTheme } from '@mui/material/styles';
import { useMediaQuery } from '@mui/material';
import { Business, CampaignProduct, Contact, DonationData, SLUG_TO_FIELD } from '../types';
import {
  buildDonationExportSheet,
  formatBusinessAddress,
  getDonationExportFilename,
  getDonationExportSheetName,
  getOrgDonationExportFilename,
  getDonationExportProducts,
  type DonationExportRow,
} from '../utils/donationExport';
import { PullToRefreshIndicator } from '../components/PullToRefreshIndicator';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { haptics } from '../utils/haptics';
import {
  getReachoutsWithDonations,
  calculateMouths,
  getCurrentQuarterLabel,
} from '../utils/donationCalculations';
import { toDate } from '../utils/reportAggregations';
import { useCampaign } from '../contexts/CampaignContext';
import { DonationProductFields } from '../components/DonationProductFields';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  TextField,
  InputAdornment,
  FormControl,
  FormControlLabel,
  InputLabel,
  Select,
  MenuItem,
  Card,
  CardContent,
  IconButton,
  Tooltip,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Alert,
} from '@mui/material';
import {
  Search as SearchIcon,
  Cake as CakeIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Edit as EditIcon,
  Close as CloseIcon,
  FileDownload as FileDownloadIcon,
} from '@mui/icons-material';

type DonationRow = DonationExportRow;
type FollowUpStatus = 'yes' | 'no' | 'none';

function followUpStatus(donation?: { followedUp?: boolean; noFollowUp?: boolean } | null): FollowUpStatus {
  if (donation?.noFollowUp) return 'none';
  if (donation?.followedUp) return 'yes';
  return 'no';
}

function FollowUpSelect({
  value,
  onChange,
}: {
  value: FollowUpStatus;
  onChange: (value: FollowUpStatus) => void;
}) {
  return (
    <Select
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value as FollowUpStatus)}
      sx={{ minWidth: 168 }}
    >
      <MenuItem value="no">Needs follow-up</MenuItem>
      <MenuItem value="yes">Followed up</MenuItem>
      <MenuItem value="none">No follow-up</MenuItem>
    </Select>
  );
}

function donationHasProduct(row: DonationRow, productKey: string, products: CampaignProduct[]): boolean {
  const donation = row.reachout.donation;
  if (!donation) return false;
  const product = products.find((p) => p.slug === productKey || p.id === productKey);
  if (!product) return false;
  const field = SLUG_TO_FIELD[product.slug];
  const qty = field
    ? ((donation[field] as number) || 0)
    : donation.customItems?.[product.id] || 0;
  return qty > 0;
}

export function Donations() {
  const { permissions, currentOrg, isOrgAdminFn } = usePermissions();
  const { triggerRefresh, setLastDonationMouths, dataVersion, bumpDataVersion } = useDonation();
  const { syncedCount } = useOffline();
  const { products } = useCampaign();
  const [searchParams, setSearchParams] = useSearchParams();
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const productParam = searchParams.get('product');
  const businessParam = searchParams.get('business');
  const rangeAll = searchParams.get('range') === 'all';
  const storesParam = searchParams.get('stores');
  const [loading, setLoading] = useState(true);
  const [donations, setDonations] = useState<DonationRow[]>([]);
  const [filteredDonations, setFilteredDonations] = useState<DonationRow[]>([]);
  const [businesses, setBusinesses] = useState<Map<string, string>>(new Map());
  const [searchTerm, setSearchTerm] = useState('');
  const [filterFollowedUp, setFilterFollowedUp] = useState<'all' | FollowUpStatus>('all');
  const [filterOrdered, setFilterOrdered] = useState<'all' | 'yes' | 'no'>('all');

  // Edit modal state
  const [editingDonation, setEditingDonation] = useState<DonationRow | null>(null);
  const [editDonationData, setEditDonationData] = useState<DonationData | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const pullState = usePullToRefresh({
    onRefresh: () => loadDonations(),
    enabled: isMobile,
  });

  useEffect(() => {
    loadDonations();
    // syncedCount makes offline-queued donations appear the moment the queue
    // drains, even if the user never leaves this page.
  }, [permissions.currentStoreId, currentOrg?.id, storesParam, dataVersion, syncedCount, fromParam, toParam, rangeAll]);

  useEffect(() => {
    let filtered = donations;

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(d => {
        const contactName = `${d.contact.firstName || ''} ${d.contact.lastName || ''}`.toLowerCase();
        return (
          contactName.includes(term) ||
          d.businessName.toLowerCase().includes(term) ||
          (d.contact.email?.toLowerCase() || '').includes(term) ||
          (d.contact.phone?.toLowerCase() || '').includes(term)
        );
      });
    }

    if (filterFollowedUp !== 'all') {
      filtered = filtered.filter(d => followUpStatus(d.reachout.donation) === filterFollowedUp);
    }

    if (filterOrdered !== 'all') {
      filtered = filtered.filter(d => 
        filterOrdered === 'yes' ? d.reachout.donation?.orderedFromUs : !d.reachout.donation?.orderedFromUs
      );
    }

    if (productParam) {
      filtered = filtered.filter((d) => donationHasProduct(d, productParam, products));
    }

    if (businessParam) {
      filtered = filtered.filter((d) => d.contact.businessId === businessParam);
    }

    setFilteredDonations(filtered);
  }, [donations, searchTerm, filterFollowedUp, filterOrdered, productParam, businessParam, products]);

  const loadDonations = async () => {
    try {
      if (!permissions.currentStoreId && storesParam !== 'all') {
        setDonations([]);
        setBusinesses(new Map());
        return;
      }
      const scopeQuery = storesParam === 'all'
        ? (currentOrg?.id ? `orgId=${encodeURIComponent(currentOrg.id)}` : 'allStores=1')
        : storesParam
          ? `storeId=${encodeURIComponent(storesParam)}`
          : `storeId=${permissions.currentStoreId}`;

      const [businessList, contactsList] = await Promise.all([
        api.get<Business[]>(`/businesses?${scopeQuery}`),
        api.get<Contact[]>(`/contacts?${scopeQuery}`),
      ]);

      const businessMap = new Map<string, { name: string; address: string }>();
      businessList.forEach((b) =>
        businessMap.set(b.id, { name: b.name, address: formatBusinessAddress(b) }),
      );
      setBusinesses(new Map([...businessMap.entries()].map(([id, b]) => [id, b.name])));

      const contacts: Contact[] = contactsList.map((c) => ({
        ...c,
        reachouts: (c.reachouts || []).map((r: any) => ({
          ...r,
          date: r.date instanceof Date ? r.date : new Date(r.date),
        })),
        createdAt: c.createdAt instanceof Date ? c.createdAt : new Date(c.createdAt),
      }));

      const donationsWithData = getReachoutsWithDonations(
        contacts,
        rangeAll || fromParam || toParam ? undefined : { quarterDate: new Date() },
        products,
      );

      const donationRows: DonationRow[] = donationsWithData.map(d => {
        const business = businessMap.get(d.contact.businessId);
        return {
          ...d,
          businessName: business?.name || d.contact.businessId,
          businessAddress: business?.address || '',
        };
      }).filter((row) => {
        if (!fromParam && !toParam) return true;
        const date = toDate(row.reachout.date);
        if (!date) return false;
        if (fromParam) {
          const start = new Date(`${fromParam}T00:00:00`);
          if (date < start) return false;
        }
        if (toParam) {
          const end = new Date(`${toParam}T23:59:59`);
          if (date > end) return false;
        }
        return true;
      });

      setDonations(donationRows);
    } catch (error) {
      console.error('Error loading donations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSetFollowUp = async (row: DonationRow, status: FollowUpStatus) => {
    if (!row.reachout.donation) return;
    if (followUpStatus(row.reachout.donation) === status) return;

    haptics.tap();
    try {
      const updatedReachouts = row.contact.reachouts.map(r => {
        if (r.id === row.reachout.id && r.donation) {
          return {
            ...r,
            donation: {
              ...r.donation,
              followedUp: status === 'yes',
              noFollowUp: status === 'none',
            },
          };
        }
        return r;
      });

      await api.queuePatch(`/contacts/${row.contact.id}`, {
        reachouts: updatedReachouts,
      }, { label: status === 'none' ? 'Mark no follow-up' : 'Update follow-up' });

      bumpDataVersion();
      loadDonations();
    } catch (error) {
      console.error('Error updating follow-up status:', error);
    }
  };

  const handleToggleOrdered = async (row: DonationRow) => {
    if (!row.reachout.donation) return;

    haptics.tap();
    try {
      const updatedReachouts = row.contact.reachouts.map(r => {
        if (r.id === row.reachout.id && r.donation) {
          return {
            ...r,
            donation: {
              ...r.donation,
              orderedFromUs: !r.donation.orderedFromUs,
            },
          };
        }
        return r;
      });

      await api.queuePatch(`/contacts/${row.contact.id}`, {
        reachouts: updatedReachouts,
      }, { label: 'Toggle ordered' });

      bumpDataVersion();
      loadDonations();
    } catch (error) {
      console.error('Error updating ordered status:', error);
    }
  };

  const openEditModal = (row: DonationRow) => {
    setEditingDonation(row);
    setEditDonationData(row.reachout.donation ? { ...row.reachout.donation } : null);
    setEditError('');
  };

  const closeEditModal = () => {
    setEditingDonation(null);
    setEditDonationData(null);
    setEditError('');
  };

  const getExportProducts = () =>
    getDonationExportProducts(currentOrg?.products?.length ? currentOrg.products : products);

  const getCurrentStoreName = () =>
    currentOrg?.stores.find((store) => store.id === permissions.currentStoreId)?.name || 'store';

  const handleExportToExcel = async () => {
    // Lazy-load xlsx (~400KB) only when the user actually clicks Export
    const XLSX = await import('xlsx');
    const quarterLabel = getCurrentQuarterLabel();
    const exportProducts = getExportProducts();
    const ws = buildDonationExportSheet(XLSX, donations, exportProducts);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, getDonationExportSheetName(quarterLabel));

    XLSX.writeFile(wb, getDonationExportFilename(donations, getCurrentStoreName()));
  };

  const [orgExporting, setOrgExporting] = useState(false);

  const handleOrgExportToExcel = async () => {
    if (!currentOrg) return;
    setOrgExporting(true);

    try {
      const XLSX = await import('xlsx');
      const exportProducts = getExportProducts();
      const wb = XLSX.utils.book_new();
      const allRows: DonationRow[] = [];

      for (const store of currentOrg.stores) {
        const [businessList, contactsList] = await Promise.all([
          api.get<Business[]>(`/businesses?storeId=${store.id}`),
          api.get<Contact[]>(`/contacts?storeId=${store.id}`),
        ]);

        const businessMap = new Map<string, { name: string; address: string }>();
        businessList.forEach((b) =>
          businessMap.set(b.id, { name: b.name, address: formatBusinessAddress(b) }),
        );

        const contacts: Contact[] = contactsList.map((c) => ({
          ...c,
          reachouts: (c.reachouts || []).map((r: any) => ({
            ...r,
            date: r.date instanceof Date ? r.date : new Date(r.date),
          })),
          createdAt: c.createdAt instanceof Date ? c.createdAt : new Date(c.createdAt),
        }));

        const donationsWithData = getReachoutsWithDonations(contacts, {
          quarterDate: new Date(),
        }, products);

        const rows: DonationRow[] = donationsWithData.map(d => {
          const business = businessMap.get(d.contact.businessId);
          return {
            ...d,
            businessName: business?.name || d.contact.businessId,
            businessAddress: business?.address || '',
          };
        });

        const ws = buildDonationExportSheet(XLSX, rows, exportProducts);
        const sheetName = store.name.slice(0, 31).replace(/[\\/*?[\]:]/g, '');
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        allRows.push(...rows);
      }

      XLSX.writeFile(wb, getOrgDonationExportFilename(allRows));
    } catch (error) {
      console.error('Error exporting org donations:', error);
    } finally {
      setOrgExporting(false);
    }
  };

  const handleEditSave = async () => {
    if (!editingDonation || !editDonationData) return;

    setEditLoading(true);
    setEditError('');

    try {
      const updatedReachouts = editingDonation.contact.reachouts.map(r => {
        if (r.id === editingDonation.reachout.id) {
          return {
            ...r,
            donation: editDonationData,
          };
        }
        return r;
      });

      await api.queuePatch(`/contacts/${editingDonation.contact.id}`, {
        reachouts: updatedReachouts,
      }, { label: 'Edit donation' });

      // Calculate the difference in mouths and trigger refresh
      const oldMouths = editingDonation.reachout.donation ? calculateMouths(editingDonation.reachout.donation, products) : 0;
      const newMouths = calculateMouths(editDonationData, products);
      const difference = newMouths - oldMouths;
      if (difference > 0) {
        setLastDonationMouths(difference);
        triggerRefresh();
      } else if (difference !== 0) {
        // Still refresh if decreased, but without celebration
        setLastDonationMouths(0);
        triggerRefresh();
      }

      bumpDataVersion();
      haptics.success();
      closeEditModal();
      loadDonations();
    } catch (err: any) {
      setEditError(err.message || 'Failed to update donation');
      haptics.error();
    } finally {
      setEditLoading(false);
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const storesFilterLabel = storesParam === 'all'
    ? (currentOrg?.name ? `All stores in ${currentOrg.name}` : 'All stores')
    : storesParam
      ? currentOrg?.stores.find((store) => store.id === storesParam)?.name || null
      : null;

  const clearReportFilter = (key: 'from' | 'to' | 'product' | 'business' | 'range' | 'stores') => {
    const next = new URLSearchParams(searchParams);
    next.delete(key);
    if (key === 'from' || key === 'to' || key === 'range') {
      next.delete('from');
      next.delete('to');
      next.delete('range');
    }
    if (key === 'stores') next.delete('stores');
    setSearchParams(next, { replace: true });
  };

  const productFilterLabel = productParam
    ? products.find((p) => p.slug === productParam || p.id === productParam)?.name || productParam
    : null;
  const businessFilterLabel = businessParam ? businesses.get(businessParam) : null;
  const dateFilterLabel = rangeAll
    ? 'All time'
    : fromParam || toParam
      ? [fromParam, toParam].filter(Boolean).join(' – ')
      : null;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <CircularProgress />
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
      <Typography variant="h4" sx={{ mb: (dateFilterLabel || productFilterLabel || businessFilterLabel || storesFilterLabel) ? 1.5 : 3, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
        <CakeIcon /> Donations
      </Typography>
      {(dateFilterLabel || productFilterLabel || businessFilterLabel || storesFilterLabel) && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          {storesFilterLabel && (
            <Chip
              label={storesFilterLabel}
              onDelete={() => clearReportFilter('stores')}
              sx={{ bgcolor: 'rgba(245, 200, 66, 0.18)', fontWeight: 600 }}
            />
          )}
          {dateFilterLabel && (
            <Chip
              label={dateFilterLabel}
              onDelete={() => clearReportFilter('from')}
              sx={{ bgcolor: 'rgba(245, 200, 66, 0.18)', fontWeight: 600 }}
            />
          )}
          {productFilterLabel && (
            <Chip
              label={productFilterLabel}
              onDelete={() => clearReportFilter('product')}
              sx={{ bgcolor: 'rgba(245, 200, 66, 0.18)', fontWeight: 600 }}
            />
          )}
          {businessFilterLabel && (
            <Chip
              label={businessFilterLabel}
              onDelete={() => clearReportFilter('business')}
              sx={{ bgcolor: 'rgba(245, 200, 66, 0.18)', fontWeight: 600 }}
            />
          )}
        </Box>
      )}

      {/* Filters */}
      <Paper sx={{ p: { xs: 1.5, sm: 2 }, mb: 3 }}>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 1.25, sm: 2 }, flexWrap: 'wrap', alignItems: { xs: 'stretch', sm: 'center' } }}>
          <TextField
            placeholder="Search contacts or businesses..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            size="small"
            sx={{ flexGrow: 1, maxWidth: { xs: '100%', sm: 400 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
          />

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 180, flex: { xs: 1, sm: 'unset' } }}>
              <InputLabel>Follow-up</InputLabel>
              <Select
                value={filterFollowedUp}
                label="Follow-up"
                onChange={(e) => setFilterFollowedUp(e.target.value as 'all' | FollowUpStatus)}
              >
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="no">Needs follow-up</MenuItem>
                <MenuItem value="yes">Followed up</MenuItem>
                <MenuItem value="none">No follow-up</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 140, flex: { xs: 1, sm: 'unset' } }}>
              <InputLabel>Ordered</InputLabel>
              <Select
                value={filterOrdered}
                label="Ordered"
                onChange={(e) => setFilterOrdered(e.target.value as any)}
              >
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="yes">Yes</MenuItem>
                <MenuItem value="no">No</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip
              label={`${filteredDonations.length} donations`}
              color="primary"
              variant="outlined"
            />

            <Button
              variant="outlined"
              color="primary"
              size="small"
              startIcon={<FileDownloadIcon />}
              onClick={handleExportToExcel}
              disabled={donations.length === 0}
            >
              Export Store
            </Button>

            {currentOrg && currentOrg.stores.length > 1 && isOrgAdminFn() && (
              <Button
                variant="outlined"
                color="primary"
                size="small"
                startIcon={orgExporting ? <CircularProgress size={16} /> : <FileDownloadIcon />}
                onClick={handleOrgExportToExcel}
                disabled={orgExporting}
              >
                {orgExporting ? 'Exporting...' : 'Export All Stores'}
              </Button>
            )}
          </Box>
        </Box>
      </Paper>

      {/* Donations — desktop table */}
      <TableContainer component={Paper} sx={{ display: { xs: 'none', md: 'block' } }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.100' }}>
              <TableCell>Date</TableCell>
              <TableCell>Business</TableCell>
              <TableCell>Contact</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Email</TableCell>
              <TableCell align="center">Mouths</TableCell>
              <TableCell align="center">Follow-up</TableCell>
              <TableCell align="center">Ordered</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredDonations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    No donations found for this quarter
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredDonations.map((row, index) => (
                <TableRow key={`${row.contact.id}-${row.reachout.id}-${index}`} hover>
                  <TableCell>{formatDate(row.reachout.date)}</TableCell>
                  <TableCell>{row.businessName}</TableCell>
                  <TableCell>
                    {`${row.contact.firstName || ''} ${row.contact.lastName || ''}`.trim() || '-'}
                  </TableCell>
                  <TableCell>{row.contact.phone || '-'}</TableCell>
                  <TableCell>{row.contact.email || '-'}</TableCell>
                  <TableCell align="center">
                    <Chip label={row.mouths} size="small" color="primary" />
                  </TableCell>
                  <TableCell align="center">
                    <FollowUpSelect
                      value={followUpStatus(row.reachout.donation)}
                      onChange={(status) => handleSetFollowUp(row, status)}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="Toggle ordered from us">
                      <Checkbox
                        checked={row.reachout.donation?.orderedFromUs || false}
                        onChange={() => handleToggleOrdered(row)}
                        icon={<CancelIcon color="disabled" />}
                        checkedIcon={<CheckCircleIcon color="success" />}
                      />
                    </Tooltip>
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="Edit donation">
                      <IconButton size="small" onClick={() => openEditModal(row)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Donations — mobile card list */}
      <Box sx={{ display: { xs: 'flex', md: 'none' }, flexDirection: 'column', gap: 1.5 }}>
        {filteredDonations.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No donations found for this quarter</Typography>
          </Paper>
        ) : (
          filteredDonations.map((row, index) => {
            const contactName = `${row.contact.firstName || ''} ${row.contact.lastName || ''}`.trim() || 'Contact';
            const ordered = row.reachout.donation?.orderedFromUs || false;
            return (
              <Card
                key={`${row.contact.id}-${row.reachout.id}-${index}`}
                sx={{ border: '1px solid rgba(0,0,0,0.08)' }}
              >
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        variant="subtitle1"
                        sx={{ fontWeight: 700, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {contactName}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {row.businessName}
                      </Typography>
                    </Box>
                    <Chip
                      label={`${row.mouths} mouths`}
                      size="small"
                      sx={{ bgcolor: '#f5c842', color: '#2d2d2d', fontWeight: 700, flexShrink: 0 }}
                    />
                  </Box>

                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25 }}>
                    {formatDate(row.reachout.date)}
                    {row.reachout.donation?.cakesDonatedNotes && ` · ${row.reachout.donation.cakesDonatedNotes}`}
                  </Typography>

                  {/* Toggleable status chips */}
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.5 }}>
                    <FollowUpSelect
                      value={followUpStatus(row.reachout.donation)}
                      onChange={(status) => handleSetFollowUp(row, status)}
                    />
                    <Chip
                      icon={ordered ? <CheckCircleIcon /> : <CancelIcon />}
                      label={ordered ? 'Ordered' : 'Not ordered'}
                      size="small"
                      clickable
                      onClick={() => handleToggleOrdered(row)}
                      sx={{
                        bgcolor: ordered ? 'rgba(46, 204, 113, 0.15)' : 'rgba(0,0,0,0.05)',
                        color: ordered ? '#27ae60' : 'rgba(0,0,0,0.6)',
                        fontWeight: 600,
                        '& .MuiChip-icon': { color: 'inherit' },
                      }}
                    />
                  </Box>

                  {/* Tap-to-call / tap-to-email row */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {row.contact.phone && (
                      <Button
                        size="small"
                        component="a"
                        href={`tel:${row.contact.phone}`}
                        sx={{ textTransform: 'none', color: '#27ae60', minWidth: 0, px: 1 }}
                      >
                        Call
                      </Button>
                    )}
                    {row.contact.phone && (
                      <Button
                        size="small"
                        component="a"
                        href={`sms:${row.contact.phone}`}
                        sx={{ textTransform: 'none', color: '#2ecc71', minWidth: 0, px: 1 }}
                      >
                        Text
                      </Button>
                    )}
                    {row.contact.email && (
                      <Button
                        size="small"
                        component="a"
                        href={`mailto:${row.contact.email}`}
                        sx={{ textTransform: 'none', color: '#3498db', minWidth: 0, px: 1 }}
                      >
                        Email
                      </Button>
                    )}
                    <Box sx={{ flex: 1 }} />
                    <IconButton size="small" onClick={() => openEditModal(row)} aria-label="Edit donation">
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </CardContent>
              </Card>
            );
          })
        )}
      </Box>

      {/* Edit Donation Modal */}
      <Dialog open={!!editingDonation} onClose={closeEditModal} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">Edit Donation</Typography>
          <IconButton onClick={closeEditModal} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {editError && <Alert severity="error" sx={{ mb: 2 }}>{editError}</Alert>}
          
          {editDonationData && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Total Mouths: {calculateMouths(editDonationData, products)}
              </Typography>

              <DonationProductFields
                products={products}
                donationData={editDonationData}
                onChange={(updated) => setEditDonationData(updated)}
              />

              <TextField
                label="Donation Notes"
                size="small"
                fullWidth
                value={editDonationData.cakesDonatedNotes || ''}
                onChange={(e) => setEditDonationData(prev => prev ? { ...prev, cakesDonatedNotes: e.target.value } : null)}
                disabled={editLoading}
              />

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={editDonationData.followedUp}
                      onChange={(e) => setEditDonationData(prev => prev ? {
                        ...prev,
                        followedUp: e.target.checked,
                        noFollowUp: e.target.checked ? false : prev.noFollowUp,
                      } : null)}
                      disabled={editLoading}
                    />
                  }
                  label="Followed up"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={editDonationData.noFollowUp === true}
                      onChange={(e) => setEditDonationData(prev => prev ? {
                        ...prev,
                        noFollowUp: e.target.checked,
                        followedUp: e.target.checked ? false : prev.followedUp,
                      } : null)}
                      disabled={editLoading}
                    />
                  }
                  label="No follow-up needed"
                />
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={closeEditModal}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleEditSave}
            disabled={editLoading}
          >
            {editLoading ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
