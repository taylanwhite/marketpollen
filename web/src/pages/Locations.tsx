import { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionContext';
import { useNavigate } from 'react-router-dom';
import { Location } from '../types';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  CardActions,
  Paper,
  InputAdornment,
  CircularProgress,
  Alert,
  Collapse,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Search as SearchIcon,
  Add as AddIcon,
  Close as CloseIcon,
  LocationOn as LocationIcon,
  Edit as EditIcon,
  Save as SaveIcon,
} from '@mui/icons-material';

export function Locations() {
  const { currentUser } = useAuth();
  const { isAdmin } = usePermissions();
  const navigate = useNavigate();
  
  const [locations, setLocations] = useState<Location[]>([]);
  const [filteredLocations, setFilteredLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Create form
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: ''
  });

  // Edit modal
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [editFormData, setEditFormData] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: ''
  });

  useEffect(() => {
    if (!isAdmin()) {
      navigate('/dashboard');
      return;
    }
    loadLocations();
  }, [isAdmin, navigate]);

  useEffect(() => {
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      setFilteredLocations(
        locations.filter(loc =>
          loc.name.toLowerCase().includes(term) ||
          (loc.address?.toLowerCase() || '').includes(term) ||
          (loc.city?.toLowerCase() || '').includes(term) ||
          (loc.state?.toLowerCase() || '').includes(term) ||
          (loc.zipCode?.toLowerCase() || '').includes(term)
        )
      );
    } else {
      setFilteredLocations(locations);
    }
  }, [searchTerm, locations]);

  const loadLocations = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'locations'));
      const locationList: Location[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        locationList.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate() || new Date()
        } as Location);
      });
      locationList.sort((a, b) => a.name.localeCompare(b.name));
      setLocations(locationList);
    } catch (err: any) {
      setError(err.message || 'Failed to load locations');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!formData.name.trim()) {
      setError('Location name is required');
      return;
    }

    try {
      await addDoc(collection(db, 'locations'), {
        name: formData.name.trim(),
        address: formData.address.trim() || null,
        city: formData.city.trim() || null,
        state: formData.state.trim().toUpperCase() || null,
        zipCode: formData.zipCode.trim() || null,
        createdAt: new Date(),
        createdBy: currentUser?.uid
      });

      setSuccess('Location created successfully!');
      setFormData({ name: '', address: '', city: '', state: '', zipCode: '' });
      setShowForm(false);
      await loadLocations();
    } catch (err: any) {
      setError(err.message || 'Failed to create location');
    }
  };

  const openEditModal = (location: Location) => {
    setEditingLocation(location);
    setEditFormData({
      name: location.name || '',
      address: location.address || '',
      city: location.city || '',
      state: location.state || '',
      zipCode: location.zipCode || ''
    });
  };

  const closeEditModal = () => {
    setEditingLocation(null);
    setEditFormData({ name: '', address: '', city: '', state: '', zipCode: '' });
  };

  const handleEditSubmit = async () => {
    if (!editingLocation) return;
    
    setError('');
    setSuccess('');

    if (!editFormData.name.trim()) {
      setError('Location name is required');
      return;
    }

    try {
      await updateDoc(doc(db, 'locations', editingLocation.id), {
        name: editFormData.name.trim(),
        address: editFormData.address.trim() || null,
        city: editFormData.city.trim() || null,
        state: editFormData.state.trim().toUpperCase() || null,
        zipCode: editFormData.zipCode.trim() || null
      });

      setSuccess('Location updated successfully!');
      closeEditModal();
      await loadLocations();
    } catch (err: any) {
      setError(err.message || 'Failed to update location');
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
        <LocationIcon /> Manage Locations
      </Typography>

      {/* Search and Actions */}
      <Paper sx={{ p: 2, mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          placeholder="Search locations..."
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
        <Button
          variant="contained"
          startIcon={showForm ? <CloseIcon /> : <AddIcon />}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : 'New Location'}
        </Button>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Create Form */}
      <Collapse in={showForm}>
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            Create New Location
          </Typography>
          <Box component="form" onSubmit={handleSubmit}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12 }}>
                <TextField
                  label="Location Name"
                  name="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Downtown Store"
                  required
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  label="Address"
                  name="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Street address"
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 5 }}>
                <TextField
                  label="City"
                  name="city"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField
                  label="State"
                  name="state"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                  placeholder="CA"
                  inputProps={{ maxLength: 2 }}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <TextField
                  label="Zip Code"
                  name="zipCode"
                  value={formData.zipCode}
                  onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                  placeholder="12345"
                  inputProps={{ maxLength: 5 }}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Button type="submit" variant="contained" startIcon={<AddIcon />}>
                  Create Location
                </Button>
              </Grid>
            </Grid>
          </Box>
        </Paper>
      </Collapse>

      {/* Locations Grid */}
      {filteredLocations.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {searchTerm ? 'No locations match your search' : 'No locations yet. Create your first location!'}
          </Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {filteredLocations.map((location) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={location.id}>
              <Card>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                    {location.name}
                  </Typography>
                  {(location.address || location.city) && (
                    <Box sx={{ color: 'text.secondary', mb: 2 }}>
                      {location.address && (
                        <Typography variant="body2">{location.address}</Typography>
                      )}
                      <Typography variant="body2">
                        {[location.city, location.state, location.zipCode].filter(Boolean).join(', ')}
                      </Typography>
                    </Box>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    Created: {location.createdAt.toLocaleDateString()}
                  </Typography>
                </CardContent>
                <CardActions sx={{ justifyContent: 'flex-end', pt: 0 }}>
                  <Button
                    size="small"
                    startIcon={<EditIcon />}
                    onClick={() => openEditModal(location)}
                  >
                    Edit
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Edit Location Dialog */}
      <Dialog open={!!editingLocation} onClose={closeEditModal} maxWidth="sm" fullWidth>
        <DialogTitle>
          Edit Location
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Location Name"
              value={editFormData.name}
              onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
              placeholder="e.g., Downtown Store"
              required
              fullWidth
            />
            <TextField
              label="Address"
              value={editFormData.address}
              onChange={(e) => setEditFormData({ ...editFormData, address: e.target.value })}
              placeholder="Street address"
              fullWidth
            />
            <Box sx={{ display: 'flex', gap: 2 }}>
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
                sx={{ width: 100 }}
              />
              <TextField
                label="Zip Code"
                value={editFormData.zipCode}
                onChange={(e) => setEditFormData({ ...editFormData, zipCode: e.target.value })}
                placeholder="12345"
                inputProps={{ maxLength: 5 }}
                sx={{ width: 120 }}
              />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={closeEditModal}>Cancel</Button>
          <Button 
            variant="contained" 
            startIcon={<SaveIcon />}
            onClick={handleEditSubmit}
          >
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
