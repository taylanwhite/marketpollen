import { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc, query, where } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from '../firebase/config';
import { usePermissions } from '../contexts/PermissionContext';
import { useDonation } from '../contexts/DonationContext';
import { Contact, Reachout, DonationData, MOUTH_VALUES, QUARTERLY_GOAL } from '../types';
import {
  getReachoutsWithDonations,
  calculateMouths,
  getCurrentQuarterLabel,
  getQuarterProgress,
  getProgressColor,
} from '../utils/donationCalculations';
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

export function Donations() {
  const { permissions } = usePermissions();
  const { triggerRefresh, setLastDonationMouths } = useDonation();
  const [loading, setLoading] = useState(true);
  const [donations, setDonations] = useState<DonationRow[]>([]);
  const [filteredDonations, setFilteredDonations] = useState<DonationRow[]>([]);
  const [, setBusinesses] = useState<Map<string, string>>(new Map());
  const [searchTerm, setSearchTerm] = useState('');
  const [filterFollowedUp, setFilterFollowedUp] = useState<'all' | 'yes' | 'no'>('all');
  const [filterOrdered, setFilterOrdered] = useState<'all' | 'yes' | 'no'>('all');
  const [progress, setProgress] = useState({ totalMouths: 0, goal: QUARTERLY_GOAL, percentage: 0 });

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
      // Everyone (including global admins) must have a store selected
      if (!permissions.currentStoreId) {
        setDonations([]);
        setBusinesses(new Map());
        return;
      }

      // Load businesses for current store (filtered for everyone)
      const businessQuery = query(
        collection(db, 'businesses'),
        where('storeId', '==', permissions.currentStoreId)
      );
      
      const businessSnapshot = await getDocs(businessQuery);
      const businessMap = new Map<string, string>();
      businessSnapshot.forEach((doc) => {
        const data = doc.data();
        // Double-check storeId to ensure we only show businesses for this store
        if (data.storeId === permissions.currentStoreId) {
          businessMap.set(doc.id, data.name);
        }
      });
      setBusinesses(businessMap);

      // Load contacts for current store (filtered for everyone)
      const contactsQuery = query(
        collection(db, 'contacts'),
        where('storeId', '==', permissions.currentStoreId)
      );

      const querySnapshot = await getDocs(contactsQuery);
      const contacts: Contact[] = [];

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        // Double-check storeId to ensure we only show contacts for this store
        if (data.storeId !== permissions.currentStoreId) {
          return; // Skip this contact
        }
        
        const reachouts = (data.reachouts || []).map((r: any) => ({
          ...r,
          date: r.date?.toDate() || new Date(),
        }));

        contacts.push({
          id: doc.id,
          ...data,
          reachouts,
          createdAt: data.createdAt?.toDate() || new Date(),
        } as Contact);
      });

      // Get donations for current store and quarter
      const donationsWithData = getReachoutsWithDonations(contacts, {
        storeId: permissions.currentStoreId || undefined,
        quarterDate: new Date(),
      });

      const donationRows: DonationRow[] = donationsWithData.map(d => ({
        ...d,
        businessName: businessMap.get(d.contact.businessId) || d.contact.businessId,
      }));

      setDonations(donationRows);

      // Calculate progress
      if (permissions.currentStoreId) {
        const progressData = getQuarterProgress(contacts, permissions.currentStoreId, new Date());
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

      await updateDoc(doc(db, 'contacts', row.contact.id), {
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

      await updateDoc(doc(db, 'contacts', row.contact.id), {
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

  const handleExportToExcel = () => {
    // Prepare data for export
    const exportData = filteredDonations.map((row) => {
      const donation = row.reachout.donation;
      const contactName = `${row.contact.firstName || ''} ${row.contact.lastName || ''}`.trim() || '-';
      
      return {
        'Date': formatDate(row.reachout.date),
        'Business Name': row.businessName,
        'Contact First Name': row.contact.firstName || '',
        'Contact Last Name': row.contact.lastName || '',
        'Contact Name': contactName,
        'Phone': row.contact.phone || '',
        'Email': row.contact.email || '',
        'Mouths': row.mouths,
        'FREE Bundtlet Card': donation?.freeBundletCard || 0,
        'Dozen Bundtinis': donation?.dozenBundtinis || 0,
        '8" Cake': donation?.cake8inch || 0,
        '10" Cake': donation?.cake10inch || 0,
        'Sample Tray': donation?.sampleTray || 0,
        'Bundtlet/Tower': donation?.bundtletTower || 0,
        'Cakes Donated Notes': donation?.cakesDonatedNotes || '',
        'Followed Up': donation?.followedUp ? 'Yes' : 'No',
        'Ordered From Us': donation?.orderedFromUs ? 'Yes' : 'No',
        'Reachout Type': row.reachout.type || '',
        'Reachout Note': row.reachout.note || '',
      };
    });

    // Create workbook and worksheet
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Donations');

    // Set column widths for better readability
    const colWidths = [
      { wch: 12 }, // Date
      { wch: 25 }, // Business Name
      { wch: 15 }, // Contact First Name
      { wch: 15 }, // Contact Last Name
      { wch: 20 }, // Contact Name
      { wch: 15 }, // Phone
      { wch: 25 }, // Email
      { wch: 8 },  // Mouths
      { wch: 12 }, // FREE Bundtlet Card
      { wch: 12 }, // Dozen Bundtinis
      { wch: 10 }, // 8" Cake
      { wch: 10 }, // 10" Cake
      { wch: 12 }, // Sample Tray
      { wch: 12 }, // Bundtlet/Tower
      { wch: 30 }, // Cakes Donated Notes
      { wch: 12 }, // Followed Up
      { wch: 15 }, // Ordered From Us
      { wch: 12 }, // Reachout Type
      { wch: 40 }, // Reachout Note
    ];
    ws['!cols'] = colWidths;

    // Generate filename with current date and quarter
    const quarterLabel = getCurrentQuarterLabel();
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `Donations_${quarterLabel}_${dateStr}.xlsx`;

    // Write file
    XLSX.writeFile(wb, filename);
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

      await updateDoc(doc(db, 'contacts', editingDonation.contact.id), {
        reachouts: updatedReachouts,
      });

      // Calculate the difference in mouths and trigger refresh
      const oldMouths = editingDonation.reachout.donation ? calculateMouths(editingDonation.reachout.donation) : 0;
      const newMouths = calculateMouths(editDonationData);
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

  const progressColor = getProgressColor(progress.percentage);
  const colorMap = {
    success: '#4caf50',
    warning: '#ff9800',
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
      <Card sx={{ mb: 3, bgcolor: 'primary.main', color: 'white' }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">{getCurrentQuarterLabel()} Bundtini Goal</Typography>
            <Chip
              label={`${progress.percentage.toFixed(1)}%`}
              sx={{ bgcolor: colorMap[progressColor], color: 'white', fontWeight: 600 }}
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
            value={progress.percentage}
            sx={{
              mt: 2,
              height: 10,
              borderRadius: 5,
              bgcolor: 'rgba(255,255,255,0.3)',
              '& .MuiLinearProgress-bar': {
                bgcolor: colorMap[progressColor],
                borderRadius: 5,
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
            startIcon={<FileDownloadIcon />}
            onClick={handleExportToExcel}
            disabled={filteredDonations.length === 0}
          >
            Export to Excel
          </Button>
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
                Total Mouths: {calculateMouths(editDonationData)}
              </Typography>

              <Grid container spacing={2}>
                <Grid size={{ xs: 6 }}>
                  <TextField
                    label="FREE Bundtlet Card"
                    type="number"
                    size="small"
                    fullWidth
                    value={editDonationData.freeBundletCard || ''}
                    onChange={(e) => setEditDonationData(prev => prev ? { ...prev, freeBundletCard: parseInt(e.target.value) || 0 } : null)}
                    helperText={`${MOUTH_VALUES.freeBundletCard} mouth each`}
                    disabled={editLoading}
                  />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <TextField
                    label="Dozen Bundtinis"
                    type="number"
                    size="small"
                    fullWidth
                    value={editDonationData.dozenBundtinis || ''}
                    onChange={(e) => setEditDonationData(prev => prev ? { ...prev, dozenBundtinis: parseInt(e.target.value) || 0 } : null)}
                    helperText={`${MOUTH_VALUES.dozenBundtinis} mouths each`}
                    disabled={editLoading}
                  />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <TextField
                    label="8&quot; Cake"
                    type="number"
                    size="small"
                    fullWidth
                    value={editDonationData.cake8inch || ''}
                    onChange={(e) => setEditDonationData(prev => prev ? { ...prev, cake8inch: parseInt(e.target.value) || 0 } : null)}
                    helperText={`${MOUTH_VALUES.cake8inch} mouths each`}
                    disabled={editLoading}
                  />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <TextField
                    label="10&quot; Cake"
                    type="number"
                    size="small"
                    fullWidth
                    value={editDonationData.cake10inch || ''}
                    onChange={(e) => setEditDonationData(prev => prev ? { ...prev, cake10inch: parseInt(e.target.value) || 0 } : null)}
                    helperText={`${MOUTH_VALUES.cake10inch} mouths each`}
                    disabled={editLoading}
                  />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <TextField
                    label="Sample Tray"
                    type="number"
                    size="small"
                    fullWidth
                    value={editDonationData.sampleTray || ''}
                    onChange={(e) => setEditDonationData(prev => prev ? { ...prev, sampleTray: parseInt(e.target.value) || 0 } : null)}
                    helperText={`${MOUTH_VALUES.sampleTray} mouths each`}
                    disabled={editLoading}
                  />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <TextField
                    label="Bundtlet/Tower"
                    type="number"
                    size="small"
                    fullWidth
                    value={editDonationData.bundtletTower || ''}
                    onChange={(e) => setEditDonationData(prev => prev ? { ...prev, bundtletTower: parseInt(e.target.value) || 0 } : null)}
                    helperText={`${MOUTH_VALUES.bundtletTower} mouth each`}
                    disabled={editLoading}
                  />
                </Grid>
              </Grid>

              <TextField
                label="Cakes Donated Notes"
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
