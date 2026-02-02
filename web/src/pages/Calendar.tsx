import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { useAuth } from '../contexts/AuthContext';
import { CalendarEvent as CalendarEventType, Contact } from '../types';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Chip,
  IconButton,
  CircularProgress,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Alert,
  Tooltip,
} from '@mui/material';
import {
  CalendarMonth as CalendarIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Today as TodayIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  Event as MeetingIcon,
  Message as MessageIcon,
} from '@mui/icons-material';

interface CalendarEventDisplay {
  id: string;
  date: Date;
  title: string;
  type: CalendarEventType['type'];
  contactId?: string | null;
  contactName?: string;
  priority?: 'low' | 'medium' | 'high' | null;
  status?: 'scheduled' | 'completed' | 'cancelled' | null;
  description?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
}

export function Calendar() {
  const navigate = useNavigate();
  const { permissions } = usePermissions();
  const { currentUser } = useAuth();
  const [events, setEvents] = useState<CalendarEventDisplay[]>([]);
  const [contacts, setContacts] = useState<Map<string, Contact>>(new Map());
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEventDisplay | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state for creating/editing events
  const [eventForm, setEventForm] = useState({
    title: '',
    description: '',
    date: '',
    startTime: '',
    endTime: '',
    type: 'meeting' as CalendarEventType['type'],
    contactId: '',
    priority: 'medium' as 'low' | 'medium' | 'high',
    location: '',
  });

  useEffect(() => {
    if (permissions.currentStoreId) {
      loadCalendarData();
    }
  }, [permissions.currentStoreId, currentDate]);

  const loadCalendarData = async () => {
    if (!permissions.currentStoreId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const storeId = permissions.currentStoreId;

      const [eventsList, contactsList] = await Promise.all([
        api.get<Array<{ id: string; date: string | Date; title: string; type?: string; contactId?: string; priority?: string; status?: string; description?: string; startTime?: string; endTime?: string }>>(`/calendar-events?storeId=${storeId}`),
        api.get<Contact[]>(`/contacts?storeId=${storeId}`),
      ]);

      const eventsData: CalendarEventDisplay[] = [];
      const contactsMap = new Map<string, Contact>();

      for (const c of contactsList) {
        const contact: Contact = {
          ...c,
          reachouts: (c.reachouts || []).map((r: any) => ({
            ...r,
            date: r.date instanceof Date ? r.date : new Date(r.date),
          })),
          createdAt: c.createdAt instanceof Date ? c.createdAt : new Date(c.createdAt),
        };
        contactsMap.set(c.id, contact);
      }

      for (const data of eventsList) {
        let eventDate = data.date instanceof Date ? data.date : new Date(data.date);
        const year = eventDate.getFullYear();
        const month = eventDate.getMonth();
        const day = eventDate.getDate();
        eventDate = new Date(year, month, day, 0, 0, 0, 0);
        eventsData.push({
          id: data.id,
          date: eventDate,
          title: data.title || 'Untitled Event',
          type: (data.type || 'other') as CalendarEventType['type'],
          contactId: data.contactId || null,
          contactName: undefined,
          priority: (data.priority as 'low' | 'medium' | 'high') || null,
          status: (data.status as 'scheduled' | 'completed' | 'cancelled') || 'scheduled',
          description: data.description || null,
          startTime: data.startTime || null,
          endTime: data.endTime || null,
          location: undefined,
        });
      }

      for (const contact of contactsMap.values()) {
        contact.reachouts.forEach(reachout => {
          const reachoutId = `reachout-${contact.id}-${reachout.id}`;
          const existingEvent = eventsData.find(e =>
            e.contactId === contact.id &&
            e.type === 'reachout' &&
            Math.abs(new Date(e.date).getTime() - new Date(reachout.date).getTime()) < 60000
          );
          if (!existingEvent) {
            const contactName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'Contact';
            const reachoutDate = reachout.date instanceof Date ? reachout.date : new Date(reachout.date);
            const normalizedReachoutDate = new Date(reachoutDate.getFullYear(), reachoutDate.getMonth(), reachoutDate.getDate(), 0, 0, 0, 0);
            eventsData.push({
              id: reachoutId,
              date: normalizedReachoutDate,
              title: `Reachout: ${contactName}`,
              type: (reachout.type || 'other') as CalendarEventType['type'],
              contactId: contact.id,
              contactName: contactName,
              priority: null,
              status: 'completed',
              description: reachout.note || null,
              startTime: null,
              endTime: null,
              location: null,
            });
          }
        });
      }

      // Resolve contact names for calendar events
      eventsData.forEach(event => {
        if (event.contactId && !event.contactName) {
          const contact = contactsMap.get(event.contactId);
          if (contact) {
            event.contactName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'Contact';
          }
        }
      });

      // Sort events by date (ascending)
      eventsData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      setEvents(eventsData);
      setContacts(contactsMap);
    } catch (error) {
      console.error('Error loading calendar data:', error);
      setError('Failed to load calendar events');
    } finally {
      setLoading(false);
    }
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days: (Date | null)[] = [];
    
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    
    return days;
  };

  const getEventsForDate = (date: Date | null): CalendarEventDisplay[] => {
    if (!date) return [];
    
    // Normalize dates to local midnight for accurate comparison
    const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    
    return events.filter(event => {
      const eventDate = new Date(event.date);
      // Event dates should already be normalized to midnight when loaded, but normalize again for safety
      const normalizedEventDate = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate(), 0, 0, 0, 0);
      return normalizedEventDate.getTime() === targetDate.getTime();
    });
  };

  const getMethodIcon = (type: string) => {
    switch (type) {
      case 'email':
        return <EmailIcon fontSize="small" />;
      case 'call':
        return <PhoneIcon fontSize="small" />;
      case 'meeting':
        return <MeetingIcon fontSize="small" />;
      case 'text':
        return <MessageIcon fontSize="small" />;
      default:
        return null;
    }
  };

  const getMethodColor = (type: string) => {
    switch (type) {
      case 'email':
        return 'primary';
      case 'call':
        return 'success';
      case 'meeting':
        return 'warning';
      case 'text':
        return 'info';
      default:
        return 'default';
    }
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(null);
  };

  const openCreateEventDialog = (date?: Date) => {
    const targetDate = date || selectedDate || new Date();
    setEventForm({
      title: '',
      description: '',
      date: targetDate.toISOString().split('T')[0],
      startTime: '',
      endTime: '',
      type: 'meeting',
      contactId: '',
      priority: 'medium',
      location: '',
    });
    setCreatingEvent(true);
    setError('');
    setSuccess('');
  };

  const openEditEventDialog = (event: CalendarEventDisplay) => {
    setEventForm({
      title: event.title,
      description: event.description || '',
      date: new Date(event.date).toISOString().split('T')[0],
      startTime: event.startTime || '',
      endTime: event.endTime || '',
      type: event.type,
      contactId: event.contactId || '',
      priority: event.priority || 'medium',
      location: event.location || '',
    });
    setEditingEvent(event);
    setError('');
    setSuccess('');
  };

  const closeEventDialog = () => {
    setCreatingEvent(false);
    setEditingEvent(null);
    setEventForm({
      title: '',
      description: '',
      date: '',
      startTime: '',
      endTime: '',
      type: 'meeting',
      contactId: '',
      priority: 'medium',
      location: '',
    });
    setError('');
    setSuccess('');
  };

  const handleSaveEvent = async () => {
    if (!currentUser || !permissions.currentStoreId) {
      setError('You must be logged in and have a store selected');
      return;
    }

    if (!eventForm.title.trim()) {
      setError('Event title is required');
      return;
    }

    if (!eventForm.date) {
      setError('Event date is required');
      return;
    }

    try {
      // Parse date string and create in local timezone at midnight to avoid timezone shifts
      const [year, month, day] = eventForm.date.split('-').map(Number);
      const eventDate = new Date(year, month - 1, day); // month is 0-indexed
      
      if (eventForm.startTime) {
        const [hours, minutes] = eventForm.startTime.split(':');
        eventDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      } else {
        // Set to midnight local time if no time specified to avoid timezone issues
        eventDate.setHours(0, 0, 0, 0);
      }

      const contact = eventForm.contactId ? contacts.get(eventForm.contactId) : null;

      const eventData: Omit<CalendarEventType, 'id'> = {
        storeId: permissions.currentStoreId,
        title: eventForm.title.trim(),
        description: eventForm.description.trim() || null,
        date: eventDate,
        startTime: eventForm.startTime || null,
        endTime: eventForm.endTime || null,
        type: eventForm.type,
        contactId: eventForm.contactId || null,
        businessId: contact?.businessId || null,
        priority: eventForm.priority,
        status: 'scheduled',
        location: eventForm.location.trim() || null,
        notes: null,
        createdBy: currentUser.uid,
        createdAt: new Date(),
        updatedAt: null,
        completedAt: null,
        cancelledAt: null,
      };

      if (editingEvent && !editingEvent.id.startsWith('reachout-')) {
        await api.patch(`/calendar-events/${editingEvent.id}`, {
          title: eventData.title,
          description: eventData.description,
          date: eventData.date,
          startTime: eventData.startTime,
          endTime: eventData.endTime,
          type: eventData.type,
          contactId: eventData.contactId,
          businessId: eventData.businessId,
          priority: eventData.priority,
          status: eventData.status,
        });
        setSuccess('Event updated successfully!');
      } else if (!editingEvent) {
        await api.post(`/calendar-events?storeId=${permissions.currentStoreId}`, {
          title: eventData.title,
          description: eventData.description,
          date: eventData.date,
          startTime: eventData.startTime,
          endTime: eventData.endTime,
          type: eventData.type,
          contactId: eventData.contactId || undefined,
          businessId: eventData.businessId || undefined,
          priority: eventData.priority,
          status: eventData.status,
        });
        setSuccess('Event created successfully!');
      }

      closeEventDialog();
      await loadCalendarData();
    } catch (err: any) {
      setError(err.message || 'Failed to save event');
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (eventId.startsWith('reachout-')) return;
    if (!window.confirm('Are you sure you want to delete this event?')) {
      return;
    }

    try {
      await api.delete(`/calendar-events/${eventId}`);
      setSuccess('Event deleted successfully!');
      await loadCalendarData();
    } catch (err: any) {
      setError(err.message || 'Failed to delete event');
    }
  };

  const handleCompleteEvent = async (event: CalendarEventDisplay) => {
    if (event.id.startsWith('reachout-')) return;
    try {
      await api.patch(`/calendar-events/${event.id}`, {
        status: 'completed',
        completedAt: new Date(),
      });
      setSuccess('Event marked as completed!');
      await loadCalendarData();
    } catch (err: any) {
      setError(err.message || 'Failed to update event');
    }
  };

  const handleCancelEvent = async (event: CalendarEventDisplay) => {
    if (event.id.startsWith('reachout-')) return;
    try {
      await api.patch(`/calendar-events/${event.id}`, {
        status: 'cancelled',
      });
      setSuccess('Event cancelled!');
      await loadCalendarData();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel event');
    }
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  const days = getDaysInMonth(currentDate);
  const selectedDateEvents = selectedDate ? getEventsForDate(selectedDate) : [];
  const contactList = Array.from(contacts.values());

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
          <CalendarIcon /> Calendar
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => openCreateEventDialog()}
        >
          New Event
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Calendar Header */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton onClick={() => navigateMonth('prev')} size="small">
              <ChevronLeftIcon />
            </IconButton>
            <Typography variant="h6" sx={{ minWidth: 200, textAlign: 'center' }}>
              {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
            </Typography>
            <IconButton onClick={() => navigateMonth('next')} size="small">
              <ChevronRightIcon />
            </IconButton>
          </Box>
          <Button
            variant="outlined"
            startIcon={<TodayIcon />}
            onClick={goToToday}
            size="small"
          >
            Today
          </Button>
        </Box>

        {/* Calendar Grid */}
        <Grid container spacing={0.5}>
          {/* Day Headers */}
          {dayNames.map(day => (
            <Grid size={{ xs: 12 / 7 }} key={day}>
              <Box sx={{ textAlign: 'center', py: 1, fontWeight: 600, color: 'text.secondary' }}>
                {day}
              </Box>
            </Grid>
          ))}

          {/* Calendar Days */}
          {days.map((date, index) => {
            const dayEvents = date ? getEventsForDate(date) : [];
            const isToday = date && 
              date.getDate() === new Date().getDate() &&
              date.getMonth() === new Date().getMonth() &&
              date.getFullYear() === new Date().getFullYear();
            const isSelected = date && selectedDate &&
              date.getDate() === selectedDate.getDate() &&
              date.getMonth() === selectedDate.getMonth() &&
              date.getFullYear() === selectedDate.getFullYear();
            const isPast = date && date < new Date() && !isToday;

            return (
              <Grid size={{ xs: 12 / 7 }} key={index}>
                <Card
                  sx={{
                    minHeight: 100,
                    cursor: date ? 'pointer' : 'default',
                    backgroundColor: isSelected ? 'action.selected' : isToday ? 'action.hover' : isPast ? 'action.disabledBackground' : 'background.paper',
                    border: isToday ? 2 : 1,
                    borderColor: isToday ? 'primary.main' : 'divider',
                    opacity: isPast ? 0.7 : 1,
                    '&:hover': date ? { backgroundColor: 'action.hover' } : {},
                  }}
                  onClick={() => {
                    if (date) {
                      setSelectedDate(date);
                      if (!isSelected) {
                        openCreateEventDialog(date);
                      }
                    }
                  }}
                >
                  <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                    {date && (
                      <>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: isToday ? 700 : 500,
                              color: isToday ? 'primary.main' : 'text.primary',
                            }}
                          >
                            {date.getDate()}
                          </Typography>
                          {dayEvents.length > 0 && (
                            <Chip
                              label={dayEvents.length}
                              size="small"
                              sx={{ height: 18, fontSize: '0.65rem' }}
                            />
                          )}
                        </Box>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          {dayEvents.slice(0, 2).map((event) => {
                            const icon = getMethodIcon(event.type);
                            return (
                              <Tooltip key={event.id} title={event.title}>
                                <Chip
                                  label={event.title}
                                  size="small"
                                  icon={icon || undefined}
                                  color={event.status === 'completed' ? 'success' : event.status === 'cancelled' ? 'default' : getMethodColor(event.type) as any}
                                  variant={event.status === 'completed' ? 'outlined' : 'filled'}
                                  sx={{
                                    fontSize: '0.65rem',
                                    height: 20,
                                    '& .MuiChip-label': { px: 0.5 },
                                  }}
                                  onClick={(e: React.MouseEvent) => {
                                    e.stopPropagation();
                                    setSelectedDate(date);
                                    openEditEventDialog(event);
                                  }}
                                />
                              </Tooltip>
                            );
                          })}
                          {dayEvents.length > 2 && (
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                              +{dayEvents.length - 2} more
                            </Typography>
                          )}
                        </Box>
                      </>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      </Paper>

      {/* Selected Date Events */}
      {selectedDate && selectedDateEvents.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Events on {selectedDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </Typography>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => openCreateEventDialog(selectedDate)}
            >
              Add Event
            </Button>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {selectedDateEvents.map((event) => (
              <Card key={event.id} variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', mb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                      {getMethodIcon(event.type)}
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {event.title}
                      </Typography>
                      {event.contactName && (
                        <Chip label={event.contactName} size="small" variant="outlined" />
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      {event.status === 'scheduled' && (
                        <>
                          <Tooltip title="Mark as completed">
                            <IconButton
                              size="small"
                              color="success"
                              onClick={() => handleCompleteEvent(event)}
                            >
                              <CheckCircleIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Cancel">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => handleCancelEvent(event)}
                            >
                              <CancelIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                      <Tooltip title="Edit">
                        <IconButton
                          size="small"
                          onClick={() => openEditEventDialog(event)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteEvent(event.id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                    <Chip
                      label={event.type}
                      size="small"
                      color={getMethodColor(event.type) as any}
                    />
                    {event.priority && (
                      <Chip
                        label={event.priority}
                        size="small"
                        color={event.priority === 'high' ? 'error' : event.priority === 'medium' ? 'warning' : 'default'}
                      />
                    )}
                    {event.status && (
                      <Chip
                        label={event.status}
                        size="small"
                        color={event.status === 'completed' ? 'success' : event.status === 'cancelled' ? 'default' : 'primary'}
                        variant="outlined"
                      />
                    )}
                    {event.startTime && (
                      <Chip
                        label={`${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Box>
                  {event.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {event.description}
                    </Typography>
                  )}
                  {event.location && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      📍 {event.location}
                    </Typography>
                  )}
                  {event.contactId && (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => navigate(`/dashboard?contact=${event.contactId}`)}
                      sx={{ mt: 1 }}
                    >
                      View Contact
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </Box>
        </Paper>
      )}

      {/* Create/Edit Event Dialog */}
      <Dialog 
        open={creatingEvent || !!editingEvent} 
        onClose={closeEventDialog} 
        maxWidth="sm" 
        fullWidth
      >
        <DialogTitle>
          {editingEvent ? 'Edit Event' : 'Create New Event'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Event Title"
              value={eventForm.title}
              onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
              required
              fullWidth
            />
            <TextField
              label="Description"
              value={eventForm.description}
              onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
              multiline
              rows={3}
              fullWidth
            />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField
                label="Date"
                type="date"
                value={eventForm.date}
                onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })}
                required
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
              <TextField
                label="Type"
                select
                value={eventForm.type}
                onChange={(e) => setEventForm({ ...eventForm, type: e.target.value as CalendarEventType['type'] })}
                fullWidth
              >
                <MenuItem value="meeting">Meeting</MenuItem>
                <MenuItem value="call">Call</MenuItem>
                <MenuItem value="email">Email</MenuItem>
                <MenuItem value="text">Text</MenuItem>
                <MenuItem value="followup">Follow-up</MenuItem>
                <MenuItem value="reachout">Reachout</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </TextField>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField
                label="Start Time"
                type="time"
                value={eventForm.startTime}
                onChange={(e) => setEventForm({ ...eventForm, startTime: e.target.value })}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
              <TextField
                label="End Time"
                type="time"
                value={eventForm.endTime}
                onChange={(e) => setEventForm({ ...eventForm, endTime: e.target.value })}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField
                label="Contact (Optional)"
                select
                value={eventForm.contactId}
                onChange={(e) => setEventForm({ ...eventForm, contactId: e.target.value })}
                fullWidth
              >
                <MenuItem value="">None</MenuItem>
                {contactList.map(contact => (
                  <MenuItem key={contact.id} value={contact.id}>
                    {`${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'Contact'}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Priority"
                select
                value={eventForm.priority}
                onChange={(e) => setEventForm({ ...eventForm, priority: e.target.value as 'low' | 'medium' | 'high' })}
                fullWidth
              >
                <MenuItem value="low">Low</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="high">High</MenuItem>
              </TextField>
            </Box>
            <TextField
              label="Location (Optional)"
              value={eventForm.location}
              onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEventDialog}>Cancel</Button>
          <Button onClick={handleSaveEvent} variant="contained">
            {editingEvent ? 'Update' : 'Create'} Event
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
