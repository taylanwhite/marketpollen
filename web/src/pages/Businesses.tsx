import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
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
} from '@mui/material';
import {
  Search as SearchIcon,
  Business as BusinessIcon,
  People as PeopleIcon,
  CalendarMonth as CalendarIcon,
} from '@mui/icons-material';

interface Business {
  id: string;
  name: string;
  createdAt: Date;
}

interface BusinessWithStats extends Business {
  contactCount: number;
  lastReachout?: Date;
}

export function Businesses() {
  const navigate = useNavigate();
  const [businesses, setBusinesses] = useState<BusinessWithStats[]>([]);
  const [filteredBusinesses, setFilteredBusinesses] = useState<BusinessWithStats[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBusinesses();
  }, []);

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
      const businessSnapshot = await getDocs(collection(db, 'businesses'));
      const businessList: Business[] = [];
      businessSnapshot.forEach((doc) => {
        const data = doc.data();
        businessList.push({
          id: doc.id,
          name: data.name,
          createdAt: data.createdAt?.toDate() || new Date()
        });
      });

      const contactsSnapshot = await getDocs(collection(db, 'contacts'));
      const contactsByBusiness = new Map<string, any[]>();
      
      contactsSnapshot.forEach((doc) => {
        const data = doc.data();
        const businessId = data.businessId;
        if (!contactsByBusiness.has(businessId)) {
          contactsByBusiness.set(businessId, []);
        }
        contactsByBusiness.get(businessId)!.push(data);
      });

      const businessesWithStats: BusinessWithStats[] = businessList.map(business => {
        const contacts = contactsByBusiness.get(business.id) || [];
        let lastReachout: Date | undefined;

        contacts.forEach(contact => {
          if (contact.lastReachoutDate) {
            const date = contact.lastReachoutDate.toDate();
            if (!lastReachout || date > lastReachout) {
              lastReachout = date;
            }
          }
        });

        return {
          ...business,
          contactCount: contacts.length,
          lastReachout
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
                <CardActionArea onClick={() => navigate(`/dashboard?business=${business.id}`)}>
                  <CardContent>
                    <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
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
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}
