import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { useDonation } from '../contexts/DonationContext';
import { useOffline } from '../contexts/OfflineContext';
import { useTheme } from '@mui/material/styles';
import { useMediaQuery } from '@mui/material';
import { Business, Contact, DonationData } from '../types';
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
  getQuarterProgress,
  getProgressColor,
} from '../utils/donationCalculations';
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
  InputLabel,
  Select,
  MenuItem,
  LinearProgress,
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
  keyframes,
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

const shimmer = keyframes`
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
`;

export function Donations() {
  const { permissions, currentOrg, isOrgAdminFn } = usePermissions();
  const { triggerRefresh, setLastDonationMouths, dataVersion, bumpDataVersion } = useDonation();
  const { syncedCount } = useOffline();
  const { products, storeGoal } = useCampaign();
  const [loading, setLoading] = useState(true);
  const [donations, setDonations] = useState<DonationRow[]>([]);
  const [filteredDonations, setFilteredDonations] = useState<DonationRow[]>([]);
  const [, setBusinesses] = useState<Map<string, string>>(new Map());
  const [searchTerm, setSearchTerm] = useState('');
  const [filterFollowedUp, setFilterFollowedUp] = useState<'all' | 'yes' | 'no'>('all');
  const [filterOrdered, setFilterOrdered] = useState<'all' | 'yes' | 'no'>('all');
  const [progress, setProgress] = useState({ totalMouths: 0, goal: storeGoal, percentage: 0 });

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
  }, [permissions.currentStoreId, dataVersion, syncedCount]);

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
      filtered = filtered.filter(d => 
        filterFollowedUp === 'yes' ? d.reachout.donation?.followedUp : !d.reachout.donation?.followedUp
      );
    }

    if (filterOrdered !== 'all') {
      filtered = filtered.filter(d => 
        filterOrdered === 'yes' ? d.reachout.donation?.orderedFromUs : !d.reachout.donation?.orderedFromUs
      );
    }

    setFilteredDonations(filtered);
  }, [donations, searchTerm, filterFollowedUp, filterOrdered]);

  const loadDonations = async () => {
    try {
      if (!permissions.currentStoreId) {
        setDonations([]);
        setBusinesses(new Map());
        return;
      }
      const storeId = permissions.currentStoreId;

      const [businessList, contactsList] = await Promise.all([
        api.get<Business[]>(`/businesses?storeId=${storeId}`),
        api.get<Contact[]>(`/contacts?storeId=${storeId}`),
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

      const donationsWithData = getReachoutsWithDonations(contacts, {
        quarterDate: new Date(),
      }, products);

      const donationRows: DonationRow[] = donationsWithData.map(d => {
        const business = businessMap.get(d.contact.businessId);
        return {
          ...d,
          businessName: business?.name || d.contact.businessId,
          businessAddress: business?.address || '',
        };
      });

      setDonations(donationRows);

      if (storeId) {
        const progressData = getQuarterProgress(contacts, new Date(), products, storeGoal);
        setProgress(progressData);
      }
    } catch (error) {
      console.error('Error loading donations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFollowedUp = async (row: DonationRow) => {
    if (!row.reachout.donation) return;

    haptics.tap();
    try {
      const updatedReachouts = row.contact.reachouts.map(r => {
        if (r.id === row.reachout.id && r.donation) {
          return {
            ...r,
            donation: {
              ...r.donation,
              followedUp: !r.donation.followedUp,
            },
          };
        }
        return r;
      });

      await api.queuePatch(`/contacts/${row.contact.id}`, {
        reachouts: updatedReachouts,
      }, { label: 'Toggle followed-up' });

      bumpDataVersion();
      loadDonations();
    } catch (error) {
      console.error('Error updating followed up status:', error);
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
      const quarterLabel = getCurrentQuarterLabel();
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

  const goalReached = progress.percentage >= 100;
  const progressColor = getProgressColor(Math.min(progress.percentage, 100));
  const colorMap = {
    success: '#f5c842',
    warning: '#e8b923',
    error: '#f44336',
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
      <PullToRefreshIndicator
        pullDistance={pullState.pullDistance}
        refreshing={pullState.refreshing}
        willTrigger={pullState.willTrigger}
      />
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
        <CakeIcon /> Donations
      </Typography>

      {/* Progress Card */}
      <Card sx={{
        mb: 3,
        bgcolor: goalReached ? 'rgba(255, 215, 0, 0.15)' : 'rgba(245, 200, 66, 0.2)',
        border: goalReached ? '1px solid rgba(255, 215, 0, 0.6)' : '1px solid rgba(245, 200, 66, 0.5)',
        color: '#2d2d2d',
        ...(goalReached && { boxShadow: '0 0 12px rgba(255, 215, 0, 0.3)' }),
      }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h6">{getCurrentQuarterLabel()} Bundtini Goal</Typography>
              {goalReached && (
                <Typography component="span" sx={{ fontSize: '1.2rem' }}>🎉</Typography>
              )}
            </Box>
            <Chip
              label={`${progress.percentage.toFixed(1)}%`}
              sx={{ bgcolor: goalReached ? '#FFD700' : colorMap[progressColor], color: '#2d2d2d', fontWeight: 600 }}
            />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              {progress.totalMouths.toLocaleString()}
            </Typography>
            <Typography variant="h6" sx={{ opacity: 0.8 }}>
              / {progress.goal.toLocaleString()} mouths
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={Math.min(progress.percentage, 100)}
            sx={{
              mt: 2,
              height: 10,
              borderRadius: 5,
              bgcolor: 'rgba(0,0,0,0.1)',
              '& .MuiLinearProgress-bar': {
                borderRadius: 5,
                ...(goalReached ? {
                  background: 'linear-gradient(90deg, #FFD700 0%, #FFF8DC 25%, #FFD700 50%, #DAA520 75%, #FFD700 100%)',
                  backgroundSize: '200% 100%',
                  animation: `${shimmer} 3s linear infinite`,
                } : {
                  bgcolor: colorMap[progressColor],
                }),
              },
            }}
          />
        </CardContent>
      </Card>

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
            <FormControl size="small" sx={{ minWidth: 140, flex: { xs: 1, sm: 'unset' } }}>
              <InputLabel>Followed Up</InputLabel>
              <Select
                value={filterFollowedUp}
                label="Followed Up"
                onChange={(e) => setFilterFollowedUp(e.target.value as any)}
              >
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="yes">Yes</MenuItem>
                <MenuItem value="no">No</MenuItem>
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
              <TableCell align="center">Followed Up</TableCell>
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
                    <Tooltip title="Toggle followed up">
                      <Checkbox
                        checked={row.reachout.donation?.followedUp || false}
                        onChange={() => handleToggleFollowedUp(row)}
                        icon={<CancelIcon color="disabled" />}
                        checkedIcon={<CheckCircleIcon color="success" />}
                      />
                    </Tooltip>
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
            const followedUp = row.reachout.donation?.followedUp || false;
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
                    <Chip
                      icon={followedUp ? <CheckCircleIcon /> : <CancelIcon />}
                      label={followedUp ? 'Followed up' : 'Not followed up'}
                      size="small"
                      clickable
                      onClick={() => handleToggleFollowedUp(row)}
                      sx={{
                        bgcolor: followedUp ? 'rgba(46, 204, 113, 0.15)' : 'rgba(0,0,0,0.05)',
                        color: followedUp ? '#27ae60' : 'rgba(0,0,0,0.6)',
                        fontWeight: 600,
                        '& .MuiChip-icon': { color: 'inherit' },
                      }}
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
