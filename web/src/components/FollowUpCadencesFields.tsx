import { useState } from 'react';
import { Box, Button, IconButton, MenuItem, TextField, Typography } from '@mui/material';
import { Add as AddIcon, DeleteOutline as DeleteIcon } from '@mui/icons-material';
import type { StorePerson } from '../hooks/useStorePeople';
import {
  FOLLOW_UP_CADENCES,
  MAX_CADENCES_PER_CONTACT,
  MAX_CADENCE_NOTE,
  MAX_FOLLOW_UP_DAYS,
  newDraft,
  type FollowUpCadenceDraft,
} from '../utils/followUpCadence';

function CadenceRow({
  value,
  onChange,
  onRemove,
  people,
  creatorName,
  disabled,
}: {
  value: FollowUpCadenceDraft;
  onChange: (next: FollowUpCadenceDraft) => void;
  onRemove: () => void;
  people: StorePerson[];
  creatorName?: string | null;
  disabled: boolean;
}) {
  const isPresetDays = FOLLOW_UP_CADENCES.some((option) => option.days === value.everyDays);
  // Stays in custom mode while typing, even through a number like 30 that matches a preset.
  const [customMode, setCustomMode] = useState(() => !isPresetDays);
  const [draft, setDraft] = useState<string | null>(null);
  const preset = customMode ? 'custom' : String(value.everyDays);
  const next = value.nextDate ? new Date(value.nextDate) : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, alignItems: { sm: 'flex-start' } }}>
        <TextField
          select
          size="small"
          label="How often"
          value={preset}
          onChange={(event) => {
            const choice = event.target.value;
            setDraft(null);
            setCustomMode(choice === 'custom');
            if (choice !== 'custom') onChange({ ...value, everyDays: Number(choice) });
          }}
          disabled={disabled}
          fullWidth
        >
          {FOLLOW_UP_CADENCES.map((option) => (
            <MenuItem key={option.days} value={String(option.days)}>{option.label}</MenuItem>
          ))}
          <MenuItem value="custom">Custom…</MenuItem>
        </TextField>
        {preset === 'custom' && (
          <TextField
            size="small"
            label="Every how many days"
            type="number"
            value={draft ?? String(value.everyDays)}
            onChange={(event) => {
              setDraft(event.target.value);
              const days = Math.round(Number(event.target.value));
              if (event.target.value.trim() && Number.isFinite(days) && days > 0) {
                onChange({ ...value, everyDays: Math.min(days, MAX_FOLLOW_UP_DAYS) });
              }
            }}
            onBlur={() => setDraft(null)}
            inputProps={{ min: 1, max: MAX_FOLLOW_UP_DAYS, inputMode: 'numeric' }}
            disabled={disabled}
            sx={{ minWidth: { sm: 160 } }}
          />
        )}
        {people.length > 0 && (
          <TextField
            select
            size="small"
            label="Remind"
            value={value.assignee}
            onChange={(event) => onChange({ ...value, assignee: event.target.value })}
            disabled={disabled}
            fullWidth
            // Shows the "whoever added this contact" choice instead of a blank box.
            SelectProps={{ displayEmpty: true }}
            InputLabelProps={{ shrink: true }}
          >
            <MenuItem value="">{creatorName ? `${creatorName} (added this contact)` : 'Whoever added this contact'}</MenuItem>
            {people.map((person) => (
              <MenuItem key={person.id} value={person.id}>{person.name}</MenuItem>
            ))}
          </TextField>
        )}
        <IconButton aria-label="Remove this schedule" onClick={onRemove} disabled={disabled} sx={{ alignSelf: { xs: 'flex-end', sm: 'center' } }}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Box>
      <TextField
        size="small"
        label="Why (optional)"
        placeholder="e.g. Ask about holiday catering"
        value={value.note}
        onChange={(event) => onChange({ ...value, note: event.target.value.slice(0, MAX_CADENCE_NOTE) })}
        disabled={disabled}
        fullWidth
        helperText={next ? `Next one ${next.toLocaleDateString()}. Shown in the reminder email.` : 'Shown in the reminder email'}
      />
    </Box>
  );
}

/**
 * Repeating follow-ups on a contact. Each one has how often, who gets the
 * reminder, and an optional note on why. The next one lands that many days
 * after the latest visit.
 */
export function FollowUpCadencesFields({
  value,
  onChange,
  people,
  creatorName,
  disabled = false,
}: {
  value: FollowUpCadenceDraft[];
  onChange: (next: FollowUpCadenceDraft[]) => void;
  people: StorePerson[];
  /** Shown for "no one picked": reminders then go to whoever added the contact. */
  creatorName?: string | null;
  disabled?: boolean;
}) {
  const add = () => onChange([...value, newDraft()]);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Repeating follow-ups</Typography>
        <Typography variant="body2" color="text.secondary">
          {value.length === 0 ? 'None yet. ' : ''}Counted from the latest visit, call, or email. The person picked gets an email when one is due.
        </Typography>
      </Box>
      {value.map((cadence, index) => (
        <CadenceRow
          key={cadence.id}
          value={cadence}
          onChange={(next) => onChange(value.map((c, i) => (i === index ? next : c)))}
          onRemove={() => onChange(value.filter((_, i) => i !== index))}
          people={people}
          creatorName={creatorName}
          disabled={disabled}
        />
      ))}
      {value.length < MAX_CADENCES_PER_CONTACT && (
        <Button startIcon={<AddIcon />} onClick={add} disabled={disabled} sx={{ alignSelf: 'flex-start' }}>
          {value.length === 0 ? 'Add a repeating follow-up' : 'Add another'}
        </Button>
      )}
    </Box>
  );
}
