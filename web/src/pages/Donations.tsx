import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { useDonation } from '../contexts/DonationContext';
import { Contact, Reachout, DonationData, CampaignProduct, SLUG_TO_FIELD } from '../types';
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
  Grid,
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

interface DonationRow {
  contact: Contact;
  reachout: Reachout;
  mouths: number;
  businessName: string;
}

const shimmer = keyframes`
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
`;

export function Donations() {
  const { permissions, currentOrg, isOrgAdminFn } = usePermissions();
  const { triggerRefresh, setLastDonationMouths } = useDonation();
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

  useEffect(() => {
    loadDonations();
  }, [permissions.currentStoreId]);

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
        api.get<Array<{ id: string; name: string }>>(`/businesses?storeId=${storeId}`),
        api.get<Contact[]>(`/contacts?storeId=${storeId}`),
      ]);

      const businessMap = new Map<string, string>();
      businessList.forEach((b) => businessMap.set(b.id, b.name));
      setBusinesses(businessMap);

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

      const donationRows: DonationRow[] = donationsWithData.map(d => ({
        ...d,
        businessName: businessMap.get(d.contact.businessId) || d.contact.businessId,
      }));

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

      await api.patch(`/contacts/${row.contact.id}`, {
        reachouts: updatedReachouts,
      });

      loadDonations();
    } catch (error) {
      console.error('Error updating followed up status:', error);
    }
  };

  const handleToggleOrdered = async (row: DonationRow) => {
    if (!row.reachout.donation) return;

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

      await api.patch(`/contacts/${row.contact.id}`, {
        reachouts: updatedReachouts,
      });

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

  const buildExportRows = (rows: DonationRow[], activeProducts: CampaignProduct[]) => {
    return rows.map((row) => {
      const donation = row.reachout.donation;
      const contactName = `${row.contact.firstName || ''} ${row.contact.lastName || ''}`.trim() || '-';

      const base: Record<string, string | number> = {
        'Date': formatDate(row.reachout.date),
        'Business Name': row.businessName,
        'Contact First Name': row.contact.firstName || '',
        'Contact Last Name': row.contact.lastName || '',
        'Contact Name': contactName,
        'Phone': row.contact.phone || '',
        'Email': row.contact.email || '',
        'Mouths': row.mouths,
      };

      for (const p of activeProducts) {
        const field = SLUG_TO_FIELD[p.slug];
        if (field && donation) {
          base[p.name] = (donation[field] as number) || 0;
        } else if (donation?.customItems) {
          base[p.name] = donation.customItems[p.id] || 0;
        } else {
          base[p.name] = 0;
        }
      }

      base['Donation Notes'] = donation?.cakesDonatedNotes || '';
      base['Followed Up'] = donation?.followedUp ? 'Yes' : 'No';
      base['Ordered From Us'] = donation?.orderedFromUs ? 'Yes' : 'No';
      base['Reachout Type'] = row.reachout.type || '';
      base['Reachout Note'] = row.reachout.note || '';

      return base;
    });
  };

  const buildSheet = (rows: Record<string, string | number>[], activeProducts: CampaignProduct[]) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    const colWidths = [
      { wch: 12 }, { wch: 25 }, { wch: 15 }, { wch: 15 },
      { wch: 20 }, { wch: 15 }, { wch: 25 }, { wch: 8 },
      ...activeProducts.map(() => ({ wch: 14 })),
      { wch: 30 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 40 },
    ];
    ws['!cols'] = colWidths;
    return ws;
  };

  const handleExportToExcel = () => {
    const activeProducts = products.filter(p => p.isActive);
    const exportData = buildExportRows(filteredDonations, activeProducts);

    const ws = buildSheet(exportData, activeProducts);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Donations');

    const quarterLabel = getCurrentQuarterLabel();
    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Donations_${quarterLabel}_${dateStr}.xlsx`);
  };

  const [orgExporting, setOrgExporting] = useState(false);

  const handleOrgExportToExcel = async () => {
    if (!currentOrg) return;
    setOrgExporting(true);

    try {
      const activeProducts = products.filter(p => p.isActive);
      const wb = XLSX.utils.book_new();

      for (const store of currentOrg.stores) {
        const [businessList, contactsList] = await Promise.all([
          api.get<Array<{ id: string; name: string }>>(`/businesses?storeId=${store.id}`),
          api.get<Contact[]>(`/contacts?storeId=${store.id}`),
        ]);

        const businessMap = new Map<string, string>();
        businessList.forEach((b) => businessMap.set(b.id, b.name));

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
        }, activeProducts);

        const rows: DonationRow[] = donationsWithData.map(d => ({
          ...d,
          businessName: businessMap.get(d.contact.businessId) || d.contact.businessId,
        }));

        const exportData = buildExportRows(rows, activeProducts);
        const ws = buildSheet(exportData, activeProducts);
        const sheetName = store.name.slice(0, 31).replace(/[\\/*?[\]:]/g, '');
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }

      const quarterLabel = getCurrentQuarterLabel();
      const dateStr = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `${currentOrg.name}_Donations_${quarterLabel}_${dateStr}.xlsx`);
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

      await api.patch(`/contacts/${editingDonation.contact.id}`, {
        reachouts: updatedReachouts,
      });

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

      closeEditModal();
      loadDonations();
    } catch (err: any) {
      setEditError(err.message || 'Failed to update donation');
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
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            placeholder="Search contacts or businesses..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            size="small"
            sx={{ flexGrow: 1, maxWidth: 400 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
          />

          <FormControl size="small" sx={{ minWidth: 140 }}>
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

          <FormControl size="small" sx={{ minWidth: 140 }}>
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
            disabled={filteredDonations.length === 0}
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
      </Paper>

      {/* Donations Table */}
      <TableContainer component={Paper}>
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
