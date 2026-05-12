import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { useAuth } from '../contexts/AuthContext';
import { useDonation } from '../contexts/DonationContext';
import { useOffline } from '../contexts/OfflineContext';
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
  ContentCopy as CopyIcon,
  Route as RouteIcon,
  Assignment as PlannerIcon,
  AutoAwesome as AIIcon,
} from '@mui/icons-material';
const GenerateEmailDialog = lazy(() =>
  import('../components/GenerateEmailDialog').then((m) => ({ default: m.GenerateEmailDialog }))
);
import { PullToRefreshIndicator } from '../components/PullToRefreshIndicator';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { useTheme } from '@mui/material/styles';
import { useMediaQuery } from '@mui/material';

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

interface DayPlannerFollowUp {
  contactId: string;
  contactName: string;
  method: 'email' | 'call' | 'meeting' | 'text' | 'other';
  message: string;
  draftEmail?: string;
  eventTitle?: string;
  eventId?: string;
}

interface DayPlannerOpportunity {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}

interface DayPlannerData {
  storeName: string;
  storeAddress: string;
  date: string;
  followUpTasks: DayPlannerFollowUp[];
  optimizedRoute: DayPlannerOpportunity[];
}

export function Calendar() {
  const navigate = useNavigate();
  const { permissions } = usePermissions();
  const { userId } = useAuth();
  const { dataVersion } = useDonation();
  const { syncedCount } = useOffline();
  const [events, setEvents] = useState<CalendarEventDisplay[]>([]);
  const [contacts, setContacts] = useState<Map<string, Contact>>(new Map());
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEventDisplay | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [planDate, setPlanDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [dayPlan, setDayPlan] = useState<DayPlannerData | null>(null);
  const [dayPlanLoading, setDayPlanLoading] = useState(false);
  const [emailTarget, setEmailTarget] = useState<{ contactId: string; contactName: string } | null>(null);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const pullState = usePullToRefresh({
    onRefresh: async () => {
      await Promise.all([loadCalendarData(), loadDayPlan()]);
    },
    enabled: isMobile,
  });

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
    // dataVersion keeps the day planner + month view in sync with saves done
    // from the global QuickAdd sheet or other pages. syncedCount fires after
    // the offline queue lands a queued write — without it, a follow-up event
    // logged offline wouldn't appear on this page until pull-to-refresh.
  }, [permissions.currentStoreId, currentDate, dataVersion, syncedCount]);

  useEffect(() => {
    if (permissions.currentStoreId && planDate) {
      loadDayPlan();
    } else {
      setDayPlan(null);
    }
  }, [permissions.currentStoreId, planDate]);

  // "Last 5 visits" — most recent reachouts across all contacts in this store.
  // Depends on the `contacts` Map directly so the memo only recomputes when
  // the underlying data actually changes; an `Array.from(contacts.values())`
  // would be a fresh array every render and defeat memoization.
  //
  // IMPORTANT: this hook (and `todaySummary` below) MUST stay above the
  // `if (loading) return ...` early return later in this component, otherwise
  // React sees a different hook count between the loading and loaded renders
  // and throws minified error #310.
  const recentVisits = useMemo(() => {
    const all: Array<{
      contactId: string;
      contactName: string;
      date: Date;
      note: string;
      type?: string;
    }> = [];
    for (const c of contacts.values()) {
      const name = `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || c.phone || 'Contact';
      for (const r of c.reachouts) {
        all.push({
          contactId: c.id,
          contactName: name,
          date: r.date instanceof Date ? r.date : new Date(r.date),
          note: r.note || '',
          type: r.type || undefined,
        });
      }
    }
    return all.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 5);
  }, [contacts]);

  const todaySummary = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(startOfToday.getTime() - 7 * 24 * 60 * 60 * 1000);

    const eventsToday = events.filter(
      (e) => e.date >= startOfToday && e.date < endOfToday && e.status !== 'cancelled'
    );
    const followUpsToday = eventsToday.filter((e) => e.type === 'followup').length;

    let visitsLastWeek = 0;
    for (const c of contacts.values()) {
      for (const r of c.reachouts) {
        const d = r.date instanceof Date ? r.date : new Date(r.date);
        if (d >= sevenDaysAgo) visitsLastWeek++;
      }
    }
    return {
      eventsToday: eventsToday.length,
      followUpsToday,
      visitsLastWeek,
    };
  }, [events, contacts]);

  const loadDayPlan = async () => {
    if (!permissions.currentStoreId || !planDate) return;
    try {
      setDayPlanLoading(true);
      const data = await api.get<DayPlannerData>(
        `/day-planner?storeId=${permissions.currentStoreId}&date=${planDate}`
      );
      setDayPlan(data);
    } catch (e) {
      console.error('Load day plan:', e);
      setDayPlan(null);
    } finally {
      setDayPlanLoading(false);
    }
  };

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
    if (!userId || !permissions.currentStoreId) {
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
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: null,
        completedAt: null,
        cancelledAt: null,
      };

      if (editingEvent && !editingEvent.id.startsWith('reachout-')) {
        await api.queuePatch(`/calendar-events/${editingEvent.id}`, {
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
        }, { label: `Update event · ${eventData.title}` });
        setSuccess('Event updated successfully!');
      } else if (!editingEvent) {
        await api.queuePost(`/calendar-events?storeId=${permissions.currentStoreId}`, {
          id: crypto.randomUUID(),
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
        }, { label: `New event · ${eventData.title}` });
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
      await api.queuePatch(`/calendar-events/${event.id}`, {
        status: 'completed',
        completedAt: new Date(),
      }, { label: `Complete · ${event.title}` });
      setSuccess('Event marked as completed!');
      await loadCalendarData();
    } catch (err: any) {
      setError(err.message || 'Failed to update event');
    }
  };

  const handleCompleteFollowUp = async (task: DayPlannerFollowUp) => {
    try {
      if (task.eventId) {
        await api.queuePatch(`/calendar-events/${task.eventId}`, {
          status: 'completed',
          completedAt: new Date(),
        }, { label: `Complete follow-up · ${task.contactName}` });
      }
      // Clear the contact's suggested follow-up
      await api.queuePatch(`/contacts/${task.contactId}`, {
        suggestedFollowUpDate: null,
        suggestedFollowUpMethod: null,
        suggestedFollowUpNote: null,
        suggestedFollowUpPriority: null,
      }, { label: `Mark done · ${task.contactName}` });
      setSuccess('Follow-up marked as done!');
      if (dayPlan) {
        setDayPlan({
          ...dayPlan,
          followUpTasks: dayPlan.followUpTasks.filter(t => t.contactId !== task.contactId),
        });
      }
      await loadCalendarData();
    } catch (err: any) {
      setError(err.message || 'Failed to complete follow-up');
    }
  };

  const handleCancelEvent = async (event: CalendarEventDisplay) => {
    if (event.id.startsWith('reachout-')) return;
    try {
      await api.queuePatch(`/calendar-events/${event.id}`, {
        status: 'cancelled',
      }, { label: `Cancel · ${event.title}` });
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

  const formatTimeAgo = (date: Date) => {
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <Box>
      <PullToRefreshIndicator
        pullDistance={pullState.pullDistance}
        refreshing={pullState.refreshing}
        willTrigger={pullState.willTrigger}
      />
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

      {/* Today summary banner */}
      <Paper
        sx={{
          p: { xs: 1.5, sm: 2 },
          mb: 2,
          background: 'linear-gradient(135deg, rgba(245, 200, 66, 0.15) 0%, rgba(245, 200, 66, 0.05) 100%)',
          border: '1px solid rgba(245, 200, 66, 0.4)',
          borderRadius: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.5, sm: 3 }, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#2d2d2d', lineHeight: 1 }}>
              {todaySummary.eventsToday}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {todaySummary.eventsToday === 1 ? 'event today' : 'events today'}
            </Typography>
          </Box>
          <Box sx={{ width: 1, height: 24, bgcolor: 'rgba(0,0,0,0.1)' }} />
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#2d2d2d', lineHeight: 1 }}>
              {todaySummary.followUpsToday}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              follow-up{todaySummary.followUpsToday === 1 ? '' : 's'} due
            </Typography>
          </Box>
          <Box sx={{ width: 1, height: 24, bgcolor: 'rgba(0,0,0,0.1)' }} />
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#2d2d2d', lineHeight: 1 }}>
              {todaySummary.visitsLastWeek}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              visit{todaySummary.visitsLastWeek === 1 ? '' : 's'} this week
            </Typography>
          </Box>
        </Box>
      </Paper>

      {/* Recent visits — horizontally scrollable on mobile */}
      {recentVisits.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography
            variant="overline"
            sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 1, ml: 0.5 }}
          >
            Recent visits
          </Typography>
          <Box
            sx={{
              display: 'flex',
              gap: 1.25,
              overflowX: 'auto',
              pb: 1,
              mx: { xs: -1, sm: 0 },
              px: { xs: 1, sm: 0 },
              scrollSnapType: 'x mandatory',
              WebkitOverflowScrolling: 'touch',
              '&::-webkit-scrollbar': { display: 'none' },
              scrollbarWidth: 'none',
            }}
          >
            {recentVisits.map((visit, i) => {
              const contact = contacts.get(visit.contactId);
              const phone = contact?.phone;
              return (
                <Card
                  key={`${visit.contactId}-${i}`}
                  variant="outlined"
                  sx={{
                    flex: '0 0 auto',
                    width: { xs: 220, sm: 260 },
                    scrollSnapAlign: 'start',
                    cursor: contact ? 'pointer' : 'default',
                    transition: 'transform 0.15s, box-shadow 0.15s',
                    '&:hover': contact ? { transform: 'translateY(-2px)', boxShadow: 2 } : undefined,
                  }}
                  onClick={() => {
                    if (contact) navigate(`/dashboard?contact=${contact.id}`);
                  }}
                >
                  <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Typography
                      variant="subtitle2"
                      sx={{
                        fontWeight: 700,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {visit.contactName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {formatTimeAgo(visit.date)}
                      {visit.type && ` · ${visit.type}`}
                    </Typography>
                    {visit.note && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          mt: 0.5,
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          fontSize: '0.8rem',
                          lineHeight: 1.3,
                        }}
                      >
                        {visit.note}
                      </Typography>
                    )}
                    {phone && (
                      <Box sx={{ mt: 0.75, display: 'flex', gap: 0.5 }}>
                        <Button
                          size="small"
                          component="a"
                          href={`tel:${phone}`}
                          onClick={(e) => e.stopPropagation()}
                          startIcon={<PhoneIcon sx={{ fontSize: 14 }} />}
                          sx={{ textTransform: 'none', minWidth: 0, py: 0.25, fontSize: '0.75rem' }}
                        >
                          Call
                        </Button>
                      </Box>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Day Planner (prioritized for field marketers) */}
      {permissions.currentStoreId && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <PlannerIcon color="action" />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Day planner
            </Typography>
            <TextField
              size="small"
              type="date"
              label="Plan for"
              value={planDate}
              onChange={(e) => setPlanDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 160 }}
            />
            <Button
              size="small"
              variant="outlined"
              onClick={loadDayPlan}
              disabled={dayPlanLoading}
              startIcon={dayPlanLoading ? <CircularProgress size={16} /> : undefined}
            >
              {dayPlanLoading ? 'Loading…' : 'Refresh'}
            </Button>
          </Box>
          {dayPlanLoading && !dayPlan ? (
            <Box sx={{ py: 3, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress />
            </Box>
          ) : dayPlan ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Suggested follow-ups */}
              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
                  Suggested follow-ups
                </Typography>
                {dayPlan.followUpTasks.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No follow-ups scheduled for this day.
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {dayPlan.followUpTasks.map((task) => (
                      <Card key={task.contactId} variant="outlined" sx={{ overflow: 'visible' }}>
                        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
                            {task.method === 'email' && <EmailIcon fontSize="small" color="primary" />}
                            {task.method === 'call' && <PhoneIcon fontSize="small" color="success" />}
                            {task.method === 'meeting' && <MeetingIcon fontSize="small" color="warning" />}
                            {task.method === 'text' && <MessageIcon fontSize="small" color="info" />}
                            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                              {task.method === 'email' ? 'Email' : task.method === 'call' ? 'Call' : task.method === 'meeting' ? 'Meeting' : task.method === 'text' ? 'Text' : 'Follow up'}{' '}
                              {task.contactName}
                            </Typography>
                          </Box>
                          {task.eventTitle && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                              {task.eventTitle}
                            </Typography>
                          )}
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {task.message}
                          </Typography>
                          {task.method === 'email' && task.draftEmail && (
                            <Box sx={{ mt: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                Suggested email to copy and paste:
                              </Typography>
                              <Typography
                                component="pre"
                                variant="body2"
                                sx={{
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  fontFamily: 'inherit',
                                  m: 0,
                                }}
                              >
                                {task.draftEmail}
                              </Typography>
                              <Tooltip title="Copy email">
                                <IconButton
                                  size="small"
                                  onClick={() => {
                                    navigator.clipboard.writeText(task.draftEmail!);
                                    setSuccess('Copied to clipboard');
                                    setTimeout(() => setSuccess(''), 2000);
                                  }}
                                  sx={{ mt: 0.5 }}
                                >
                                  <CopyIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          )}
                          <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                            <Button
                              size="small"
                              startIcon={<AIIcon />}
                              onClick={() => setEmailTarget({ contactId: task.contactId, contactName: task.contactName })}
                            >
                              Generate Email
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              color="success"
                              startIcon={<CheckCircleIcon />}
                              onClick={() => handleCompleteFollowUp(task)}
                            >
                              Done
                            </Button>
                          </Box>
                        </CardContent>
                      </Card>
                    ))}
                  </Box>
                )}
              </Box>
              {/* Optimized route */}
              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
                  Planned route (store → opportunities, least distance)
                </Typography>
                {dayPlan.optimizedRoute.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No opportunities to visit. Add opportunities from the Discover page.
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <RouteIcon fontSize="small" color="action" />
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        Start: {dayPlan.storeName}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {dayPlan.storeAddress}
                      </Typography>
                    </Box>
                    {dayPlan.optimizedRoute.map((opp, idx) => {
                      const addr = [opp.address, opp.city, opp.state, opp.zipCode].filter(Boolean).join(', ') || '—';
                      return (
                        <Box
                          key={opp.id}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            pl: 2,
                            borderLeft: 2,
                            borderColor: 'divider',
                          }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 24 }}>
                            {idx + 1}.
                          </Typography>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {opp.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {addr}
                            </Typography>
                          </Box>
                          <Button
                            size="small"
                            variant="outlined"
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Maps
                          </Button>
                        </Box>
                      );
                    })}
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<RouteIcon />}
                      href={`https://www.google.com/maps/dir/${encodeURIComponent(dayPlan.storeAddress)}/${dayPlan.optimizedRoute.map((o) => [o.address, o.city, o.state, o.zipCode].filter(Boolean).join(', ')).filter(Boolean).map(encodeURIComponent).join('/')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ mt: 1, alignSelf: 'flex-start' }}
                    >
                      Open full route in Google Maps
                    </Button>
                  </Box>
                )}
              </Box>
            </Box>
          ) : null}
        </Paper>
      )}

      {/* Calendar Header */}
      <Paper sx={{ p: { xs: 1, sm: 2 }, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: { xs: 1, sm: 2 } }}>
          {/* Title block: arrows hug the month label tightly on mobile so
              there's more horizontal room. minWidth was hard-coded at 200px
              which on a 360px phone screen left almost no space for the
              Today button — replaced with a flexible width. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 2 }, flex: 1, minWidth: 0 }}>
            <IconButton onClick={() => navigateMonth('prev')} size="small" aria-label="Previous month">
              <ChevronLeftIcon />
            </IconButton>
            <Typography
              variant="h6"
              sx={{
                textAlign: 'center',
                flex: 1,
                fontSize: { xs: '1rem', sm: '1.25rem' },
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
            </Typography>
            <IconButton onClick={() => navigateMonth('next')} size="small" aria-label="Next month">
              <ChevronRightIcon />
            </IconButton>
          </Box>
          {/* Today button shrinks to icon-only on mobile to claim back the
              ~70px the "Today" label was eating from the title row. */}
          {isMobile ? (
            <IconButton
              onClick={goToToday}
              size="small"
              aria-label="Jump to today"
              sx={{ ml: 0.5 }}
            >
              <TodayIcon />
            </IconButton>
          ) : (
            <Button
              variant="outlined"
              startIcon={<TodayIcon />}
              onClick={goToToday}
              size="small"
            >
              Today
            </Button>
          )}
        </Box>

        {/* Calendar Grid */}
        <Grid container spacing={isMobile ? 0.25 : 0.5}>
          {/* Day Headers — single letter on mobile so the seven columns
              don't have to fight a ~30px label, full name on desktop. */}
          {dayNames.map(day => (
            <Grid size={{ xs: 12 / 7 }} key={day}>
              <Box
                sx={{
                  textAlign: 'center',
                  py: { xs: 0.5, sm: 1 },
                  fontWeight: 600,
                  color: 'text.secondary',
                  fontSize: { xs: '0.7rem', sm: '0.875rem' },
                }}
              >
                {isMobile ? day[0] : day}
              </Box>
            </Grid>
          ))}

          {/* Calendar Days. Mobile uses a compact dot view (iOS-Calendar
              style) because chip labels at ~50px column width were
              truncating to garbage like "R…" / "Fo…". Desktop keeps the
              existing chip-with-label view since there's room to breathe. */}
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
                    minHeight: { xs: 56, sm: 100 },
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
                      setPlanDate(date.toISOString().split('T')[0]);
                    }
                  }}
                >
                  <CardContent sx={{ p: { xs: 0.5, sm: 1 }, '&:last-child': { pb: { xs: 0.5, sm: 1 } } }}>
                    {date && (
                      <>
                        {isMobile ? (
                          // ── Mobile cell: number on top, up to 4 colored
                          // dots underneath (one per event, capped). When
                          // more than 4 events, the 4th dot becomes a tiny
                          // "+N" pill so the overflow is still visible.
                          <Box
                            sx={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 0.5,
                            }}
                          >
                            <Typography
                              variant="body2"
                              sx={{
                                fontWeight: isToday ? 700 : 500,
                                color: isToday ? 'primary.main' : 'text.primary',
                                fontSize: '0.85rem',
                                lineHeight: 1,
                              }}
                            >
                              {date.getDate()}
                            </Typography>
                            {dayEvents.length > 0 && (
                              <Box
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 0.4,
                                  flexWrap: 'wrap',
                                  maxWidth: '100%',
                                }}
                              >
                                {dayEvents.slice(0, dayEvents.length > 4 ? 3 : 4).map((event) => {
                                  const palette = event.status === 'completed'
                                    ? 'success'
                                    : event.status === 'cancelled'
                                      ? 'default'
                                      : getMethodColor(event.type);
                                  // Map our palette key to a real CSS color via theme
                                  const bg = palette === 'default'
                                    ? theme.palette.text.disabled
                                    : (theme.palette as any)[palette]?.main || theme.palette.primary.main;
                                  return (
                                    <Box
                                      key={event.id}
                                      sx={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: '50%',
                                        bgcolor: bg,
                                        opacity: event.status === 'cancelled' ? 0.4 : 1,
                                      }}
                                    />
                                  );
                                })}
                                {dayEvents.length > 4 && (
                                  <Typography
                                    sx={{
                                      fontSize: '0.6rem',
                                      lineHeight: 1,
                                      color: 'text.secondary',
                                      fontWeight: 600,
                                    }}
                                  >
                                    +{dayEvents.length - 3}
                                  </Typography>
                                )}
                              </Box>
                            )}
                          </Box>
                        ) : (
                          // ── Desktop cell: number + count badge + chip
                          // labels. Plenty of room here so the original
                          // detailed view stays.
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
                      </>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
        {/* Mobile-only dot legend so the colored circles aren't a mystery.
            Hidden on desktop where the chips show full labels and icons. */}
        {isMobile && (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1.5,
              justifyContent: 'center',
              mt: 1.5,
              pt: 1.5,
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            {[
              { key: 'meeting', label: 'Visit', color: theme.palette.warning.main },
              { key: 'call', label: 'Call', color: theme.palette.success.main },
              { key: 'email', label: 'Email', color: theme.palette.primary.main },
              { key: 'text', label: 'Text', color: theme.palette.info.main },
            ].map((item) => (
              <Box key={item.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: item.color }} />
                <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                  {item.label}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
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
                      {event.contactId && event.contactName && (
                        <Tooltip title="Generate Email">
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => setEmailTarget({ contactId: event.contactId!, contactName: event.contactName! })}
                          >
                            <AIIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
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

      <Suspense fallback={null}>
        {emailTarget && (
        <GenerateEmailDialog
          open
          onClose={() => setEmailTarget(null)}
          contactId={emailTarget.contactId}
          contactName={emailTarget.contactName}
          onReachoutAdded={() => {
            loadDayPlan();
            loadCalendarData();
          }}
        />
        )}
      </Suspense>
    </Box>
  );
}
