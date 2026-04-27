import * as React from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Autocomplete,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Popover,
} from '@mui/material';
import { Close as CloseIcon, ExpandMore as ExpandMoreIcon, Add as AddIcon, CalendarToday as CalendarTodayIcon, ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon } from '@mui/icons-material';
import { parseTimesCsv, minutesToHHmm, timeToMinutes, normalizeTimesCsv } from '../utils';
import { useTranslation } from 'react-i18next';

export interface PlannerDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (plan: PlannerPlan) => void;
  autoPlanEnabled: boolean;
  onAutoPlanEnabledChange: (value: boolean) => void;
  onSaveDefaults: (plan: { startDate: Date; times: string[]; timeZoneId: string; videosPerDay: number; applyTo: 'all' | 'youtube' | 'instagram' | 'tiktok' }) => void;
  timeZoneId: string;
  timeZoneOptions: string[];
  systemTimeZone: string;
  onTimeZoneChange: (value: string) => void;
  unscheduledCount: number;
  selectedCount: number; // Number of selected videos (like PublishDialog)
}

export interface PlannerPlan {
  applyTo?: 'all' | 'youtube' | 'instagram' | 'tiktok';
  mode: 'simple' | 'custom';
  preset?: '3/day' | '4/day' | 'hourly' | null;
  startDate?: Date;
  times?: string[]; // HH:mm format
  timeZoneId: string;
  videosPerDay?: number;
  // Custom mode options
  spreadStart?: string; // HH:mm
  spreadEnd?: string; // HH:mm
  spreadStep?: number; // minutes
  spreadCount?: number; // number of slots
  multipleJobsPerVideo?: boolean;
  conflictDetection?: boolean;
}

// Format date as "7 Jan 2026"
function formatDateUnambiguous(date: Date, months: string[]): string {
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// Parse date from "7 Jan 2026" format
function parseDateUnambiguous(str: string, months: string[]): Date | null {
  const parts = str.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = months.findIndex((m) => m.toLowerCase() === parts[1].toLowerCase());
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || month === -1 || isNaN(year)) return null;
  return new Date(year, month, day);
}

export default function PlannerDialog({
  open,
  onClose,
  onApply,
  autoPlanEnabled,
  onAutoPlanEnabledChange,
  onSaveDefaults,
  timeZoneId,
  timeZoneOptions,
  systemTimeZone,
  onTimeZoneChange,
  selectedCount,
}: PlannerDialogProps) {
  const { t, i18n } = useTranslation();
  const monthNamesShort = React.useMemo(() => t('monthNamesShort', { returnObjects: true }) as string[], [i18n.language, t]);
  const monthNamesLong = React.useMemo(() => t('monthNamesLong', { returnObjects: true }) as string[], [i18n.language, t]);
  const weekdayNamesShort = React.useMemo(() => t('weekdayNamesShort', { returnObjects: true }) as string[], [i18n.language, t]);

  const todayMidnight = React.useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  
  // Calculate system timezone offset in GMT format
  const systemTzOffset = React.useMemo(() => {
    const offsetMinutes = new Date().getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const offsetMins = Math.abs(offsetMinutes) % 60;
    const sign = offsetMinutes <= 0 ? '+' : '-';
    return `(GMT${sign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}) ${t('localTime')}`;
  }, [t]);

  const [applyTo, setApplyTo] = React.useState<'all' | 'youtube' | 'instagram' | 'tiktok'>('all');
  const [mode, setMode] = React.useState<'simple' | 'custom'>('simple');
  const [preset, setPreset] = React.useState<'3/day' | '4/day' | 'hourly' | null>(null);
  const [startDate, setStartDate] = React.useState<Date | null>(null);
  const [dateInputValue, setDateInputValue] = React.useState<string>('');
  const [showAddTime, setShowAddTime] = React.useState<boolean>(false);
  const [newTimeHour, setNewTimeHour] = React.useState<string>('09');
  const [newTimeMinute, setNewTimeMinute] = React.useState<string>('00');
  
  // Simple mode state
  const [simpleSlotsPerDay, setSimpleSlotsPerDay] = React.useState<number>(0);
  const [simpleTimes, setSimpleTimes] = React.useState<string[]>([]);
  const [simpleTimeZoneId, setSimpleTimeZoneId] = React.useState<string>(timeZoneId);
  
  // Custom mode state
  const [spreadStart, setSpreadStart] = React.useState<string>('');
  const [spreadEnd, setSpreadEnd] = React.useState<string>('');
  const [spreadStartHour, setSpreadStartHour] = React.useState<string>('09');
  const [spreadStartMinute, setSpreadStartMinute] = React.useState<string>('00');
  const [spreadEndHour, setSpreadEndHour] = React.useState<string>('18');
  const [spreadEndMinute, setSpreadEndMinute] = React.useState<string>('00');
  const [spreadStep, setSpreadStep] = React.useState<number>(60);
  const [spreadCount, setSpreadCount] = React.useState<number>(0);
  const [timesCsv, setTimesCsv] = React.useState<string>('');
  const [customTimeZoneId, setCustomTimeZoneId] = React.useState<string>(timeZoneId);
  const [multipleJobsPerVideo, setMultipleJobsPerVideo] = React.useState<boolean>(false);
  const [conflictDetection, setConflictDetection] = React.useState<boolean>(true);
  const [datePickerAnchor, setDatePickerAnchor] = React.useState<HTMLElement | null>(null);
  const dateInputRef = React.useRef<HTMLInputElement>(null);
  const [calendarMonth, setCalendarMonth] = React.useState<Date>(() => {
    const today = new Date();
    // Create date at noon to avoid timezone/DST issues
    return new Date(today.getFullYear(), today.getMonth(), 1, 12, 0, 0, 0);
  });

  // Initialize defaults only once (do not reset on every open).
  const didInitDefaultsRef = React.useRef(false);

  const getDraftDefaults = React.useCallback(() => {
    const tz = mode === 'simple' ? simpleTimeZoneId : customTimeZoneId;
    const times =
      mode === 'simple'
        ? simpleTimes
        : timesCsv.trim()
          ? parseTimesCsv(timesCsv).map(minutesToHHmm)
          : [];
    const perDay = times.length > 0 ? times.length : 0;
    const sd = startDate || new Date();
    const normalizedStart = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate());
    normalizedStart.setHours(0, 0, 0, 0);
    if (!times.length) return null;
    return {
      startDate: normalizedStart,
      times,
      timeZoneId: tz,
      videosPerDay: perDay,
      applyTo,
    };
  }, [applyTo, customTimeZoneId, mode, simpleTimes, simpleTimeZoneId, startDate, timesCsv]);
  
  // Set defaults on first open only - load from localStorage if available.
  React.useEffect(() => {
    if (!open) return;
    if (didInitDefaultsRef.current) return;

    didInitDefaultsRef.current = true;
    setMode('simple');
    setPreset(null);
    
    // Try to load saved plan settings from localStorage
    let savedTimes: string[] = [];
    let savedStartDate: Date | null = null;
    
    try {
      const timesStr = localStorage.getItem('planSettings_times');
      if (timesStr) {
        savedTimes = JSON.parse(timesStr);
        if (Array.isArray(savedTimes) && savedTimes.length > 0) {
          setSimpleTimes(savedTimes);
          setSimpleSlotsPerDay(savedTimes.length);
        }
      }
      
      const tzStr = localStorage.getItem('planSettings_timeZoneId');
      if (tzStr) {
        // tzStr might be IANA (old format) or label (new format)
        // Check if it's already a label (starts with "(GMT") or is SYSTEM
        if (tzStr === 'SYSTEM' || tzStr.startsWith('(GMT')) {
          setSimpleTimeZoneId(tzStr);
          setCustomTimeZoneId(tzStr);
        } else {
          // It's IANA (old format) - for backward compatibility, use current timeZoneId prop
          // (which should be a label now)
          setSimpleTimeZoneId(timeZoneId);
          setCustomTimeZoneId(timeZoneId);
        }
      } else {
        setSimpleTimeZoneId(timeZoneId);
        setCustomTimeZoneId(timeZoneId);
      }
      
      const dateStr = localStorage.getItem('planSettings_startDate');
      if (dateStr) {
        const parsed = new Date(dateStr + 'T00:00:00');
        if (!isNaN(parsed.getTime())) {
          parsed.setHours(0, 0, 0, 0);
          savedStartDate = parsed;
          setStartDate(parsed);
          setDateInputValue(formatDateUnambiguous(parsed, monthNamesShort));
          setCalendarMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1, 12, 0, 0, 0));
        }
      }
      
      const applyToStr = localStorage.getItem('planSettings_applyTo');
      if (applyToStr === 'youtube' || applyToStr === 'instagram' || applyToStr === 'tiktok' || applyToStr === 'all') {
        setApplyTo(applyToStr);
      }
    } catch {
      // If loading fails, use defaults
    }
    
    // If no saved settings, use empty defaults
    if (savedTimes.length === 0) {
      setSimpleTimes([]);
      setSimpleSlotsPerDay(0);
    }
    
    if (!savedStartDate) {
      // Default start date = today (midnight) only if no saved date
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setStartDate(today);
      setDateInputValue(formatDateUnambiguous(today, monthNamesShort));
      setCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1, 12, 0, 0, 0));
    }
    
    // Initialize other fields
    setSpreadStart('');
    setSpreadEnd('');
    setSpreadStep(60);
    setSpreadCount(0);
    setTimesCsv('');
    setSpreadStartHour('09');
    setSpreadStartMinute('00');
    setSpreadEndHour('18');
    setSpreadEndMinute('00');
    setNewTimeHour('09');
    setNewTimeMinute('00');
  }, [open, timeZoneId]);

  const handleClose = () => {
    const draft = getDraftDefaults();
    if (draft) {
      // Keep global defaults in sync even if user closes without applying.
      onSaveDefaults(draft);
    }
    onClose();
  };

  // Close transient UI when the dialog closes (but keep the plan draft).
  React.useEffect(() => {
    if (open) return;
    setDatePickerAnchor(null);
    setShowAddTime(false);
  }, [open]);
  
  // Sync timezone when prop changes
  React.useEffect(() => {
    setSimpleTimeZoneId(timeZoneId);
    setCustomTimeZoneId(timeZoneId);
  }, [timeZoneId]);

  // Initialize date input value
  React.useEffect(() => {
    if (startDate) {
      setDateInputValue(formatDateUnambiguous(startDate, monthNamesShort));
    } else {
      setDateInputValue('');
    }
  }, [startDate, monthNamesShort]);

  // Update simple times when preset changes
  React.useEffect(() => {
    if (mode === 'simple' && preset) {
      if (preset === '3/day') {
        setSimpleTimes(['09:00', '13:00', '18:00']);
        setSimpleSlotsPerDay(3);
      } else if (preset === '4/day') {
        setSimpleTimes(['09:00', '12:00', '15:00', '18:00']);
        setSimpleSlotsPerDay(4);
      } else if (preset === 'hourly') {
        setSimpleTimes(['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00']);
        setSimpleSlotsPerDay(10);
      }
    }
  }, [preset, mode]);

  // Auto-sync slots/day with times count in Simple mode
  React.useEffect(() => {
    if (mode === 'simple') {
      setSimpleSlotsPerDay(simpleTimes.length);
    }
  }, [simpleTimes, mode]);

  const handleApply = () => {
    // Check if videos are selected (like PublishDialog)
    if (selectedCount === 0) {
      // Don't apply if no videos are selected
      return;
    }

    let times: string[] = [];
    let slotsPerDay = 0;
    let finalTimeZoneId = timeZoneId;
    
    if (mode === 'simple') {
      times = simpleTimes;
      slotsPerDay = simpleTimes.length; // Use actual times count, not the input value
      finalTimeZoneId = simpleTimeZoneId;
      
      // Validation: ensure times are set
      if (times.length === 0) {
        return;
      }
    } else {
      // Custom mode: use timesCsv or generate from spread
      if (timesCsv.trim()) {
        times = parseTimesCsv(timesCsv).map(minutesToHHmm);
      } else {
        // Generate from spread settings
        const sMin = timeToMinutes(spreadStart);
        const eMin = timeToMinutes(spreadEnd);
        const step = spreadStep || 60;
        if (sMin != null && eMin != null && eMin >= sMin) {
          const generated: number[] = [];
          for (let t = sMin; t <= eMin; t += step) {
            generated.push(t);
          }
          times = Array.from(new Set(generated)).sort((a, b) => a - b).map(minutesToHHmm);
        }
      }
      slotsPerDay = times.length;
      finalTimeZoneId = customTimeZoneId;
    }

    // Validation: ensure times are set
    if (times.length === 0) {
      return;
    }

    // Use current date if start date is not set (but don't show it in UI)
    const finalStartDate = startDate || new Date();

    // Update timezone if changed
    if (finalTimeZoneId !== timeZoneId) {
      onTimeZoneChange(finalTimeZoneId);
    }

    onApply({
      applyTo,
      mode,
      preset: mode === 'simple' ? preset : undefined,
      startDate: finalStartDate,
      times,
      timeZoneId: finalTimeZoneId,
      videosPerDay: slotsPerDay,
      // Custom options
      spreadStart: mode === 'custom' ? spreadStart : undefined,
      spreadEnd: mode === 'custom' ? spreadEnd : undefined,
      spreadStep: mode === 'custom' ? spreadStep : undefined,
      spreadCount: mode === 'custom' ? spreadCount : undefined,
      multipleJobsPerVideo: mode === 'custom' ? multipleJobsPerVideo : undefined,
      conflictDetection: mode === 'custom' ? conflictDetection : undefined,
    });
    // Also update defaults for future imports.
    const draft = getDraftDefaults();
    if (draft) onSaveDefaults(draft);
    onClose();
  };

  // Get plan summary for display
  const getPlanSummary = () => {
    let times: string[] = [];
    let tz = timeZoneId;
    
    if (mode === 'simple') {
      times = simpleTimes;
      tz = simpleTimeZoneId;
    } else {
      if (timesCsv.trim()) {
        times = parseTimesCsv(timesCsv).map(minutesToHHmm);
      }
      tz = customTimeZoneId;
    }
    
    // Only show summary if times are set
    if (times.length === 0) return null;
    
    const perDay = mode === 'simple' ? simpleTimes.length : times.length;
    const timesStr = times.join(', ');
    const tzStr = tz === 'SYSTEM' ? systemTimeZone : tz;
    // Use startDate if set, otherwise show "Today"
    const dateStr = startDate ? formatDateUnambiguous(startDate, monthNamesShort) : t('today');
    
    return t('planSummary', {
      perDay,
      times: timesStr,
      timeZone: tzStr,
      startDate: dateStr,
    });
  };

  // Get preview for Custom mode generate times
  const getGeneratePreview = () => {
    const startTimeStr = spreadStart || `${spreadStartHour.padStart(2, '0')}:${spreadStartMinute.padStart(2, '0')}`;
    const endTimeStr = spreadEnd || `${spreadEndHour.padStart(2, '0')}:${spreadEndMinute.padStart(2, '0')}`;
    const sMin = timeToMinutes(startTimeStr);
    const eMin = timeToMinutes(endTimeStr);
    if (sMin == null || eMin == null || eMin < sMin) return null;
    
    const step = spreadStep || 60;
    const n = spreadCount || 3;
    
    // Generate by step
    const byStep: number[] = [];
    for (let t = sMin; t <= eMin; t += step) {
      byStep.push(t);
    }
    const byStepStr = Array.from(new Set(byStep)).sort((a, b) => a - b).map(minutesToHHmm).join(', ');
    
    // Generate by spread
    if (n === 1) {
      return { byStep: byStepStr, bySpread: minutesToHHmm(sMin) };
    }
    const round5 = (x: number) => Math.min(24 * 60 - 1, Math.max(0, Math.round(x / 5) * 5));
    const bySpread: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = sMin + ((eMin - sMin) * i) / (n - 1);
      bySpread.push(round5(t));
    }
    const bySpreadStr = Array.from(new Set(bySpread)).sort((a, b) => a - b).map(minutesToHHmm).join(', ');
    
    return { byStep: byStepStr, bySpread: bySpreadStr };
  };

  const addTimeToSimple = (time?: string) => {
    const timeStr = time || `${newTimeHour.padStart(2, '0')}:${newTimeMinute.padStart(2, '0')}`;
    if (!timeStr || !/^\d{2}:\d{2}$/.test(timeStr)) return;
    if (!simpleTimes.includes(timeStr)) {
      const sorted = [...simpleTimes, timeStr].sort();
      setSimpleTimes(sorted);
    }
    setNewTimeHour('09');
    setNewTimeMinute('00');
    setShowAddTime(false);
  };

  const removeTimeFromSimple = (time: string) => {
    const filtered = simpleTimes.filter(t => t !== time);
    setSimpleTimes(filtered);
  };

  const handleDateInputChange = (value: string) => {
    setDateInputValue(value);
    const parsed = parseDateUnambiguous(value, monthNamesShort);
    if (parsed) {
      parsed.setHours(0, 0, 0, 0);
      // Disallow past dates: clamp to today.
      const next = parsed.getTime() < todayMidnight.getTime() ? new Date(todayMidnight) : parsed;
      setStartDate(next);
      setDateInputValue(formatDateUnambiguous(next, monthNamesShort));
    }
  };

  // Calendar helper functions
  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const isSameDay = (date1: Date | null, date2: Date | null) => {
    if (!date1 || !date2) return false;
    // Normalize dates to avoid timezone issues
    const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
    const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());
    return d1.getTime() === d2.getTime();
  };

  const isToday = (date: Date) => {
    const today = new Date();
    // Normalize dates to avoid timezone issues
    const d1 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const d2 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return d1.getTime() === d2.getTime();
  };

  const handleDateSelect = (day: number) => {
    // Create date in local timezone, set to noon to avoid timezone edge cases
    const selectedDate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
    selectedDate.setHours(12, 0, 0, 0); // Use noon to avoid DST issues
    // Normalize to midnight for storage
    const normalizedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    normalizedDate.setHours(0, 0, 0, 0);
    // Disallow past dates
    if (normalizedDate.getTime() < todayMidnight.getTime()) {
      return;
    }
    setStartDate(normalizedDate);
    setDateInputValue(formatDateUnambiguous(normalizedDate, monthNamesShort));
    setDatePickerAnchor(null);
  };

  const handlePrevMonth = () => {
    const newMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1, 12, 0, 0, 0);
    setCalendarMonth(newMonth);
  };

  const handleNextMonth = () => {
    const newMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1, 12, 0, 0, 0);
    setCalendarMonth(newMonth);
  };

  const handleToday = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setStartDate(today);
    setDateInputValue(formatDateUnambiguous(today, monthNamesShort));
    // Set calendar month at noon to avoid timezone issues
    setCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1, 12, 0, 0, 0));
    setDatePickerAnchor(null);
  };

  const handleClear = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setStartDate(today);
    setDateInputValue(formatDateUnambiguous(today, monthNamesShort));
    setDatePickerAnchor(null);
  };

  // Render calendar
  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(calendarMonth);
    // Get first day of month (0 = Sunday, 1 = Monday, etc.)
    // Create date at noon to avoid timezone/DST issues
    const firstDayOfMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1, 12, 0, 0, 0);
    const firstDay = firstDayOfMonth.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const days: (number | null)[] = [];
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    
    // Add days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }

    const monthNames = monthNamesLong;
    const dayNames = weekdayNamesShort;
    const calendarWidth = 280;

    return (
      <Box sx={{ p: 2, width: calendarWidth, minWidth: calendarWidth, boxSizing: 'border-box' }}>
        {/* Calendar Header: left arrow | month year | right arrow */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <IconButton size="small" onClick={handlePrevMonth} sx={{ flexShrink: 0 }}>
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, textAlign: 'center', flex: 1, minWidth: 0 }}>
            {monthNames[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}
          </Typography>
          <IconButton size="small" onClick={handleNextMonth} sx={{ flexShrink: 0 }}>
            <ChevronRightIcon />
          </IconButton>
        </Stack>

        {/* Weekday names: 7-column grid */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, mb: 1 }}>
          {dayNames.map((day) => (
            <Typography key={day} variant="caption" align="center" sx={{ fontWeight: 600, color: 'text.secondary' }}>
              {day}
            </Typography>
          ))}
        </Box>

        {/* Calendar days: 7-column grid so layout stays correct */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
          {days.map((day, index) => {
            if (day === null) {
              return <Box key={`empty-${index}`} />;
            }
            // Create date in local timezone to avoid timezone issues
            const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day, 12, 0, 0, 0);
            const selected = isSameDay(date, startDate);
            const today = isToday(date);
            const dateMidnight = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
            dateMidnight.setHours(0, 0, 0, 0);
            const isPast = dateMidnight.getTime() < todayMidnight.getTime();

            return (
              <Button
                key={day}
                fullWidth
                disabled={isPast}
                onClick={() => handleDateSelect(day)}
                sx={{
                  minWidth: 0,
                  width: '100%',
                  aspectRatio: '1',
                  maxHeight: 36,
                  p: 0,
                  minHeight: 32,
                  borderRadius: 1,
                  backgroundColor: selected ? 'primary.main' : 'transparent',
                  color: selected ? 'primary.contrastText' : today ? 'primary.main' : 'text.primary',
                  fontWeight: today ? 600 : selected ? 600 : 400,
                  border: today && !selected ? '1px solid' : 'none',
                  borderColor: today && !selected ? 'primary.main' : 'transparent',
                  '&:hover': {
                    backgroundColor: selected ? 'primary.dark' : 'action.hover',
                  },
                  ...(isPast
                    ? {
                        color: 'text.disabled',
                        '&:hover': { backgroundColor: 'transparent' },
                      }
                    : {}),
                }}
              >
                {day}
              </Button>
            );
          })}
        </Box>

        {/* Footer buttons */}
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 2 }}>
          <Button size="small" onClick={handleClear} sx={{ textTransform: 'none' }}>
            {t('clear')}
          </Button>
          <Button size="small" onClick={handleToday} sx={{ textTransform: 'none' }}>
            {t('today')}
          </Button>
        </Stack>
      </Box>
    );
  };

  const planSummary = getPlanSummary();
  const generatePreview = getGeneratePreview();

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">
            {t('plan')} {t('selected')} ({selectedCount} {selectedCount === 1 ? t('item') : t('items')})
          </Typography>
          <IconButton size="small" onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={autoPlanEnabled}
                  onChange={(e) => onAutoPlanEnabledChange(e.target.checked)}
                  color="primary"
                  data-testid="auto-plan-switch"
                />
              }
              label={
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Typography>⏰</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t('autoPlanOnImport')}
                  </Typography>
                </Stack>
              }
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
              {t('autoPlanDefaultsHint')}
            </Typography>
          </Box>

          {/* Apply To (platform scope) */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('targets')}
            </Typography>
            <ToggleButtonGroup
              value={applyTo}
              exclusive
              onChange={(_e, next) => {
                if (!next) return;
                setApplyTo(next);
              }}
              fullWidth
              size="small"
            >
              <ToggleButton value="all">{t('all')}</ToggleButton>
              <ToggleButton value="youtube">{t('youtube')}</ToggleButton>
              <ToggleButton value="instagram">{t('instagram')}</ToggleButton>
              <ToggleButton value="tiktok">{t('tiktok')}</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {/* Plan Summary */}
          {planSummary && (
            <Box
              sx={{
                p: 1.5,
                bgcolor: 'background.default',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {t('planSummaryLabel', { summary: planSummary })}
              </Typography>
            </Box>
          )}

          {/* Mode Toggle */}
          <ToggleButtonGroup
            value={mode}
            exclusive
            onChange={(_, newMode) => newMode && setMode(newMode)}
            fullWidth
          >
            <ToggleButton value="simple">{t('simple')}</ToggleButton>
            <ToggleButton value="custom">{t('custom')}</ToggleButton>
          </ToggleButtonGroup>

          {mode === 'simple' ? (
            <>
              {/* Presets */}
              <Box data-testid="plan-dialog-presets">
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t('presets')}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Chip
                    label={t('preset3Day')}
                    onClick={() => setPreset('3/day')}
                    color={preset === '3/day' ? 'primary' : 'default'}
                    sx={{ cursor: 'pointer' }}
                  />
                  <Chip
                    label={t('preset4Day')}
                    onClick={() => setPreset('4/day')}
                    color={preset === '4/day' ? 'primary' : 'default'}
                    sx={{ cursor: 'pointer' }}
                  />
                  <Chip
                    label={t('presetHourly')}
                    onClick={() => setPreset('hourly')}
                    color={preset === 'hourly' ? 'primary' : 'default'}
                    sx={{ cursor: 'pointer' }}
                  />
                </Stack>
              </Box>

              {/* Start Date - using custom date picker */}
              <Box>
                <TextField
                  inputRef={dateInputRef}
                  label={t('startDate')}
                  value={dateInputValue}
                  onChange={(e) => handleDateInputChange(e.target.value)}
                  onBlur={() => {
                    if (!dateInputValue || !parseDateUnambiguous(dateInputValue, monthNamesShort)) {
                      setDateInputValue(startDate ? formatDateUnambiguous(startDate, monthNamesShort) : '');
                    }
                  }}
                  placeholder={t('dateExampleShort')}
                  helperText={t('datePickerHelper')}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  size="small"
                  InputProps={{
                    endAdornment: (
                      <IconButton 
                        size="small" 
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (startDate) {
                            setCalendarMonth(new Date(startDate.getFullYear(), startDate.getMonth(), 1, 12, 0, 0, 0));
                          } else {
                            const today = new Date();
                            setCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1, 12, 0, 0, 0));
                          }
                          const anchor = dateInputRef.current?.closest('.MuiTextField-root') || dateInputRef.current || e.currentTarget.closest('.MuiInputBase-root') || e.currentTarget;
                          setDatePickerAnchor(anchor as HTMLElement);
                        }}
                      >
                        <CalendarTodayIcon fontSize="small" />
                      </IconButton>
                    ),
                  }}
                />
              </Box>
              <Popover
                open={Boolean(datePickerAnchor)}
                anchorEl={datePickerAnchor}
                onClose={() => setDatePickerAnchor(null)}
                anchorOrigin={{
                  vertical: 'bottom',
                  horizontal: 'left',
                }}
                transformOrigin={{
                  vertical: 'top',
                  horizontal: 'left',
                }}
                slotProps={{
                  paper: { sx: { minWidth: 304 } },
                }}
              >
                {renderCalendar()}
              </Popover>

              {/* Time Zone */}
              <Autocomplete
                size="small"
                options={timeZoneOptions}
                value={simpleTimeZoneId}
                onChange={(_e, v) => setSimpleTimeZoneId(v || 'SYSTEM')}
                fullWidth
                renderInput={(params) => <TextField {...params} label={t('timeZone')} />}
                getOptionLabel={(o) => (o === 'SYSTEM' ? systemTzOffset : o)}
                isOptionEqualToValue={(o, v) => o === v}
              />

              {/* Slots per day - read-only, synced with times */}
              <TextField
                label={t('slotsPerDay')}
                type="number"
                value={simpleSlotsPerDay}
                InputProps={{ readOnly: true }}
                fullWidth
                helperText={t('slotsPerDayHelper')}
              />

              {/* Times (editable chips) */}
              <Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2">{t('times')}</Typography>
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowAddTime(!showAddTime);
                    }}
                    sx={{ textTransform: 'none' }}
                  >
                    {t('addTime')}
                  </Button>
                </Stack>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                  {simpleTimes.map((time) => (
                    <Chip
                      key={time}
                      label={time}
                      onDelete={() => removeTimeFromSimple(time)}
                      color="primary"
                      variant="outlined"
                    />
                  ))}
                </Stack>
                {showAddTime && (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                    <FormControl size="small" sx={{ minWidth: 80 }}>
                      <InputLabel>{t('hour')}</InputLabel>
                      <Select
                        value={newTimeHour}
                        onChange={(e) => setNewTimeHour(e.target.value)}
                        label={t('hour')}
                      >
                        {Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')).map((hour) => (
                          <MenuItem key={hour} value={hour}>
                            {hour}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Typography sx={{ mx: 0.5 }}>:</Typography>
                    <FormControl size="small" sx={{ minWidth: 80 }}>
                      <InputLabel>{t('minute')}</InputLabel>
                      <Select
                        value={newTimeMinute}
                        onChange={(e) => setNewTimeMinute(e.target.value)}
                        label={t('minute')}
                      >
                        {Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0')).map((minute) => (
                          <MenuItem key={minute} value={minute}>
                            {minute}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => addTimeToSimple()}
                    >
                      {t('addLabel')}
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        setShowAddTime(false);
                        setNewTimeHour('09');
                        setNewTimeMinute('00');
                      }}
                    >
                      {t('cancel')}
                    </Button>
                  </Stack>
                )}
              </Box>
            </>
          ) : (
            <Stack spacing={2}>
              {/* Start Date - using custom date picker */}
              <Box>
                <TextField
                  inputRef={dateInputRef}
                  label={t('startDate')}
                  value={dateInputValue}
                  onChange={(e) => handleDateInputChange(e.target.value)}
                  onBlur={() => {
                    if (!dateInputValue || !parseDateUnambiguous(dateInputValue, monthNamesShort)) {
                      setDateInputValue(startDate ? formatDateUnambiguous(startDate, monthNamesShort) : '');
                    }
                  }}
                  placeholder={t('dateExampleShort')}
                  helperText={t('datePickerHelper')}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  size="small"
                  InputProps={{
                    endAdornment: (
                      <IconButton 
                        size="small" 
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (startDate) {
                            setCalendarMonth(new Date(startDate.getFullYear(), startDate.getMonth(), 1, 12, 0, 0, 0));
                          } else {
                            const today = new Date();
                            setCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1, 12, 0, 0, 0));
                          }
                          const anchor = dateInputRef.current?.closest('.MuiTextField-root') || dateInputRef.current || e.currentTarget.closest('.MuiInputBase-root') || e.currentTarget;
                          setDatePickerAnchor(anchor as HTMLElement);
                        }}
                      >
                        <CalendarTodayIcon fontSize="small" />
                      </IconButton>
                    ),
                  }}
                />
              </Box>
              <Popover
                open={Boolean(datePickerAnchor)}
                anchorEl={datePickerAnchor}
                onClose={() => setDatePickerAnchor(null)}
                anchorOrigin={{
                  vertical: 'bottom',
                  horizontal: 'left',
                }}
                transformOrigin={{
                  vertical: 'top',
                  horizontal: 'left',
                }}
                slotProps={{
                  paper: { sx: { overflow: 'visible', minWidth: 304 } },
                }}
              >
                {renderCalendar()}
              </Popover>

              {/* Time Zone */}
              <Autocomplete
                size="small"
                options={timeZoneOptions}
                value={customTimeZoneId}
                onChange={(_e, v) => setCustomTimeZoneId(v || 'SYSTEM')}
                fullWidth
                renderInput={(params) => <TextField {...params} label={t('timeZone')} />}
                getOptionLabel={(o) => (o === 'SYSTEM' ? systemTzOffset : o)}
                isOptionEqualToValue={(o, v) => o === v}
              />

              <Divider />

              {/* Times Input - Accordion */}
              <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {t('timesInputManual')}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <TextField
                    label={t('timesInputLabel')}
                    size="small"
                    value={timesCsv}
                    onChange={(e) => setTimesCsv(e.target.value)}
                    onBlur={() => setTimesCsv((cur) => normalizeTimesCsv(cur))}
                    fullWidth
                    placeholder={t('timesInputPlaceholder')}
                    helperText={t('timesInputHelper')}
                    data-testid="schedule-times-input"
                  />
                </AccordionDetails>
              </Accordion>

              {/* Generate Times - Accordion */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {t('generateTimesTool')}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <FormControl size="small" sx={{ minWidth: 80 }}>
                        <InputLabel>{t('startHour')}</InputLabel>
                        <Select
                          value={spreadStartHour}
                          onChange={(e) => {
                            setSpreadStartHour(e.target.value);
                            setSpreadStart(`${e.target.value.padStart(2, '0')}:${spreadStartMinute.padStart(2, '0')}`);
                          }}
                          label={t('startHour')}
                        >
                          {Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')).map((hour) => (
                            <MenuItem key={hour} value={hour}>
                              {hour}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Typography sx={{ mx: 0.5 }}>:</Typography>
                      <FormControl size="small" sx={{ minWidth: 80 }}>
                        <InputLabel>{t('startMinute')}</InputLabel>
                        <Select
                          value={spreadStartMinute}
                          onChange={(e) => {
                            setSpreadStartMinute(e.target.value);
                            setSpreadStart(`${spreadStartHour.padStart(2, '0')}:${e.target.value.padStart(2, '0')}`);
                          }}
                          label={t('startMinute')}
                        >
                          {Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0')).map((minute) => (
                            <MenuItem key={minute} value={minute}>
                              {minute}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Typography sx={{ mx: 1 }}>{t('to')}</Typography>
                      <FormControl size="small" sx={{ minWidth: 80 }}>
                        <InputLabel>{t('endHour')}</InputLabel>
                        <Select
                          value={spreadEndHour}
                          onChange={(e) => {
                            setSpreadEndHour(e.target.value);
                            setSpreadEnd(`${e.target.value.padStart(2, '0')}:${spreadEndMinute.padStart(2, '0')}`);
                          }}
                          label={t('endHour')}
                        >
                          {Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')).map((hour) => (
                            <MenuItem key={hour} value={hour}>
                              {hour}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Typography sx={{ mx: 0.5 }}>:</Typography>
                      <FormControl size="small" sx={{ minWidth: 80 }}>
                        <InputLabel>{t('endMinute')}</InputLabel>
                        <Select
                          value={spreadEndMinute}
                          onChange={(e) => {
                            setSpreadEndMinute(e.target.value);
                            setSpreadEnd(`${spreadEndHour.padStart(2, '0')}:${e.target.value.padStart(2, '0')}`);
                          }}
                          label={t('endMinute')}
                        >
                          {Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0')).map((minute) => (
                            <MenuItem key={minute} value={minute}>
                              {minute}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <TextField
                        size="small"
                        label={t('stepMinutes')}
                        type="number"
                        value={spreadStep}
                        onChange={(e) => setSpreadStep(Math.max(5, Number(e.target.value || 60)))}
                        sx={{ width: 120 }}
                        inputProps={{ min: 5, step: 5 }}
                      />
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <TextField
                        size="small"
                        label={t('slotsPerDay')}
                        type="number"
                        value={spreadCount}
                        onChange={(e) => setSpreadCount(Math.max(1, Number(e.target.value || 3)))}
                        sx={{ width: 120 }}
                        inputProps={{ min: 1, step: 1 }}
                      />
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => {
                          const sMin = timeToMinutes(spreadStart);
                          const eMin = timeToMinutes(spreadEnd);
                          const step = spreadStep || 60;
                          if (sMin == null || eMin == null) return;
                          if (eMin < sMin) return;
                          
                          const out: number[] = [];
                          for (let t = sMin; t <= eMin; t += step) {
                            out.push(t);
                          }
                          const uniq = Array.from(new Set(out)).sort((a, b) => a - b);
                          setTimesCsv(uniq.map(minutesToHHmm).join(' '));
                        }}
                        sx={{ flex: 1 }}
                      >
                        {t('generateByStep')}
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => {
                          const sMin = timeToMinutes(spreadStart);
                          const eMin = timeToMinutes(spreadEnd);
                          const n = spreadCount || 3;
                          if (sMin == null || eMin == null) return;
                          if (eMin < sMin) return;
                          if (n === 1) {
                            setTimesCsv(minutesToHHmm(sMin));
                            return;
                          }
                          const round5 = (x: number) => Math.min(24 * 60 - 1, Math.max(0, Math.round(x / 5) * 5));
                          const out: number[] = [];
                          for (let i = 0; i < n; i++) {
                            const t = sMin + ((eMin - sMin) * i) / (n - 1);
                            out.push(round5(t));
                          }
                          const uniq = Array.from(new Set(out)).sort((a, b) => a - b);
                          setTimesCsv(uniq.map(minutesToHHmm).join(' '));
                        }}
                        sx={{ flex: 1 }}
                      >
                        {t('spreadEvenly')}
                      </Button>
                    </Stack>
                    {generatePreview && (
                      <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                          {t('preview')}
                        </Typography>
                        <Alert severity="info" sx={{ py: 0.5 }}>
                          <Typography variant="caption">
                            <strong>{t('previewByStep')}:</strong> {generatePreview.byStep || t('notAvailable')}
                            <br />
                            <strong>{t('previewEvenly')}:</strong> {generatePreview.bySpread || t('notAvailable')}
                          </Typography>
                        </Alert>
                      </Box>
                    )}
                  </Stack>
                </AccordionDetails>
              </Accordion>

              <Divider />

              {/* Custom Options */}
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
                  {t('options')}
                </Typography>
                <Stack spacing={1}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={multipleJobsPerVideo}
                        onChange={(e) => setMultipleJobsPerVideo(e.target.checked)}
                        size="small"
                      />
                    }
                    label={t('multipleJobsPerVideo')}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 4 }}>
                    {t('multipleJobsPerVideoHelper')}
                  </Typography>
                  
                  <FormControlLabel
                    control={
                      <Switch
                        checked={conflictDetection}
                        onChange={(e) => setConflictDetection(e.target.checked)}
                        size="small"
                      />
                    }
                    label={t('conflictDetection')}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 4 }}>
                    {t('conflictDetectionHelper')}
                  </Typography>
                </Stack>
              </Box>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t('cancel')}</Button>
        <Button 
          onClick={handleApply} 
          variant="contained"
          disabled={selectedCount === 0}
          data-testid="apply-plan-button"
        >
          {selectedCount > 0
            ? t('applyToCount', { count: selectedCount })
            : t('applyPlanToUnscheduled')}
        </Button>
      </DialogActions>
      <Box sx={{ px: 3, pb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          {selectedCount > 0
            ? t('appliesOnlyToUnscheduled')
            : t('selectRow')}
        </Typography>
      </Box>
    </Dialog>
  );
}
