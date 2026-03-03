import type { PublishMode, ZonedParts } from './types';

export function baseName(p: string) {
  const parts = p.split(/[/\\]/g);
  return parts[parts.length - 1] || p;
}

export function newId() {
  // crypto.randomUUID() may be missing in some Electron/Chromium builds
  // Fallback to a simple unique-ish id.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function getZonedParts(d: Date, timeZoneId: string): ZonedParts {
  // timeZoneId: 'SYSTEM' | 'UTC' | IANA
  const tz = timeZoneId === 'SYSTEM' ? undefined : timeZoneId;
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz as any,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(d);
  const map: any = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  } as ZonedParts;
}

export function tzOffsetMs(date: Date, timeZoneId: string) {
  // Offset such that: date + offset = "same instant represented in tz parts as UTC".
  // This matches date-fns-tz style.
  if (timeZoneId === 'SYSTEM') {
    return -date.getTimezoneOffset() * 60_000;
  }
  const parts = getZonedParts(date, timeZoneId);
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUTC - date.getTime();
}

export function zonedComponentsToUtcEpoch(parts: { year: number; month: number; day: number; hour: number; minute: number }, timeZoneId: string) {
  if (timeZoneId === 'SYSTEM') {
    const ms = new Date(`${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (timeZoneId === 'UTC') {
    const ms = new Date(`${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}Z`).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  // Create a date as if the components were UTC, then correct by timezone offset at that moment.
  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0));
  const offset = tzOffsetMs(utcGuess, timeZoneId);
  const corrected = new Date(utcGuess.getTime() - offset);
  return corrected.getTime();
}

export function formatForGrid(epoch: number | null | undefined, mode: PublishMode, timeZoneId: string) {
  if (mode === 'now') return 'Now';
  if (!epoch) return '';
  const d = new Date(epoch);
  const tz = timeZoneId === 'SYSTEM' ? undefined : timeZoneId;
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz as any,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function toDateTimeLocalValue(epoch: number | null | undefined, timeZoneId: string) {
  if (!epoch) return '';
  const d = new Date(epoch);
  const p = getZonedParts(d, timeZoneId);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
}

export function parseDateTimeLocalValue(v: string, timeZoneId: string) {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const parts = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
  const ms = zonedComponentsToUtcEpoch(parts, timeZoneId);
  return ms;
}

export function parseTimesCsv(v: string) {
  // "09:00, 13:30" -> minutes from midnight
  const out: number[] = [];
  for (const raw of v.replace(/,/g, ' ').split(/\s+/g)) {
    const s = raw.trim();
    if (!s) continue;
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) continue;
    out.push(hh * 60 + mm);
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

export function minutesToHHmm(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

export function timeToMinutes(hhmm: string) {
  const m = hhmm.trim().match(/^([0-9]{1,2}):([0-9]{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export function normalizeTimesCsv(v: string) {
  const mins = parseTimesCsv(v);
  return mins.map(minutesToHHmm).join(',');
}

export function nextDay(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

export function nextSlotAfter(afterEpoch: number, timeZoneId: string, slotsMinutes: number[]) {
  // returns next slot strictly AFTER afterEpoch
  const base = new Date(afterEpoch);
  const p = getZonedParts(base, timeZoneId);
  const nowMin = p.hour * 60 + p.minute;
  let year = p.year, month = p.month, day = p.day;

  // try same day
  for (const sm of slotsMinutes) {
    if (sm > nowMin) {
      const hour = Math.floor(sm / 60);
      const minute = sm % 60;
      const ms = zonedComponentsToUtcEpoch({ year, month, day, hour, minute }, timeZoneId);
      if (ms != null && ms > afterEpoch) return ms;
    }
  }
  // next day
  const nd = nextDay(year, month, day);
  year = nd.year; month = nd.month; day = nd.day;
  const first = slotsMinutes[0] ?? 9 * 60;
  const hour = Math.floor(first / 60);
  const minute = first % 60;
  const ms = zonedComponentsToUtcEpoch({ year, month, day, hour, minute }, timeZoneId);
  // Return null if conversion failed (invalid date/timezone), caller should handle this
  return ms;
}
