import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { Business, Contact } from '../types';
import { AddressPicker } from '../components/AddressPicker';
import {
  Box,
  Typography,
  TextField,
  Card,
  CardContent,
  CardActionArea,
  Paper,
  InputAdornment,
  CircularProgress,
  Grid,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Alert,
} from '@mui/material';
import {
  Search as SearchIcon,
  Business as BusinessIcon,
  People as PeopleIcon,
  CalendarMonth as CalendarIcon,
  Edit as EditIcon,
} from '@mui/icons-material';

interface BusinessWithStats extends Business {
  contactCount: number;
  lastReachout?: Date;
}

export function Businesses() {
  const navigate = useNavigate();
  const { permissions, canEdit } = usePermissions();
  const [businesses, setBusinesses] = useState<BusinessWithStats[]>([]);
  const [filteredBusinesses, setFilteredBusinesses] = useState<BusinessWithStats[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingBusiness, setEditingBusiness] = useState<BusinessWithStats | null>(null);
  const [editFormData, setEditFormData] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: ''
  });
  const [editLoading, setEditLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadBusinesses();
  }, [permissions.currentStoreId]);

  useEffect(() => {
    if (searchTerm) {
      setFilteredBusinesses(
        businesses.filter(b =>
          b.name.toLowerCase().includes(searchTerm.toLowerCase())
        )
      );
    } else {
      setFilteredBusinesses(businesses);
    }
  }, [searchTerm, businesses]);

  const loadBusinesses = async () => {
    try {
      if (!permissions.currentStoreId) {
        setBusinesses([]);
        setLoading(false);
        return;
      }
      const storeId = permissions.currentStoreId;

      const [businessList, contactsList] = await Promise.all([
        api.get<Business[]>(`/businesses?storeId=${storeId}`),
        api.get<Contact[]>(`/contacts?storeId=${storeId}`),
      ]);

      const contactsByBusiness = new Map<string, Contact[]>();
      for (const c of contactsList) {
        const list = contactsByBusiness.get(c.businessId) || [];
        list.push(c);
        contactsByBusiness.set(c.businessId, list);
      }

      const businessesWithStats: BusinessWithStats[] = businessList.map(business => {
        const contacts = contactsByBusiness.get(business.id) || [];
        let lastReachout: Date | undefined;
        contacts.forEach(contact => {
          const d = contact.lastReachoutDate instanceof Date ? contact.lastReachoutDate : contact.lastReachoutDate ? new Date(contact.lastReachoutDate) : undefined;
          if (d && (!lastReachout || d > lastReachout)) lastReachout = d;
        });
        return {
          ...business,
          createdAt: business.createdAt instanceof Date ? business.createdAt : new Date(business.createdAt),
          contactCount: contacts.length,
          lastReachout,
        };
      });

      businessesWithStats.sort((a, b) => b.contactCount - a.contactCount);
      setBusinesses(businessesWithStats);
    } catch (error) {
      console.error('Error loading businesses:', error);
    } finally {
      setLoading(false);
    }
  };

  const openEditModal = (business: BusinessWithStats) => {
    setEditingBusiness(business);
    setEditFormData({
      name: business.name || '',
      address: business.address || '',
      city: business.city || '',
      state: business.state || '',
      zipCode: business.zipCode || ''
    });
    setError('');
    setSuccess('');
  };

  const closeEditModal = () => {
    setEditingBusiness(null);
    setEditFormData({
      name: '',
      address: '',
      city: '',
      state: '',
      zipCode: ''
    });
    setError('');
    setSuccess('');
  };

  const handleEditSubmit = async () => {
    if (!editingBusiness) return;
    
    setError('');
    setSuccess('');
    setEditLoading(true);

    if (!editFormData.name.trim()) {
      setError('Business name is required');
      setEditLoading(false);
      return;
    }

    // Check permissions
    if (!canEdit(editingBusiness.storeId)) {
      setError('You do not have permission to edit this business');
      setEditLoading(false);
      return;
    }

    try {
      await api.patch(`/businesses/${editingBusiness.id}`, {
        name: editFormData.name.trim(),
        address: editFormData.address.trim() || undefined,
        city: editFormData.city.trim() || undefined,
        state: editFormData.state.trim().toUpperCase() || undefined,
        zipCode: editFormData.zipCode.trim() || undefined
      });

      setSuccess('Business updated successfully!');
      closeEditModal();
      await loadBusinesses();
    } catch (err: any) {
      setError(err.message || 'Failed to update business');
    } finally {
      setEditLoading(false);
    }
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
        <BusinessIcon /> Businesses
      </Typography>

      {/* Search */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <TextField
          placeholder="Search businesses..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          size="small"
          sx={{ width: '100%', maxWidth: 400 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon color="action" />
              </InputAdornment>
            ),
          }}
        />
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Businesses Grid */}
      {filteredBusinesses.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {searchTerm ? 'No businesses match your search' : 'No businesses yet. Create one when adding a contact!'}
          </Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {filteredBusinesses.map((business) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={business.id}>
              <Card>
                <Box sx={{ position: 'relative' }}>
                  {canEdit(business.storeId) && (
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(business);
                      }}
                      sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        zIndex: 1,
                        backgroundColor: 'background.paper',
                        '&:hover': {
                          backgroundColor: 'action.hover',
                        },
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  )}
                  <CardActionArea onClick={() => navigate(`/dashboard?business=${business.id}`)}>
                    <CardContent>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, pr: canEdit(business.storeId) ? 4 : 0 }}>
                        {business.name}
                      </Typography>
                      
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <PeopleIcon fontSize="small" color="action" />
                          <Typography variant="body2" color="text.secondary">
                            {business.contactCount} contact{business.contactCount !== 1 ? 's' : ''}
                          </Typography>
                        </Box>
                        
                        {business.lastReachout && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <CalendarIcon fontSize="small" color="action" />
                            <Typography variant="body2" color="text.secondary">
                              Last: {business.lastReachout.toLocaleDateString()}
                            </Typography>
                          </Box>
                        )}
                      </Box>

                      <Box sx={{ mt: 2 }}>
                        <Chip 
                          label="View Contacts →" 
                          size="small" 
                          color="primary" 
                          variant="outlined"
                        />
                      </Box>
                    </CardContent>
                  </CardActionArea>
                </Box>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Edit Business Dialog */}
      <Dialog open={!!editingBusiness} onClose={closeEditModal} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Business</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <TextField
              label="Business Name"
              value={editFormData.name}
              onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
              placeholder="e.g., ABC Company"
              required
              fullWidth
            />
            
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                Address
              </Typography>
              <AddressPicker
                value={{
                  address: editFormData.address,
                  city: editFormData.city,
                  state: editFormData.state,
                  zipCode: editFormData.zipCode,
                }}
                onChange={(address) => {
                  setEditFormData({
                    ...editFormData,
                    address: address.address,
                    city: address.city,
                    state: address.state,
                    zipCode: address.zipCode,
                  });
                }}
                label="Street Address"
                fullWidth
              />
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr' }, gap: 2 }}>
                <TextField
                  label="City"
                  value={editFormData.city}
                  onChange={(e) => setEditFormData({ ...editFormData, city: e.target.value })}
                  fullWidth
                />
                <TextField
                  label="State"
                  value={editFormData.state}
                  onChange={(e) => setEditFormData({ ...editFormData, state: e.target.value.toUpperCase() })}
                  placeholder="CA"
                  inputProps={{ maxLength: 2 }}
                  fullWidth
                />
                <TextField
                  label="Zip Code"
                  value={editFormData.zipCode}
                  onChange={(e) => setEditFormData({ ...editFormData, zipCode: e.target.value })}
                  placeholder="12345"
                  inputProps={{ maxLength: 5 }}
                  fullWidth
                />
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={closeEditModal} disabled={editLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleEditSubmit}
            variant="contained"
            disabled={editLoading || !editFormData.name.trim()}
          >
            {editLoading ? <CircularProgress size={20} /> : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
