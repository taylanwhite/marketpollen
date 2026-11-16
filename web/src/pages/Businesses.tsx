import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { Business, Contact } from '../types';
import { AddressPicker } from '../components/AddressPicker';
import { ImportCustomersDialog } from '../components/ImportCustomersDialog';
import { PlaceMatchPicker, type PlaceResult } from '../components/PlaceMatchPicker';
import { CorporateAccountEditor } from '../components/ContactProfileFields';
import { corporateAccountFromBusiness, corporateAccountPayload, type CorporateAccountFields } from '../utils/organizationTypes';
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
  Place as PlaceIcon,
  Link as LinkIcon,
  LinkOff as LinkOffIcon,
  UploadFile as UploadIcon,
} from '@mui/icons-material';

interface BusinessWithStats extends Business {
  contactCount: number;
  lastReachout?: Date;
}

/**
 * No street address, or a street with no town or ZIP at all (in their own
 * fields or typed into the street line). These can't be put on the map
 * reliably; linking the Google place fills them in.
 */
function missingAddress(b: { address?: string | null; city?: string | null; zipCode?: string | null }): boolean {
  const street = b.address?.trim() || '';
  if (!street) return true;
  return !b.city?.trim() && !b.zipCode?.trim() && !street.includes(',') && !/\b\d{5}\b/.test(street);
}

const norm = (v?: string | null) => (v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Whether a typed business address and a Google place look like the same spot (same ZIP, else town, plus street number). */
function sameAddress(
  b: { address?: string | null; city?: string | null; zipCode?: string | null },
  place: { address?: string; city?: string; zipCode?: string },
): boolean {
  const zipA = norm(b.zipCode).slice(0, 5) || (b.address?.match(/\b\d{5}\b/)?.[0] ?? '');
  const zipB = norm(place.zipCode).slice(0, 5);
  if (zipA && zipB && zipA !== zipB) return false;
  if (!(zipA && zipB) && b.city && place.city && norm(b.city) !== norm(place.city)) return false;
  const numA = b.address?.trim().match(/^\d+/)?.[0];
  const numB = place.address?.trim().match(/^\d+/)?.[0];
  return !(numA && numB && numA !== numB);
}

export function Businesses() {
  const navigate = useNavigate();
  const { permissions, canEdit } = usePermissions();
  const [businesses, setBusinesses] = useState<BusinessWithStats[]>([]);
  const [filteredBusinesses, setFilteredBusinesses] = useState<BusinessWithStats[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingBusiness, setEditingBusiness] = useState<BusinessWithStats | null>(null);
  const [editFormData, setEditFormData] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: ''
  });
  const [corporateDraft, setCorporateDraft] = useState<CorporateAccountFields>(corporateAccountFromBusiness(null));
  const [editLoading, setEditLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPlacePicker, setShowPlacePicker] = useState(false);
  const [placePickerBusiness, setPlacePickerBusiness] = useState<BusinessWithStats | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    loadBusinesses();
  }, [permissions.currentStoreId]);

  useEffect(() => {
    const term = searchTerm.toLowerCase();
    setFilteredBusinesses(
      businesses.filter((b) =>
        (!term || b.name.toLowerCase().includes(term)) && (!missingOnly || missingAddress(b)),
      ),
    );
  }, [searchTerm, missingOnly, businesses]);

  const missingCount = businesses.filter(missingAddress).length;

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
    setCorporateDraft(corporateAccountFromBusiness(business));
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
    setCorporateDraft(corporateAccountFromBusiness(null));
    setError('');
    setSuccess('');
  };

  const openPlacePicker = (business: BusinessWithStats) => {
    setPlacePickerBusiness(business);
    setShowPlacePicker(true);
  };

  const handleLinkPlace = async (place: PlaceResult) => {
    if (!placePickerBusiness) return;
    try {
      // Fill in the address from the place. If one is already entered and
      // the place is somewhere else, ask which is right: the popup shows the
      // address, so the two have to agree for the map pin to make sense.
      const b = placePickerBusiness;
      const hasAddress = !!(b.address || b.city);
      const typed = [b.address, b.city, b.state, b.zipCode].filter(Boolean).join(', ');
      const differs = hasAddress && !sameAddress(b, place);
      const googleAddress = [place.address, place.city, place.state, place.zipCode].filter(Boolean).join(', ');
      const useGoogle = !hasAddress || (differs && window.confirm(
        `This Google place is at:\n${googleAddress}\n\nThe business has:\n${typed}\n\nUse Google's address?`,
      ));
      await api.patch(`/businesses/${b.id}`, {
        placeId: place.placeId,
        ...(useGoogle
          ? {
              address: place.address,
              city: place.city,
              state: place.state,
              zipCode: place.zipCode,
            }
          : {
              // Same place: keep what was typed, but fill in any missing
              // street, city, state, or ZIP from Google.
              ...(!b.address && place.address && { address: place.address }),
              ...(!b.city && place.city && { city: place.city }),
              ...(!b.state && place.state && { state: place.state }),
              ...(!b.zipCode && place.zipCode && { zipCode: place.zipCode }),
            }),
      });
      setShowPlacePicker(false);
      setPlacePickerBusiness(null);
      setSuccess('Business linked to Google Place!');
      await loadBusinesses();
    } catch (err: any) {
      setError(err.message || 'Failed to link place');
    }
  };

  const handleUnlinkPlace = async (business: BusinessWithStats) => {
    try {
      await api.patch(`/businesses/${business.id}`, { placeId: '' });
      setSuccess('Google Place link removed.');
      await loadBusinesses();
    } catch (err: any) {
      setError(err.message || 'Failed to unlink place');
    }
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
        zipCode: editFormData.zipCode.trim() || undefined,
        ...corporateAccountPayload(corporateDraft),
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
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <Typography variant="h4" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
          <BusinessIcon /> Businesses
        </Typography>
        {permissions.currentStoreId && canEdit(permissions.currentStoreId) && (
          <Button variant="outlined" startIcon={<UploadIcon />} onClick={() => setImportOpen(true)}>
            Import
          </Button>
        )}
      </Box>

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
        {(missingCount > 0 || missingOnly) && (
          <Chip
            label={`Missing address (${missingCount})`}
            color="warning"
            variant={missingOnly ? 'filled' : 'outlined'}
            onClick={() => setMissingOnly((on) => !on)}
            sx={{ ml: { sm: 1.5 }, mt: { xs: 1.5, sm: 0 }, verticalAlign: 'middle' }}
          />
        )}
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Businesses Grid */}
      {filteredBusinesses.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {missingOnly
              ? 'Every business has an address.'
              : searchTerm ? 'No businesses match your search' : 'No businesses yet. Create one when adding a contact!'}
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

                      <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <Chip 
                          label="View Contacts →" 
                          size="small" 
                          color="primary" 
                          variant="outlined"
                        />
                        {business.placeId && business.placeMismatch ? (
                          <Chip
                            icon={<PlaceIcon sx={{ fontSize: 14 }} />}
                            label="Check Google link"
                            title="The linked Google place is far from this address, so the map uses the address. Relink it to the right place."
                            size="small"
                            color="warning"
                            variant="outlined"
                          />
                        ) : business.placeId ? (
                          <Chip
                            icon={<PlaceIcon sx={{ fontSize: 14 }} />}
                            label="Linked"
                            size="small"
                            color="success"
                            variant="outlined"
                          />
                        ) : (
                          <Chip
                            icon={<LinkOffIcon sx={{ fontSize: 14 }} />}
                            label="Not linked"
                            size="small"
                            variant="outlined"
                            sx={{ color: 'text.disabled', borderColor: 'divider' }}
                          />
                        )}
                        {missingAddress(business) && (
                          <Chip label="No address" size="small" color="warning" variant="outlined" />
                        )}
                      </Box>
                    </CardContent>
                  </CardActionArea>
                  {canEdit(business.storeId) && (
                    <Box sx={{ px: 2, pb: 2 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => navigate(`/dashboard?business=${business.id}&new=1`)}
                      >
                        Add contact
                      </Button>
                    </Box>
                  )}
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
              <CorporateAccountEditor value={corporateDraft} onChange={setCorporateDraft} disabled={editLoading} />
            </Box>

            {/* Google Place Link Section */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                Google Place
              </Typography>
              {editingBusiness?.placeId && editingBusiness.placeMismatch && (
                <Alert severity="warning" sx={{ py: 0 }}>
                  The linked Google place is far from this address, so the map pin uses the address. If it's the wrong location, unlink it and link the right one.
                </Alert>
              )}
              {editingBusiness?.placeId ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip
                    icon={<PlaceIcon />}
                    label="Linked to Google Place"
                    color={editingBusiness.placeMismatch ? 'warning' : 'success'}
                    size="small"
                  />
                  <Button
                    size="small"
                    color="error"
                    startIcon={<LinkOffIcon />}
                    onClick={() => { if (editingBusiness) handleUnlinkPlace(editingBusiness); closeEditModal(); }}
                  >
                    Unlink
                  </Button>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Not linked — this business may appear as an opportunity.
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<LinkIcon />}
                    onClick={() => { if (editingBusiness) openPlacePicker(editingBusiness); }}
                  >
                    Link
                  </Button>
                </Box>
              )}
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

      {/* Place Match Picker for linking existing businesses */}
      <ImportCustomersDialog
        open={importOpen}
        storeId={permissions.currentStoreId || ''}
        onClose={() => setImportOpen(false)}
        onImported={(summary) => {
          setSuccess(summary);
          loadBusinesses();
        }}
      />

      <PlaceMatchPicker
        open={showPlacePicker}
        businessName={placePickerBusiness?.name || ''}
        businessAddress={placePickerBusiness?.address || undefined}
        businessCity={placePickerBusiness?.city || undefined}
        businessState={placePickerBusiness?.state || undefined}
        businessZipCode={placePickerBusiness?.zipCode || undefined}
        onSelect={handleLinkPlace}
        onSkip={() => { setShowPlacePicker(false); setPlacePickerBusiness(null); }}
        onClose={() => { setShowPlacePicker(false); setPlacePickerBusiness(null); }}
      />
    </Box>
  );
}
