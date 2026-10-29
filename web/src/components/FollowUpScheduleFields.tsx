import { useState } from 'react';
import { Box, MenuItem, TextField } from '@mui/material';
import type { StorePerson } from '../hooks/useStorePeople';
import { FOLLOW_UP_CADENCES, MAX_FOLLOW_UP_DAYS, type FollowUpSchedule } from '../utils/followUpCadence';

/**
 * Repeating follow-up picker: how often, and who gets the reminder. The next
 * follow-up lands that many days after the latest visit.
 */
export function FollowUpScheduleFields({
  value,
  onChange,
  people,
  creatorName,
  disabled = false,
}: {
  value: FollowUpSchedule;
  onChange: (next: FollowUpSchedule) => void;
  people: StorePerson[];
  /** Shown for "no one picked": reminders then go to whoever added the contact. */
  creatorName?: string | null;
  disabled?: boolean;
}) {
  const isPresetDays = (days: number | null) => days != null && FOLLOW_UP_CADENCES.some((option) => option.days === days);
  // Stays in custom mode while typing, even through a number like 30 that matches a preset.
  const [customMode, setCustomMode] = useState(() => value.everyDays != null && !isPresetDays(value.everyDays));
  const [draft, setDraft] = useState<string | null>(null);
  const preset = value.everyDays == null ? 'none' : customMode ? 'custom' : String(value.everyDays);

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
      <TextField
        select
        label="Follow-up schedule"
        value={preset}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(null);
          setCustomMode(next === 'custom');
          if (next === 'none') onChange({ ...value, everyDays: null });
          else if (next === 'custom') onChange({ ...value, everyDays: value.everyDays ?? 45 });
          else onChange({ ...value, everyDays: Number(next) });
        }}
        disabled={disabled}
        fullWidth
        helperText={value.everyDays ? 'Counted from the latest visit, call, or email' : 'No repeating reminder'}
      >
        <MenuItem value="none">No schedule</MenuItem>
        {FOLLOW_UP_CADENCES.map((option) => (
          <MenuItem key={option.days} value={String(option.days)}>{option.label}</MenuItem>
        ))}
        <MenuItem value="custom">Custom…</MenuItem>
      </TextField>
      {preset === 'custom' && (
        <TextField
          label="Every how many days"
          type="number"
          value={draft ?? String(value.everyDays ?? '')}
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
      {value.everyDays != null && people.length > 0 && (
        <TextField
          select
          label="Remind"
          value={value.assignee}
          onChange={(event) => onChange({ ...value, assignee: event.target.value })}
          disabled={disabled}
          fullWidth
          helperText="Gets an email when it's due"
        >
          <MenuItem value="">{creatorName ? `${creatorName} (added this contact)` : 'Whoever added this contact'}</MenuItem>
          {people.map((person) => (
            <MenuItem key={person.id} value={person.id}>{person.name}</MenuItem>
          ))}
        </TextField>
      )}
    </Box>
  );
}
