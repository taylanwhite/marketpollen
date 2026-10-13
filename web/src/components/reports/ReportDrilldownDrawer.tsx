import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Drawer,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import {
  Close as CloseIcon,
  Search as SearchIcon,
  Event as EventIcon,
  Person as PersonIcon,
  Cake as CakeIcon,
  Explore as ExploreIcon,
} from '@mui/icons-material';
import { CalendarEvent, Contact, Opportunity } from '../../types';
import {
  contactDisplayName,
  EVENT_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  formatShortDate,
  OPPORTUNITY_STATUS_LABELS,
  REACHOUT_TYPE_LABELS,
  type ReachoutRow,
} from '../../utils/reportAggregations';

export type DrilldownKind = 'contacts' | 'events' | 'reachouts' | 'opportunities';

export interface DrilldownState {
  title: string;
  subtitle?: string;
  kind: DrilldownKind;
  contacts?: Contact[];
  events?: CalendarEvent[];
  reachouts?: ReachoutRow[];
  opportunities?: Opportunity[];
}

interface ReportDrilldownDrawerProps {
  open: boolean;
  onClose: () => void;
  drilldown: DrilldownState | null;
  isMobile: boolean;
  businesses: Map<string, string>;
  onOpenContact: (contact: Contact) => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenOpportunity: (opportunity: Opportunity) => void;
}

export function ReportDrilldownDrawer({
  open,
  onClose,
  drilldown,
  isMobile,
  businesses,
  onOpenContact,
  onOpenEvent,
  onOpenOpportunity,
}: ReportDrilldownDrawerProps) {
  const [search, setSearch] = useState('');

  useEffect(() => {
    setSearch('');
  }, [drilldown]);

  const count = drilldown
    ? (drilldown.contacts?.length ??
        drilldown.events?.length ??
        drilldown.reachouts?.length ??
        drilldown.opportunities?.length ??
        0)
    : 0;

  const filteredContacts = useMemo(() => {
    const items = drilldown?.contacts || [];
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((c) => {
      const name = contactDisplayName(c).toLowerCase();
      const business = (businesses.get(c.businessId) || '').toLowerCase();
      return (
        name.includes(term) ||
        business.includes(term) ||
        (c.email || '').toLowerCase().includes(term) ||
        (c.phone || '').includes(term)
      );
    });
  }, [drilldown?.contacts, search, businesses]);

  const filteredEvents = useMemo(() => {
    const items = drilldown?.events || [];
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((e) => {
      return (
        e.title.toLowerCase().includes(term) ||
        (e.description || '').toLowerCase().includes(term) ||
        (EVENT_TYPE_LABELS[e.type] || e.type).toLowerCase().includes(term)
      );
    });
  }, [drilldown?.events, search]);

  const filteredReachouts = useMemo(() => {
    const items = drilldown?.reachouts || [];
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((row) => {
      const name = contactDisplayName(row.contact).toLowerCase();
      return (
        name.includes(term) ||
        row.businessName.toLowerCase().includes(term) ||
        (row.reachout.note || '').toLowerCase().includes(term)
      );
    });
  }, [drilldown?.reachouts, search]);

  const filteredOpportunities = useMemo(() => {
    const items = drilldown?.opportunities || [];
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((o) => {
      return (
        o.name.toLowerCase().includes(term) ||
        (o.address || '').toLowerCase().includes(term) ||
        (o.city || '').toLowerCase().includes(term)
      );
    });
  }, [drilldown?.opportunities, search]);

  const handleClose = () => {
    setSearch('');
    onClose();
  };

  const kindIcon =
    drilldown?.kind === 'events' ? (
      <EventIcon sx={{ color: '#d4a017' }} />
    ) : drilldown?.kind === 'reachouts' ? (
      <CakeIcon sx={{ color: '#d4a017' }} />
    ) : drilldown?.kind === 'opportunities' ? (
      <ExploreIcon sx={{ color: '#d4a017' }} />
    ) : (
      <PersonIcon sx={{ color: '#d4a017' }} />
    );

  return (
    <Drawer
      anchor={isMobile ? 'bottom' : 'right'}
      open={open}
      onClose={handleClose}
      PaperProps={{
        sx: {
          width: isMobile ? '100%' : 480,
          height: isMobile ? '88vh' : '100%',
          borderRadius: isMobile ? '16px 16px 0 0' : 0,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <Box sx={{ px: 2.5, pt: 2.5, pb: 2, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2,
              bgcolor: 'rgba(245, 200, 66, 0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {kindIcon}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              {drilldown?.title || 'Details'}
            </Typography>
            {drilldown?.subtitle && (
              <Typography variant="body2" color="text.secondary">
                {drilldown.subtitle}
              </Typography>
            )}
            <Chip
              size="small"
              label={`${count} ${count === 1 ? 'record' : 'records'}`}
              sx={{ mt: 1, bgcolor: 'rgba(245, 200, 66, 0.16)', fontWeight: 600 }}
            />
          </Box>
          <IconButton onClick={handleClose} aria-label="Close">
            <CloseIcon />
          </IconButton>
        </Box>
        <TextField
          fullWidth
          size="small"
          placeholder="Search these records…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mt: 2 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {count === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
            Nothing to show for this slice yet.
          </Typography>
        )}

        {drilldown?.kind === 'contacts' && (
          <List disablePadding>
            {filteredContacts.map((contact) => (
              <ListItemButton
                key={contact.id}
                onClick={() => onOpenContact(contact)}
                sx={{ py: 1.5, px: 2.5, borderBottom: '1px solid rgba(0,0,0,0.04)' }}
              >
                <ListItemText
                  primary={contactDisplayName(contact)}
                  secondary={[
                    businesses.get(contact.businessId),
                    contact.email || contact.phone,
                    contact.status ? contact.status : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  primaryTypographyProps={{ fontWeight: 600 }}
                />
              </ListItemButton>
            ))}
          </List>
        )}

        {drilldown?.kind === 'events' && (
          <List disablePadding>
            {filteredEvents.map((event) => (
              <ListItemButton
                key={event.id}
                onClick={() => onOpenEvent(event)}
                sx={{ py: 1.5, px: 2.5, borderBottom: '1px solid rgba(0,0,0,0.04)', alignItems: 'flex-start' }}
              >
                <ListItemText
                  primary={event.title}
                  secondary={`${formatShortDate(event.date)}${event.startTime ? ` · ${event.startTime}` : ''} · ${EVENT_TYPE_LABELS[event.type] || event.type}`}
                  primaryTypographyProps={{ fontWeight: 600 }}
                />
                <Chip
                  size="small"
                  label={EVENT_STATUS_LABELS[event.status || 'scheduled'] || event.status || 'Scheduled'}
                  sx={{ ml: 1, mt: 0.5 }}
                />
              </ListItemButton>
            ))}
          </List>
        )}

        {drilldown?.kind === 'reachouts' && (
          <List disablePadding>
            {filteredReachouts.map((row) => (
              <ListItemButton
                key={row.reachout.id}
                onClick={() => onOpenContact(row.contact)}
                sx={{ py: 1.5, px: 2.5, borderBottom: '1px solid rgba(0,0,0,0.04)' }}
              >
                <ListItemText
                  primary={contactDisplayName(row.contact)}
                  secondary={
                    <>
                      {row.businessName} · {formatShortDate(row.reachout.date)} ·{' '}
                      {REACHOUT_TYPE_LABELS[row.reachout.type || 'other']}
                      {row.mouths > 0 ? ` · ${row.mouths.toLocaleString()} bites` : ''}
                      {row.reachout.note ? (
                        <Box component="span" sx={{ display: 'block', mt: 0.4 }} >
                          {row.reachout.note.length > 110
                            ? `${row.reachout.note.slice(0, 110)}…`
                            : row.reachout.note}
                        </Box>
                      ) : null}
                    </>
                  }
                  primaryTypographyProps={{ fontWeight: 600 }}
                />
              </ListItemButton>
            ))}
          </List>
        )}

        {drilldown?.kind === 'opportunities' && (
          <List disablePadding>
            {filteredOpportunities.map((opp) => (
              <ListItemButton
                key={opp.id}
                onClick={() => onOpenOpportunity(opp)}
                sx={{ py: 1.5, px: 2.5, borderBottom: '1px solid rgba(0,0,0,0.04)' }}
              >
                <ListItemText
                  primary={opp.name}
                  secondary={[opp.address, opp.city, opp.state].filter(Boolean).join(', ') || 'No address'}
                  primaryTypographyProps={{ fontWeight: 600 }}
                />
                <Chip
                  size="small"
                  label={OPPORTUNITY_STATUS_LABELS[opp.status] || opp.status}
                  sx={{ ml: 1 }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
    </Drawer>
  );
}
