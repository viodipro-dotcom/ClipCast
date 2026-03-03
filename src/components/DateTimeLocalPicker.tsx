import * as React from 'react';
import {
  Box,
  Button,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Popover,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  CalendarToday as CalendarTodayIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

function getDaysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function parseDateTimeLocal(v: string): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
}

function toDateTimeLocal(parts: { year: number; month: number; day: number; hour: number; minute: number }) {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export interface DateTimeLocalPickerProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  helperText?: string;
}

export default function DateTimeLocalPicker({ label, value, onChange, helperText }: DateTimeLocalPickerProps) {
  const { t, i18n } = useTranslation();
  const monthNamesLong = React.useMemo(() => t('monthNamesLong', { returnObjects: true }) as string[], [i18n.language, t]);
  const weekdayNamesShort = React.useMemo(() => t('weekdayNamesShort', { returnObjects: true }) as string[], [i18n.language, t]);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);

  const parsed = React.useMemo(() => parseDateTimeLocal(value), [value]);

  const [calendarMonth, setCalendarMonth] = React.useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0, 0);
  });

  React.useEffect(() => {
    if (!anchorEl) return;
    if (parsed) {
      setCalendarMonth(new Date(parsed.year, parsed.month - 1, 1, 12, 0, 0, 0));
    } else {
      const now = new Date();
      setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0, 0));
    }
  }, [anchorEl, parsed]);

  const setDate = (day: number) => {
    const base = parsed ?? (() => {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), hour: now.getHours(), minute: now.getMinutes() };
    })();
    onChange(toDateTimeLocal({ ...base, year: calendarMonth.getFullYear(), month: calendarMonth.getMonth() + 1, day }));
  };

  const setTime = (hour: number, minute: number) => {
    const base = parsed ?? (() => {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), hour: now.getHours(), minute: now.getMinutes() };
    })();
    onChange(toDateTimeLocal({ ...base, hour, minute }));
  };

  const isSameDay = (y: number, m: number, d: number) => {
    if (!parsed) return false;
    return parsed.year === y && parsed.month === m && parsed.day === d;
  };

  const isToday = (y: number, m: number, d: number) => {
    const now = new Date();
    return now.getFullYear() === y && now.getMonth() + 1 === m && now.getDate() === d;
  };

  const isPastDay = (y: number, m: number, d: number) => {
    const now = new Date();
    const a = new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
    const b = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0).getTime();
    return a < b;
  };

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(calendarMonth);
    const firstDayOfMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1, 12, 0, 0, 0);
    const firstDay = firstDayOfMonth.getDay(); // 0..6
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);

    const monthNames = monthNamesLong;
    const dayNames = weekdayNamesShort;

    const y = calendarMonth.getFullYear();
    const m = calendarMonth.getMonth() + 1;

    const calendarWidth = 280;

    return (
      <Box sx={{ p: 2, width: calendarWidth, minWidth: calendarWidth, boxSizing: 'border-box' }}>
        {/* Header: left arrow | month year | right arrow */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <IconButton
            size="small"
            onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1, 12, 0, 0, 0))}
            sx={{ flexShrink: 0 }}
          >
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, textAlign: 'center', flex: 1, minWidth: 0 }}>
            {monthNames[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}
          </Typography>
          <IconButton
            size="small"
            onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1, 12, 0, 0, 0))}
            sx={{ flexShrink: 0 }}
          >
            <ChevronRightIcon />
          </IconButton>
        </Stack>

        {/* Weekday names: 7-column grid */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, mb: 1 }}>
          {dayNames.map((dn) => (
            <Typography key={dn} variant="caption" align="center" sx={{ fontWeight: 600, color: 'text.secondary' }}>
              {dn}
            </Typography>
          ))}
        </Box>

        {/* Days: 7-column grid so layout stays correct */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
          {days.map((day, idx) => {
            if (day === null) {
              return <Box key={`empty-${idx}`} />;
            }
            const selected = isSameDay(y, m, day);
            const today = isToday(y, m, day);
            const disabled = isPastDay(y, m, day);
            return (
              <Button
                key={day}
                fullWidth
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  setDate(day);
                }}
                sx={{
                  minWidth: 0,
                  width: '100%',
                  aspectRatio: '1',
                  maxHeight: 36,
                  p: 0,
                  minHeight: 32,
                  borderRadius: 1,
                  backgroundColor: selected ? 'primary.main' : 'transparent',
                  color: selected
                    ? 'primary.contrastText'
                    : disabled
                      ? 'text.disabled'
                      : today
                        ? 'primary.main'
                        : 'text.primary',
                  fontWeight: today || selected ? 600 : 400,
                  border: today && !selected ? '1px solid' : 'none',
                  borderColor: today && !selected ? 'primary.main' : 'transparent',
                  '&:hover': {
                    backgroundColor: selected ? 'primary.dark' : 'action.hover',
                  },
                }}
              >
                {day}
              </Button>
            );
          })}
        </Box>

        <Stack direction="row" justifyContent="space-between" sx={{ mt: 2 }}>
          <Button
            size="small"
            onClick={() => {
              onChange('');
              setAnchorEl(null);
            }}
            sx={{ textTransform: 'none' }}
          >
            {t('clear')}
          </Button>
          <Button
            size="small"
            onClick={() => {
              const now = new Date();
              const base = parsed ?? { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), hour: now.getHours(), minute: now.getMinutes() };
              onChange(toDateTimeLocal({ ...base, year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }));
              setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0, 0));
              setAnchorEl(null);
            }}
            sx={{ textTransform: 'none' }}
          >
            {t('today')}
          </Button>
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t('time')}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
          <FormControl size="small" sx={{ minWidth: 90 }}>
            <InputLabel>{t('hour')}</InputLabel>
            <Select
              label={t('hour')}
              value={String((parsed?.hour ?? 9)).padStart(2, '0')}
              onChange={(e) => setTime(Number(e.target.value), parsed?.minute ?? 0)}
            >
              {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map((h) => (
                <MenuItem key={h} value={h}>
                  {h}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 90 }}>
            <InputLabel>{t('minute')}</InputLabel>
            <Select
              label={t('minute')}
              value={String((parsed?.minute ?? 0)).padStart(2, '0')}
              onChange={(e) => setTime(parsed?.hour ?? 9, Number(e.target.value))}
            >
              {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map((mm) => (
                <MenuItem key={mm} value={mm}>
                  {mm}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Box>
    );
  };

  return (
    <>
      <TextField
        inputRef={inputRef}
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('dateTimeExample')}
        fullWidth
        InputLabelProps={{ shrink: true }}
        helperText={helperText}
        InputProps={{
          endAdornment: (
            <IconButton
              size="small"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const anchor =
                  inputRef.current?.closest('.MuiTextField-root') ||
                  inputRef.current ||
                  (e.currentTarget.closest('.MuiInputBase-root') as HTMLElement | null) ||
                  e.currentTarget;
                setAnchorEl(anchor as HTMLElement);
              }}
            >
              <CalendarTodayIcon fontSize="small" />
            </IconButton>
          ),
        }}
      />
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: { overflow: 'visible', minWidth: 320 },
          },
        }}
      >
        {renderCalendar()}
      </Popover>
    </>
  );
}

