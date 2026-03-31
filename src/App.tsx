// PATCH_V8_4_details_settings_selection
import * as React from 'react';
import ReactDOM from 'react-dom';
import './App.css';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AlertTitle,
  Autocomplete,
  Checkbox,
  Box,
  Button,
  Chip,
  ClickAwayListener,
  CssBaseline,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Menu,
  Paper,
  Popover,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Switch,
  Snackbar,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { DataGrid, type GridColDef, type GridRowSelectionModel, GridPagination, useGridApiRef } from '@mui/x-data-grid';

// Import types, constants, and utils
import type { JobRow, JobStatus, MetaPlatform, CustomAiPlatformMap } from './types';
import { baseName, newId, formatForGrid, parseTimesCsv, minutesToHHmm, timeToMinutes, normalizeTimesCsv, nextSlotAfter, toDateTimeLocalValue, parseDateTimeLocalValue, zonedComponentsToUtcEpoch } from './utils';
import { loadInterfaceSettings, saveInterfaceSettings, type InterfaceSettings } from './utils/interfaceSettings';

// Import components
import AddDialog from './components/AddDialog';
import CommandBar from './components/CommandBar';
import DetailsPanel from './components/DetailsPanel';
import PlannerDialog from './components/PlannerDialog';
import PublishDialog, { type PublishOptions } from './components/PublishDialog';
import DiagnosticsDialog from './components/DiagnosticsDialog';
import DeveloperModeDialog from './components/DeveloperModeDialog';
import CustomAIDialog from './components/CustomAIDialog';
import TemplateDialog from './components/TemplateDialog';
import OpenEditorAllDialog from './components/OpenEditorAllDialog';
import AccountDialog from './components/AccountDialog';
import SettingsDialog from './components/SettingsDialog';
import DateTimeLocalPicker from './components/DateTimeLocalPicker';
import VisibilityCell from './components/VisibilityCell';
import MadeForKidsCell from './components/MadeForKidsCell';
import AssistCenter from './components/AssistCenter';
import AssistOverlay from './components/AssistOverlay';
import UpdateBanner from './components/UpdateBanner';
import { useTranslation } from 'react-i18next';
import { UI_LANGUAGE_OPTIONS } from './i18n/languages';
import { parseParamsFromUrl } from './lib/authDeepLink';
import { getSupabase } from './lib/supabase';
import { isNetworkError, type NetworkStatus, useNetworkStatus } from './lib/networkStatus';
import {
  ENTITLEMENT_LAST_CHECK_AT_KEY,
  INITIAL_AUTH_ENTITLEMENT,
  loadAuthAndEntitlement as loadAuthAndEntitlementState,
  OFFLINE_GRACE_PERIOD_MS,
  type AuthEntitlementSnapshot,
} from './lib/entitlement';
import {
  finalizeQuota,
  getUsageSnapshot,
  releaseQuota,
  reserveMetadata,
  reserveUpload,
  type UsageSnapshot,
} from './billing/usage';
import type { User } from '@supabase/supabase-js';

// Re-export types for backward compatibility
export type { JobRow, JobStatus, Visibility, PublishMode, PublishSource, MetaPlatform, MetaSource, AutoUploadStatusMsg } from './types';

// Import types for local use
import type { Visibility, MetaSource, MetadataTemplate } from './types';

type AutoUploadStatusMsg = {
  id: string;
  platform: MetaPlatform;
  status: JobStatus;
  message?: string;
};

type BillingGateReason = 'sign_in' | 'not_subscribed' | 'limit_exceeded' | 'reconnect_required';
type LimitDialogState = {
  open: boolean;
  kind: 'metadata' | 'upload';
  snapshot: UsageSnapshot | null;
};

type MetadataQueueItem = {
  id: string;
  filePaths: string[];
  platforms?: MetaPlatform[];
  queuedAt: number;
};

type EntitlementRow = {
  plan: string;
  status: string;
  trial_ends_at?: string | null;
  trial_used?: boolean | null;
};

type SubscriptionRow = {
  id: string;
  customer_id?: string | null;
  status?: string | null;
  current_period_end?: string | number | null;
  cancel_at_period_end?: boolean | null;
  ended_at?: string | number | null;
};

const PRICING_URL = 'https://getclipcast.app/pricing';
const BILLING_URL = 'https://getclipcast.app/account';
/** Placeholder help URL for YouTube account verification (daily upload limit). */
const YOUTUBE_VERIFICATION_GUIDE_URL = 'https://getclipcast.app/guide/youtube-verification';

/** Classify YouTube upload response as daily upload limit / verification required (do not charge credits, do not retry). */
function isYoutubeDailyLimitError(res: { dailyUploadLimit?: boolean; error?: string } | null | undefined): boolean {
  if (!res) return false;
  if (res.dailyUploadLimit === true) return true;
  const msg = (res.error ?? '').toLowerCase();
  return /daily upload limit|upload limit|verify your account|phone verification|youtube verification|exceeded the number of videos|verification required|channel verification/.test(msg);
}

const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF]/g;
const HASHTAG_TOKEN_RE = /#([^\s#]+)/gu;
const INVALID_HASHTAG_CHARS_RE = /[^\p{L}\p{N}\p{M}_]+/gu;
const SHORT_CODE_RE = /^[A-Za-z]{1,3}\d{0,3}$/;
const NUMERIC_ONLY_RE = /^\d+$/;
const AMBIGUOUS_ALNUM_RE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{1,5}$/;

const isAmbiguousShortTag = (token: string): boolean => {
  const t = String(token || '').trim();
  if (!t) return true;
  if (NUMERIC_ONLY_RE.test(t)) return true;
  if (SHORT_CODE_RE.test(t)) return true;
  if (AMBIGUOUS_ALNUM_RE.test(t)) return true;
  return false;
};

const extractHashtagTokens = (token: unknown): string[] => {
  let raw = String(token ?? '').replace(ZERO_WIDTH_RE, '').trim();
  if (!raw) return [];
  raw = raw.replace(/[＃﹟]/g, '#').replace(/％/g, '%');
  const candidates = raw.includes('#')
    ? Array.from(raw.matchAll(HASHTAG_TOKEN_RE), (match) => match[1])
    : [raw];
  const cleaned: string[] = [];
  for (const candidate of candidates) {
    const v = String(candidate || '').replace(INVALID_HASHTAG_CHARS_RE, '');
    if (!v) continue;
    if (isAmbiguousShortTag(v)) continue;
    cleaned.push(`#${v}`);
  }
  return cleaned;
};

const normalizeHashtagsValue = (value: unknown): string => {
  if (!value) return '';
  const rawTokens = Array.isArray(value) ? value : String(value).split(/[,\s]+/);
  const cleaned: string[] = [];
  for (const token of rawTokens) {
    cleaned.push(...extractHashtagTokens(token));
  }
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const tag of cleaned) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(tag);
  }
  return uniq.join(' ');
};

// All utility functions are now imported from utils.ts

export default function App() {
  const apiOk = Boolean(window.api);
  const { t, i18n } = useTranslation();
  const { networkStatus, retryHeartbeat, markOffline } = useNetworkStatus();
  const [offlineDialogOpen, setOfflineDialogOpen] = React.useState(false);
  const offlineDialogOpenRef = React.useRef(false);
  const lastNetworkStatusRef = React.useRef<NetworkStatus | null>(null);
  const openOfflineDialog = React.useCallback(() => {
    if (offlineDialogOpenRef.current) return;
    offlineDialogOpenRef.current = true;
    setOfflineDialogOpen(true);
  }, []);
  const closeOfflineDialog = React.useCallback(() => {
    offlineDialogOpenRef.current = false;
    setOfflineDialogOpen(false);
  }, []);
  const handleOfflineRetry = React.useCallback(async () => {
    const ok = await retryHeartbeat();
    if (ok) closeOfflineDialog();
  }, [closeOfflineDialog, retryHeartbeat]);
  const requireOnline = React.useCallback(
    (opts?: { showDialog?: boolean }) => {
      if (networkStatus !== 'offline') return true;
      if (opts?.showDialog !== false) {
        openOfflineDialog();
      }
      return false;
    },
    [networkStatus, openOfflineDialog],
  );
  const handleNetworkError = React.useCallback(
    (err: unknown) => {
      if (!isNetworkError(err)) return false;
      markOffline(err);
      openOfflineDialog();
      return true;
    },
    [markOffline, openOfflineDialog],
  );
  const platformLabels = React.useMemo(
    () => ({
      youtube: t('youtube'),
      instagram: t('instagram'),
      tiktok: t('tiktok'),
    }),
    [t],
  );
  const formatFilterLabel = React.useCallback(
    (label: string, count: number) => t('filterLabelWithCount', { label, count }),
    [t],
  );

  const normalizeRowPrefsKey = React.useCallback((p: string) => String(p || '').replace(/\\/g, '/').toLowerCase(), []);
  const normalizeFileNameKey = React.useCallback((p: string) => {
    const name = baseName(String(p || ''));
    return name.toLowerCase().replace(/[\s._\-']+/g, '');
  }, []);
  type RowPrefs = {
    targets?: { youtube: boolean; instagram: boolean; tiktok: boolean };
    visibility?: Visibility;
    selfDeclaredMadeForKids?: boolean;
  };

  const [rowPrefs, setRowPrefs] = React.useState<Record<string, RowPrefs>>({});
  const rowPrefsRef = React.useRef<Record<string, RowPrefs>>({});
  React.useEffect(() => {
    rowPrefsRef.current = rowPrefs;
  }, [rowPrefs]);

  const rowPrefsLoadedRef = React.useRef(false);
  const rowPrefsSaveTimerRef = React.useRef<number | null>(null);

  // Load persisted row prefs once (targets/visibility without creating jobs)
  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const loaded = await (window.api as any)?.rowPrefsLoad?.();
        if (cancelled) return;
        if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
          setRowPrefs(loaded as Record<string, RowPrefs>);
        }
      } catch {
        // ignore
      } finally {
        rowPrefsLoadedRef.current = true;
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced save to disk (avoid writing on every click)
  React.useEffect(() => {
    if (!rowPrefsLoadedRef.current) return;
    const saver = (window.api as any)?.rowPrefsSave;
    if (typeof saver !== 'function') return;
    if (rowPrefsSaveTimerRef.current != null) {
      window.clearTimeout(rowPrefsSaveTimerRef.current);
    }
    rowPrefsSaveTimerRef.current = window.setTimeout(() => {
      try {
        void saver(rowPrefsRef.current);
      } catch {
        // ignore
      }
    }, 150);
  }, [rowPrefs]);

  const [dark, setDark] = React.useState<boolean>(() => localStorage.getItem('theme') === 'dark');
  const [uiLanguage, setUiLanguage] = React.useState<string>('en');
  const [authDeepLinkUrl, setAuthDeepLinkUrl] = React.useState<string | null>(null);
  const [supabaseUser, setSupabaseUser] = React.useState<User | null>(null);
  const [entitlement, setEntitlement] = React.useState<EntitlementRow | null>(null);
  const [subscriptionInfo, setSubscriptionInfo] = React.useState<SubscriptionRow | null>(null);
  const [authEntitlement, setAuthEntitlement] =
    React.useState<AuthEntitlementSnapshot>(INITIAL_AUTH_ENTITLEMENT);
  const authEntitlementRef = React.useRef<AuthEntitlementSnapshot>(INITIAL_AUTH_ENTITLEMENT);
  const [entitlementLoading, setEntitlementLoading] = React.useState(false);
  const lastProcessedDeepLinkRef = React.useRef<{ url: string; ts: number } | null>(null);
  React.useEffect(() => {
    authEntitlementRef.current = authEntitlement;
  }, [authEntitlement]);
  const planAccess = React.useMemo(
    () => ({
      isActive: authEntitlement.isActive,
      isSignedIn: authEntitlement.isSignedIn,
      planName: authEntitlement.planName,
      renewsOn: authEntitlement.renewsOn,
    }),
    [authEntitlement.isActive, authEntitlement.isSignedIn, authEntitlement.planName, authEntitlement.renewsOn],
  );
  const [usageSnapshot, setUsageSnapshot] = React.useState<UsageSnapshot | null>(null);
  const [usageLoading, setUsageLoading] = React.useState(false);
  const [billingGateReason, setBillingGateReason] = React.useState<BillingGateReason | null>(null);
  const [limitDialog, setLimitDialog] = React.useState<LimitDialogState>({
    open: false,
    kind: 'metadata',
    snapshot: null,
  });

  const [lastEntitlementCheckAt, setLastEntitlementCheckAt] = React.useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(ENTITLEMENT_LAST_CHECK_AT_KEY);
      if (raw == null) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  });

  const limitedMode = React.useMemo(() => {
    if (networkStatus !== 'offline') return false;
    if (lastEntitlementCheckAt == null) return true;
    return Date.now() - lastEntitlementCheckAt > OFFLINE_GRACE_PERIOD_MS;
  }, [networkStatus, lastEntitlementCheckAt]);

  React.useEffect(() => {
    const loadUiLanguage = async () => {
      try {
        const settings = await window.api?.settingsGet?.();
        const nextLang = settings?.uiLanguage || 'en';
        setUiLanguage(nextLang);
        await i18n.changeLanguage(nextLang);
      } catch (e) {
        console.error('Failed to load UI language:', e);
      }
    };
    void loadUiLanguage();
  }, [i18n]);
  
  // Interface settings (commandBarPosition, panelsLayout)
  const [interfaceSettings, setInterfaceSettings] = React.useState<InterfaceSettings>(() => loadInterfaceSettings());
  
  // Persist interface settings to localStorage whenever they change
  React.useEffect(() => {
    saveInterfaceSettings(interfaceSettings);
  }, [interfaceSettings]);
  
  // Helper function to update interface settings (merges partial updates)
  // Will be used in Task 2/3 for UI controls
  const updateInterfaceSettings = React.useCallback((partial: Partial<InterfaceSettings>) => {
    setInterfaceSettings((prev) => {
      const updated = { ...prev, ...partial };
      return updated;
    });
  }, []);
  
  // Make updateInterfaceSettings available for future UI components
  // (currently unused but required by task specification)
  React.useMemo(() => updateInterfaceSettings, [updateInterfaceSettings]);
  const [customInstructions, setCustomInstructions] = React.useState<string | CustomAiPlatformMap>({ all: '', youtube: '', instagram: '', tiktok: '' });
  const [youtubeLimitWarning, setYoutubeLimitWarning] = React.useState<string | null>(null);
  const [youtubeDailyLimitModalOpen, setYoutubeDailyLimitModalOpen] = React.useState(false);
  
  // Load custom instructions on mount
  React.useEffect(() => {
    const loadInstructions = async () => {
      try {
        const instructions = await window.api?.metadataGetCustomInstructions?.() || { all: '', youtube: '', instagram: '', tiktok: '' };
        setCustomInstructions(instructions);
      } catch (e) {
        console.error('Failed to load custom instructions:', e);
      }
    };
    void loadInstructions();
  }, []);
  const [uiScale, setUiScale] = React.useState<number>(() => {
    // Default scale on app launch is 90%
    const defaultScale = 0.9;
    localStorage.setItem('uiScale', String(defaultScale));
    return defaultScale;
  });
  React.useEffect(() => {
    localStorage.setItem('uiScale', String(uiScale));
  }, [uiScale]);
  const [customAIDialogOpen, setCustomAIDialogOpen] = React.useState(false);
  const [interfaceDialogOpen, setInterfaceDialogOpen] = React.useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = React.useState(false);
  
  // Splitter drag state
  const [isSplitterDragging, setIsSplitterDragging] = React.useState(false);
  const [splitterDragStartX, setSplitterDragStartX] = React.useState(0);
  const [splitterDragStartWidth, setSplitterDragStartWidth] = React.useState(0);
  const splitterContainerRef = React.useRef<HTMLDivElement>(null);
  
  // Handle splitter drag start
  const handleSplitterMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsSplitterDragging(true);
    setSplitterDragStartX(e.clientX);
    setSplitterDragStartWidth(interfaceSettings.detailsPanelWidth);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [interfaceSettings.detailsPanelWidth]);
  
  // Handle splitter drag
  React.useEffect(() => {
    if (!isSplitterDragging) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!splitterContainerRef.current) return;
      
      const containerWidth = splitterContainerRef.current.offsetWidth;
      // Inverted direction: mouse right = decrease width, mouse left = increase width
      const deltaX = splitterDragStartX - e.clientX;
      
      const newWidth = splitterDragStartWidth + deltaX;
      const maxWidth = containerWidth * 0.5; // 50% max
      const minWidth = 200; // Minimum width for DetailsPanel
      
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      
      updateInterfaceSettings({ detailsPanelWidth: clampedWidth });
    };
    
    const handleMouseUp = () => {
      setIsSplitterDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isSplitterDragging, splitterDragStartX, splitterDragStartWidth, interfaceSettings.panelsLayout, updateInterfaceSettings]);
  
  React.useEffect(() => {
    const clamp = (v: number) => Math.min(2.0, Math.max(1.0, Math.round(v * 100) / 100));
    const step = 0.05;

    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setUiScale((v) => clamp(v + step));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setUiScale((v) => clamp(v - step));
      } else if (e.key === '0') {
        e.preventDefault();
        setUiScale(1.0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    const clamp = (v: number) => Math.min(2.0, Math.max(0.5, Math.round(v * 100) / 100));
    const step = 0.05;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const direction = e.deltaY > 0 ? -1 : 1;
      setUiScale(v => clamp(v + direction * step));
    };

    window.addEventListener('wheel', onWheel as any, { passive: false } as any);
    return () => window.removeEventListener('wheel', onWheel as any);
  }, []);

  const theme = React.useMemo(
    () =>
      createTheme({
        palette: {
          mode: dark ? 'dark' : 'light',
          primary: {
            main: dark ? '#6366f1' : '#4f46e5',
            light: dark ? '#818cf8' : '#6366f1',
            dark: dark ? '#4f46e5' : '#4338ca',
          },
          secondary: {
            main: dark ? '#ec4899' : '#db2777',
            light: dark ? '#f472b6' : '#ec4899',
            dark: dark ? '#db2777' : '#be185d',
          },
          background: {
            default: dark ? '#0f172a' : '#f8fafc',
            paper: dark ? '#1e293b' : '#ffffff',
          },
        },
        shape: { borderRadius: 16 },
        typography: {
          fontSize: 15,
          fontFamily: '"Inter", "Segoe UI", "Roboto", "Helvetica", "Arial", sans-serif',
          h4: {
            fontWeight: 700,
            letterSpacing: '-0.02em',
          },
          h6: {
            fontWeight: 600,
          },
          button: {
            textTransform: 'none',
            fontWeight: 600,
          },
        },
        components: {
          MuiButton: {
            styleOverrides: {
              root: {
                borderRadius: 12,
                padding: '8px 20px',
                boxShadow: 'none',
                '&:hover': {
                  boxShadow: dark ? '0 4px 12px rgba(99, 102, 241, 0.3)' : '0 4px 12px rgba(79, 70, 229, 0.2)',
                  transform: 'translateY(-1px)',
                },
                transition: 'all 0.2s ease-in-out',
              },
              contained: {
                background: dark
                  ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                  : 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                backgroundSize: '200% 200%',
                transition: 'all 0.3s ease-in-out',
                '&:hover': {
                  background: dark
                    ? 'linear-gradient(135deg, #818cf8 0%, #a78bfa 100%)'
                    : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  backgroundSize: '200% 200%',
                  transform: 'translateY(-2px) scale(1.02)',
                  boxShadow: dark
                    ? '0 8px 24px rgba(99, 102, 241, 0.4)'
                    : '0 8px 24px rgba(79, 70, 229, 0.3)',
                },
                '&:active': {
                  transform: 'translateY(0) scale(0.98)',
                },
              },
            },
          },
          MuiPaper: {
            styleOverrides: {
              root: {
                backgroundImage: 'none',
                boxShadow: dark
                  ? '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)'
                  : '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                transition: 'all 0.3s ease-in-out',
                '&:hover': {
                  boxShadow: dark
                    ? '0 8px 16px -1px rgba(99, 102, 241, 0.2), 0 4px 8px -1px rgba(0, 0, 0, 0.3)'
                    : '0 8px 16px -1px rgba(79, 70, 229, 0.15), 0 4px 8px -1px rgba(0, 0, 0, 0.1)',
                },
              },
              elevation1: {
                boxShadow: dark
                  ? '0 1px 3px rgba(0, 0, 0, 0.3)'
                  : '0 1px 3px rgba(0, 0, 0, 0.12)',
              },
            },
          },
          MuiCard: {
            styleOverrides: {
              root: {
                borderRadius: 16,
                transition: 'all 0.2s ease-in-out',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  boxShadow: dark
                    ? '0 8px 16px rgba(0, 0, 0, 0.4)'
                    : '0 8px 16px rgba(0, 0, 0, 0.12)',
                },
              },
            },
          },
          MuiChip: {
            styleOverrides: {
              root: {
                borderRadius: 8,
                fontWeight: 500,
                transition: 'all 0.2s ease-in-out',
                '&:hover': {
                  transform: 'scale(1.05)',
                  boxShadow: dark
                    ? '0 2px 8px rgba(99, 102, 241, 0.3)'
                    : '0 2px 8px rgba(79, 70, 229, 0.2)',
                },
              },
            },
          },
          MuiAccordion: {
            styleOverrides: {
              root: {
                borderRadius: '12px !important',
                '&:before': { display: 'none' },
                boxShadow: 'none',
                border: `1px solid ${dark ? 'rgba(99, 102, 241, 0.1)' : 'rgba(79, 70, 229, 0.08)'}`,
                mb: 1,
                transition: 'all 0.3s ease-in-out',
                '&.Mui-expanded': {
                  bgcolor: dark ? 'rgba(99, 102, 241, 0.05)' : 'rgba(79, 70, 229, 0.03)',
                  border: `1px solid ${dark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(79, 70, 229, 0.15)'}`,
                },
                '&:hover': {
                  border: `1px solid ${dark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(79, 70, 229, 0.15)'}`,
                  bgcolor: dark ? 'rgba(99, 102, 241, 0.03)' : 'rgba(79, 70, 229, 0.02)',
                },
              },
            },
          },
          MuiAccordionSummary: {
            styleOverrides: {
              root: {
                borderRadius: 12,
                '&:hover': {
                  bgcolor: dark ? 'rgba(99, 102, 241, 0.08)' : 'rgba(79, 70, 229, 0.05)',
                },
                transition: 'all 0.2s ease-in-out',
              },
            },
          },
        },
      }),
    [dark],
  );

  // time zone selector (like YouTube)
  const systemTz = React.useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local', []);
  
  // Calculate system timezone offset in GMT format
  const systemTzOffset = React.useMemo(() => {
    const offsetMinutes = new Date().getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const offsetMins = Math.abs(offsetMinutes) % 60;
    const sign = offsetMinutes <= 0 ? '+' : '-';
    return `(GMT${sign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}) Local Time`;
  }, []);
  
  // Mapping from display label to IANA timezone identifier
  const tzLabelToIana = React.useMemo(() => {
    const map: Record<string, string> = {
      'SYSTEM': 'SYSTEM',
      '(GMT-10:00) Honolulu': 'Pacific/Honolulu',
      '(GMT-09:00) Anchorage': 'America/Anchorage',
      '(GMT-09:00) Juneau': 'America/Juneau',
      '(GMT-08:00) Los Angeles': 'America/Los_Angeles',
      '(GMT-08:00) Tijuana': 'America/Tijuana',
      '(GMT-08:00) Vancouver': 'America/Vancouver',
      '(GMT-07:00) Denver': 'America/Denver',
      '(GMT-07:00) Edmonton': 'America/Edmonton',
      '(GMT-07:00) Hermosillo': 'America/Hermosillo',
      '(GMT-07:00) Phoenix': 'America/Phoenix',
      '(GMT-06:00) Chicago': 'America/Chicago',
      '(GMT-06:00) Mexico City': 'America/Mexico_City',
      '(GMT-06:00) Winnipeg': 'America/Winnipeg',
      '(GMT-05:00) Bogotá': 'America/Bogota',
      '(GMT-05:00) Detroit': 'America/Detroit',
      '(GMT-05:00) Easter Island': 'Pacific/Easter',
      '(GMT-05:00) New York': 'America/New_York',
      '(GMT-05:00) Rio Branco': 'America/Rio_Branco',
      '(GMT-05:00) Toronto': 'America/Toronto',
      '(GMT-04:00) Halifax': 'America/Halifax',
      '(GMT-04:00) Manaus': 'America/Manaus',
      '(GMT-03:30) St John\'s': 'America/St_Johns',
      '(GMT-03:00) Bahia': 'America/Bahia',
      '(GMT-03:00) Belém': 'America/Belem',
      '(GMT-03:00) Buenos Aires': 'America/Buenos_Aires',
      '(GMT-03:00) Recife': 'America/Recife',
      '(GMT-03:00) Santiago': 'America/Santiago',
      '(GMT-03:00) São Paulo': 'America/Sao_Paulo',
      '(GMT-02:00) Fernando de Noronha': 'America/Noronha',
      '(GMT+00:00) Canaries': 'Atlantic/Canary',
      '(GMT+00:00) Dublin': 'Europe/Dublin',
      '(GMT+00:00) London': 'Europe/London',
      '(GMT+01:00) Algiers': 'Africa/Algiers',
      '(GMT+01:00) Amsterdam': 'Europe/Amsterdam',
      '(GMT+01:00) Berlin': 'Europe/Berlin',
      '(GMT+01:00) Brussels': 'Europe/Brussels',
      '(GMT+01:00) Budapest': 'Europe/Budapest',
      '(GMT+01:00) Casablanca': 'Africa/Casablanca',
      '(GMT+01:00) Lagos': 'Africa/Lagos',
      '(GMT+01:00) Madrid': 'Europe/Madrid',
      '(GMT+01:00) Paris': 'Europe/Paris',
      '(GMT+01:00) Prague': 'Europe/Prague',
      '(GMT+01:00) Rome': 'Europe/Rome',
      '(GMT+01:00) Stockholm': 'Europe/Stockholm',
      '(GMT+01:00) Tunis': 'Africa/Tunis',
      '(GMT+01:00) Warsaw': 'Europe/Warsaw',
      '(GMT+02:00) Cairo': 'Africa/Cairo',
      '(GMT+02:00) Jerusalem': 'Asia/Jerusalem',
      '(GMT+02:00) Johannesburg': 'Africa/Johannesburg',
      '(GMT+02:00) Kaliningrad': 'Europe/Kaliningrad',
      '(GMT+03:00) Aden': 'Asia/Aden',
      '(GMT+03:00) Amman': 'Asia/Amman',
      '(GMT+03:00) Kampala': 'Africa/Kampala',
      '(GMT+03:00) Moscow': 'Europe/Moscow',
      '(GMT+03:00) Nairobi': 'Africa/Nairobi',
      '(GMT+03:00) Riyadh': 'Asia/Riyadh',
      '(GMT+03:00) Volgograd': 'Europe/Volgograd',
      '(GMT+05:00) Yekaterinburg': 'Asia/Yekaterinburg',
      '(GMT+05:30) Kolkata': 'Asia/Kolkata',
      '(GMT+06:00) Omsk': 'Asia/Omsk',
      '(GMT+07:00) Krasnoyarsk': 'Asia/Krasnoyarsk',
      '(GMT+07:00) Novosibirsk': 'Asia/Novosibirsk',
      '(GMT+08:00) Hong Kong': 'Asia/Hong_Kong',
      '(GMT+08:00) Irkutsk': 'Asia/Irkutsk',
      '(GMT+08:00) Manila': 'Asia/Manila',
      '(GMT+08:00) Perth': 'Australia/Perth',
      '(GMT+08:00) Singapore': 'Asia/Singapore',
      '(GMT+08:00) Taipei': 'Asia/Taipei',
      '(GMT+08:45) Eucla': 'Australia/Eucla',
      '(GMT+09:00) Seoul': 'Asia/Seoul',
      '(GMT+09:00) Tokyo': 'Asia/Tokyo',
      '(GMT+09:00) Yakutsk': 'Asia/Yakutsk',
      '(GMT+09:30) Darwin': 'Australia/Darwin',
      '(GMT+10:00) Brisbane': 'Australia/Brisbane',
      '(GMT+10:00) Vladivostok': 'Asia/Vladivostok',
      '(GMT+10:30) Adelaide': 'Australia/Adelaide',
      '(GMT+11:00) Hobart': 'Australia/Hobart',
      '(GMT+11:00) Melbourne': 'Australia/Melbourne',
      '(GMT+11:00) Sakhalin': 'Asia/Sakhalin',
      '(GMT+11:00) Sydney': 'Australia/Sydney',
      '(GMT+12:00) Kamchatka': 'Asia/Kamchatka',
      '(GMT+13:00) Auckland': 'Pacific/Auckland',
      '(GMT+13:45) Chatham Islands': 'Pacific/Chatham',
    };
    return map;
  }, []);
  
  
  const tzOptions = React.useMemo(() => {
    return Object.keys(tzLabelToIana);
  }, [tzLabelToIana]);
  // Helper to convert timezone label to IANA identifier
  const getIanaTimeZone = React.useCallback((tz: string): string => {
    if (tz === 'SYSTEM') return 'SYSTEM';
    // If it starts with "(GMT", it's a label - convert to IANA
    if (tz.startsWith('(GMT')) {
      return tzLabelToIana[tz] || 'UTC';
    }
    // Otherwise assume it's already IANA (for backward compatibility)
    return tz;
  }, [tzLabelToIana]);
  
  
  const [timeZoneId, setTimeZoneId] = React.useState<string>('SYSTEM');

  // STABLE ROWS STORE: Use Map to maintain referential stability
  // DataGrid resets scroll when rows array identity changes, so we update only changed rows
  // This prevents scroll reset when status updates (Processing → Done) occur
  const [rowsById, setRowsById] = React.useState<Map<string, JobRow>>(new Map());
  const [, setMetadataUpdateCounter] = React.useState(0);
  
  // SEPARATE LOGS STATE: Pipeline logs stored separately to avoid rebuilding rows on every log append
  // This prevents DataGrid from resetting scroll when logs update frequently
  const [logsById, setLogsById] = React.useState<Map<string, string>>(new Map());
  
  // Helper: Update a single row in rowsById (maintains referential stability for unchanged rows)
  const updateRow = React.useCallback((rowId: string, updater: (row: JobRow) => JobRow) => {
    setRowsById((prev) => {
      const row = prev.get(rowId);
      if (!row) return prev; // Row doesn't exist, no change
      const updated = updater(row);
      // Only create new Map if row actually changed
      if (updated === row) return prev;
      const next = new Map(prev);
      next.set(rowId, updated);
      return next;
    });
  }, []);
  
  // Helper: Update multiple rows (for batch operations)
  const updateRows = React.useCallback((updater: (rows: Map<string, JobRow>) => Map<string, JobRow>) => {
    setRowsById((prev) => {
      const next = updater(prev);
      if (next !== prev) {
        // Increment data revision to trigger scroll restoration if needed
        setDataRevision((rev) => rev + 1);
      }
      return next === prev ? prev : next;
    });
  }, []);
  
  // Helper: Set all rows (for initial load or major changes)
  const setAllRows = React.useCallback((newRows: JobRow[]) => {
    const newMap = new Map<string, JobRow>();
    const newLogsMap = new Map<string, string>();
    for (const row of newRows) {
      newMap.set(row.id, row);
      // Initialize logs state for new rows (extract log from row)
      if (row.log) {
        newLogsMap.set(row.id, row.log);
      }
    }
    setRowsById(newMap);
    setLogsById(newLogsMap);
    // Increment dataRevision for major changes (setAllRows is typically used for initial load or undo/redo)
    setDataRevision((rev) => rev + 1);
  }, []);

  const [libraryLoaded, setLibraryLoaded] = React.useState(false);
  const libraryLoadedRef = React.useRef(false);
  const librarySaveTimerRef = React.useRef<number | null>(null);
  const libraryLoadRetryRef = React.useRef<number | null>(null);
  const rowsByIdRef = React.useRef(rowsById);
  React.useEffect(() => {
    rowsByIdRef.current = rowsById;
  }, [rowsById]);
  React.useEffect(() => {
    libraryLoadedRef.current = libraryLoaded;
  }, [libraryLoaded]);

  const getIdTimestamp = React.useCallback((id: string): number | null => {
    const idParts = String(id || '').split('-');
    const idTimestampStr = idParts.length > 0 ? idParts[0] : null;
    const idTimestamp = idTimestampStr ? Number(idTimestampStr) : null;
    if (idTimestamp != null && Number.isFinite(idTimestamp) && idTimestamp > 0) {
      return idTimestamp;
    }
    return null;
  }, []);

  const normalizeLibraryRow = React.useCallback((raw: any): JobRow | null => {
    if (!raw || typeof raw !== 'object') return null;
    const filePath = typeof raw.filePath === 'string' ? raw.filePath : '';
    if (!filePath) return null;
    const filename = typeof raw.filename === 'string' && raw.filename.trim() ? raw.filename : baseName(filePath);
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : `${Date.now()}-${newId()}`;
    const idTimestamp = getIdTimestamp(id);
    const addedAt =
      typeof raw.addedAt === 'number' && Number.isFinite(raw.addedAt) && raw.addedAt > 0
        ? raw.addedAt
        : idTimestamp ?? Date.now();
    const createdAt =
      typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) && raw.createdAt > 0
        ? raw.createdAt
        : undefined;
    const publishAt =
      typeof raw.publishAt === 'number' && Number.isFinite(raw.publishAt) ? raw.publishAt : null;
    const publishMode = raw.publishMode === 'schedule' || raw.publishMode === 'now'
      ? raw.publishMode
      : publishAt != null
        ? 'schedule'
        : 'now';
    const publishSource = raw.publishSource === 'auto' || raw.publishSource === 'manual'
      ? raw.publishSource
      : 'manual';
    const status = raw.status === 'Ready' || raw.status === 'Processing' || raw.status === 'Done' || raw.status === 'Error' || raw.status === 'Assist' || raw.status === 'Info'
      ? raw.status
      : 'Ready';
    const visibility = raw.visibility === 'private' || raw.visibility === 'unlisted' || raw.visibility === 'public'
      ? raw.visibility
      : 'private';
    const targets = raw.targets && typeof raw.targets === 'object'
      ? {
          youtube: !!raw.targets.youtube,
          instagram: !!raw.targets.instagram,
          tiktok: !!raw.targets.tiktok,
        }
      : undefined;
    const upload = raw.upload && typeof raw.upload === 'object' ? raw.upload : undefined;
    const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : undefined;
    const log = typeof raw.log === 'string' ? raw.log : '';

    return {
      id,
      filePath,
      filename,
      status,
      visibility,
      selfDeclaredMadeForKids: raw.selfDeclaredMadeForKids === true ? true : raw.selfDeclaredMadeForKids === false ? false : undefined,
      publishMode,
      publishAt,
      publishSource,
      log,
      createdAt,
      addedAt,
      targets,
      upload,
      meta,
    };
  }, [getIdTimestamp]);

  const normalizeLibraryPayload = React.useCallback((payload: any): JobRow[] => {
    const rawRows = Array.isArray(payload)
      ? payload
      : payload && Array.isArray(payload.rows)
        ? payload.rows
        : [];
    const seen = new Set<string>();
    const normalized: JobRow[] = [];
    for (const raw of rawRows) {
      const row = normalizeLibraryRow(raw);
      if (!row) continue;
      const key = normalizeRowPrefsKey(row.filePath);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      normalized.push(row);
    }
    return normalized;
  }, [normalizeLibraryRow, normalizeRowPrefsKey]);

  const markMissingRows = React.useCallback(async (rowsToCheck: JobRow[]): Promise<JobRow[]> => {
    const checker = window.api?.getFileStats;
    if (typeof checker !== 'function' || rowsToCheck.length === 0) {
      return rowsToCheck;
    }
    const missingMessage = 'File missing on disk. Re-import or remove this row.';
    const checked = await Promise.all(
      rowsToCheck.map(async (row) => {
        try {
          const stats = await checker(row.filePath);
          if (stats?.ok) return row;
        } catch {
          // treat as missing if stats fails
        }
        const nextLog = row.log ? `${row.log}\n${missingMessage}` : missingMessage;
        return { ...row, status: 'Error', log: nextLog };
      }),
    );
    return checked;
  }, []);

  const mergeLibraryRows = React.useCallback((existing: JobRow[], loaded: JobRow[]): JobRow[] => {
    const byPath = new Set<string>();
    const merged: JobRow[] = [];
    for (const row of loaded) {
      const key = normalizeRowPrefsKey(row.filePath);
      if (!key || byPath.has(key)) continue;
      byPath.add(key);
      merged.push(row);
    }
    for (const row of existing) {
      const key = normalizeRowPrefsKey(row.filePath);
      if (!key || byPath.has(key)) continue;
      byPath.add(key);
      merged.push(row);
    }
    return merged;
  }, [normalizeRowPrefsKey]);

  const loadLibrary = React.useCallback(async () => {
    const api = window.api;
    if (!api?.libraryLoad) {
      libraryLoadedRef.current = true;
      setLibraryLoaded(true);
      return;
    }
    try {
      const payload = await api.libraryLoad();
      const normalized = normalizeLibraryPayload(payload);
      const checked = await markMissingRows(normalized);
      const existingRows = Array.from(rowsByIdRef.current.values());
      const merged = mergeLibraryRows(existingRows, checked);
      if (merged.length > 0 || existingRows.length > 0) {
        setAllRows(merged);
      }
    } catch (e) {
      console.error('Failed to load library:', e);
    } finally {
      libraryLoadedRef.current = true;
      setLibraryLoaded(true);
    }
  }, [markMissingRows, mergeLibraryRows, normalizeLibraryPayload, setAllRows]);

  React.useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const tryLoad = () => {
      if (cancelled) return;
      const api: any = (window as any).api;
      if (api?.libraryLoad) {
        void loadLibrary();
        return;
      }
      attempts += 1;
      if (attempts < 50) {
        libraryLoadRetryRef.current = window.setTimeout(tryLoad, 200);
      } else {
        libraryLoadedRef.current = true;
        setLibraryLoaded(true);
      }
    };
    tryLoad();
    return () => {
      cancelled = true;
      if (libraryLoadRetryRef.current != null) {
        window.clearTimeout(libraryLoadRetryRef.current);
      }
    };
  }, [loadLibrary]);

  React.useEffect(() => {
    if (!libraryLoadedRef.current) return;
    const saver = window.api?.librarySave;
    if (typeof saver !== 'function') return;
    if (librarySaveTimerRef.current != null) {
      window.clearTimeout(librarySaveTimerRef.current);
    }
    librarySaveTimerRef.current = window.setTimeout(() => {
      try {
        const rowsToSave = Array.from(rowsById.values()).filter((row) => row.filePath);
        void saver({ version: 1, updatedAt: Date.now(), rows: rowsToSave });
      } catch {
        // ignore
      }
    }, 250);
  }, [rowsById]);
  
  // Derive rows array from rowsById - this ensures stable identity when no rows change
  // Only creates new array when rowsById Map reference changes (i.e., when a row is actually updated)
  // Merge logs from separate logsById state into rows (logs don't trigger row rebuilds)
  const rows = React.useMemo(() => {
    const rowsArray = Array.from(rowsById.values());
    // Merge logs from separate state (logs updates don't rebuild rows)
    return rowsArray.map(row => {
      const log = logsById.get(row.id);
      return log !== undefined ? { ...row, log } : row;
    });
  }, [rowsById, logsById]);
  // Track recently deleted metadata to prevent refreshOutputsForPath from restoring it
  const recentlyDeletedMetadataRef = React.useRef<Map<string, Set<string>>>(new Map());
  const gridApiRef = useGridApiRef();
  const userResizedColumnsRef = React.useRef(false);
  const autosizeTimerRef = React.useRef<number | null>(null);
  // Track if autosize is programmatic (not user-driven) to prevent onColumnResize from blocking future autosize
  const isProgrammaticAutosizeRef = React.useRef(false);
  // Track dataset revisions (import/add/remove rows) separately from status/log updates
  // This allows autosize to trigger only on actual data changes, not on every status tick
  const [datasetRevision, setDatasetRevision] = React.useState(0);
  const previousRowsSizeRef = React.useRef(rowsById.size);
  
  // Persist column widths using MUI's recommended approach
  // Store column widths in state and restore them via initialState
  const [columnWidths, setColumnWidths] = React.useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('dataGridColumnWidths');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed === 'object' && parsed !== null) {
          // Reset platform column widths to use new defaults (220px instead of 180px)
          // This ensures cells with "Schedule" button have width for scheduled time display
          const updated = { ...parsed };
          // Remove old saved widths for platform columns to force new defaults
          delete updated.youtube;
          delete updated.instagram;
          delete updated.tiktok;
          // Remove 'targets' column if it exists (column was removed from UI)
          delete updated.targets;
          return updated;
        }
      }
    } catch (e) {
      // ignore
    }
    return {};
  });
  
  // Save column widths to localStorage whenever they change
  React.useEffect(() => {
    try {
      localStorage.setItem('dataGridColumnWidths', JSON.stringify(columnWidths));
    } catch (e) {
      // ignore
    }
  }, [columnWidths]);
  const appliedPlatformDefaultWidthsRef = React.useRef(false);

  // Ensure platform columns default to "scheduled" width even without autosize
  React.useEffect(() => {
    if (appliedPlatformDefaultWidthsRef.current) return;

    const hasSavedPlatformWidth =
      columnWidths.youtube != null || columnWidths.instagram != null || columnWidths.tiktok != null;
    if (hasSavedPlatformWidth) {
      appliedPlatformDefaultWidthsRef.current = true;
      return;
    }

    const api = gridApiRef.current as any;
    if (!api?.setColumnWidth) return;

    const applyDefaults = () => {
      try {
        const gridElement = document.querySelector('.MuiDataGrid-root');
        if (!gridElement) {
          window.setTimeout(applyDefaults, 100);
          return;
        }

        const defaultWidth = 170;
        api.setColumnWidth('youtube', defaultWidth);
        api.setColumnWidth('instagram', defaultWidth);
        api.setColumnWidth('tiktok', defaultWidth);

        setColumnWidths((prev) => ({
          ...prev,
          youtube: defaultWidth,
          instagram: defaultWidth,
          tiktok: defaultWidth,
        }));

        appliedPlatformDefaultWidthsRef.current = true;
      } catch {
        // ignore
      }
    };

    requestAnimationFrame(() => requestAnimationFrame(applyDefaults));
  }, [gridApiRef, columnWidths]);
  // Scroll preservation refs for delete operations
  const pendingRestoreRef = React.useRef<{ top: number; left: number; ts: number } | null>(null);
  const isUserScrollingRef = React.useRef(false);
  const scrollTimeoutRef = React.useRef<number | null>(null);
  // Track data revision to trigger scroll restoration
  const [dataRevision, setDataRevision] = React.useState(0);
  // Get initial pagination and scroll from localStorage
  const getInitialPagination = () => {
    try {
      const savedPaginationStr = localStorage.getItem('dataGridPagination');
      if (savedPaginationStr) {
        const savedPagination = JSON.parse(savedPaginationStr);
        if (savedPagination && typeof savedPagination.page === 'number' && typeof savedPagination.pageSize === 'number') {
          if (savedPagination.page >= 0 && savedPagination.pageSize > 0) {
            return { page: savedPagination.page, pageSize: savedPagination.pageSize };
          }
        }
      }
    } catch (e) {
      console.warn('[PAGINATION] Failed to restore pagination from localStorage:', e);
    }
    return { page: 0, pageSize: 25 };
  };

  const getInitialScroll = () => {
    try {
      const savedScrollStr = localStorage.getItem('dataGridScrollPosition');
      if (savedScrollStr) {
        const savedScroll = JSON.parse(savedScrollStr);
        if (savedScroll && typeof savedScroll.top === 'number' && typeof savedScroll.left === 'number') {
          if (savedScroll.top > 0 || savedScroll.left > 0) {
            return { top: savedScroll.top, left: savedScroll.left };
          }
        }
      }
    } catch (e) {
      // Ignore
    }
    return { top: 0, left: 0 };
  };

  const getInitialSort = () => {
    try {
      const savedSortStr = localStorage.getItem('dataGridSortModel');
      if (savedSortStr) {
        const savedSort = JSON.parse(savedSortStr);
        if (Array.isArray(savedSort) && savedSort.length > 0) {
          return savedSort;
        }
      }
    } catch (e) {
      // Ignore
    }
    return [];
  };

  const [paginationModel, setPaginationModel] = React.useState(getInitialPagination);
  const [sortModel, setSortModel] = React.useState<Array<{ field: string; sort: 'asc' | 'desc' }>>(getInitialSort);
  const lastScrollTimeRef = React.useRef<number>(0);
  const initialScroll = React.useMemo(() => getInitialScroll(), []);
  const scrollRestoredRef = React.useRef(false);
  const [addDialogOpen, setAddDialogOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<'all' | 'needsAction' | 'ready' | 'scheduled' | 'processing' | 'done' | 'failed'>('all');
  const [showArchived, setShowArchived] = React.useState(false);
  const [autoArchiveEnabledFromSettings, setAutoArchiveEnabledFromSettings] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [scheduleDialogOpen, setScheduleDialogOpen] = React.useState(false);
  const [scheduleDialogRow, setScheduleDialogRow] = React.useState<JobRow | null>(null);
  const [scheduleDialogPlatform, setScheduleDialogPlatform] = React.useState<MetaPlatform | null>(null);
  const [scheduleDialogMode, setScheduleDialogMode] = React.useState<'now' | 'assist' | 'later'>('later');
  const [scheduleDialogDateTime, setScheduleDialogDateTime] = React.useState<string>('');
  
  const [sortBy, setSortBy] = React.useState<'name' | 'date' | 'added'>('added');
  const [sortOrder, setSortOrder] = React.useState<'asc' | 'desc'>('asc'); // 'asc' = ascending (oldest first), 'desc' = descending (newest first)
  const [sortMenuAnchor, setSortMenuAnchor] = React.useState<HTMLElement | null>(null);
  const [selectionModel, setSelectionModel] = React.useState<GridRowSelectionModel>({
    type: 'include',
    ids: new Set(),
  });
  const [detailsOpen, setDetailsOpen] = React.useState<{
    metadata: boolean;
    schedule: boolean;
    jobs: boolean;
    file: boolean;
    log: boolean;
  }>({ metadata: true, schedule: true, jobs: false, file: true, log: false });

  const collapseDetails = () => setDetailsOpen({ metadata: true, schedule: false, jobs: false, file: false, log: false });
  const expandDetails = () => setDetailsOpen({ metadata: true, schedule: true, jobs: true, file: true, log: true });

  const [metaLoadingFor, setMetaLoadingFor] = React.useState<string | null>(null);
  const [metaPlatform, setMetaPlatform] = React.useState<MetaPlatform>('youtube');
  /** File paths for which metadata generation is currently running or queued (single-flight per file). */
  const [metadataGenerationBusyPaths, setMetadataGenerationBusyPaths] = React.useState<ReadonlySet<string>>(new Set());
  const metadataBusyPathsRef = React.useRef<Set<string>>(new Set());
  const metadataQueueRef = React.useRef<MetadataQueueItem[]>([]);
  const metadataActiveRef = React.useRef<MetadataQueueItem | null>(null);
  const metadataCancelRef = React.useRef<{ id: string; reason: 'user' | 'shortcut' | 'shutdown' } | null>(null);
  const [metadataQueueCounts, setMetadataQueueCounts] = React.useState<{ running: number; queued: number }>({ running: 0, queued: 0 });
  const [snack, setSnack] = React.useState<string | null>(null);
  React.useEffect(() => {
    metadataBusyPathsRef.current = new Set(metadataGenerationBusyPaths);
  }, [metadataGenerationBusyPaths]);

  const refreshMetadataQueueCounts = React.useCallback(() => {
    setMetadataQueueCounts({
      running: metadataActiveRef.current ? 1 : 0,
      queued: metadataQueueRef.current.length,
    });
  }, []);

  const addMetadataBusyPaths = React.useCallback((paths: string[]) => {
    if (!paths.length) return;
    setMetadataGenerationBusyPaths((prev) => {
      const next = new Set(prev);
      paths.forEach((p) => next.add(p));
      metadataBusyPathsRef.current = new Set(next);
      return next;
    });
  }, []);

  const removeMetadataBusyPaths = React.useCallback((paths: string[]) => {
    if (!paths.length) return;
    setMetadataGenerationBusyPaths((prev) => {
      const next = new Set(prev);
      paths.forEach((p) => next.delete(p));
      metadataBusyPathsRef.current = new Set(next);
      return next;
    });
  }, []);

  const stopCurrentMetadataJob = React.useCallback(async (reason: 'user' | 'shortcut' | 'shutdown' = 'user') => {
    const activeJob = metadataActiveRef.current;
    if (!activeJob) return false;
    metadataCancelRef.current = { id: activeJob.id, reason };
    try {
      await window.api?.cancelPipeline?.({ reason });
    } catch (e) {
      console.error('[metadata] Failed to cancel pipeline:', e);
    }
    return true;
  }, []);

  const cancelQueuedMetadataJobs = React.useCallback(() => {
    const queued = metadataQueueRef.current;
    if (queued.length === 0) return { count: 0 };
    metadataQueueRef.current = [];
    refreshMetadataQueueCounts();
    const paths = new Set<string>();
    for (const job of queued) {
      job.filePaths.forEach((p) => paths.add(p));
    }
    removeMetadataBusyPaths(Array.from(paths));
    return { count: paths.size };
  }, [refreshMetadataQueueCounts, removeMetadataBusyPaths]);

  const stopAllMetadataJobs = React.useCallback(async (reason: 'user' | 'shortcut' | 'shutdown' = 'user') => {
    const stoppedCurrent = await stopCurrentMetadataJob(reason);
    const { count } = cancelQueuedMetadataJobs();
    if (stoppedCurrent || count > 0) {
      setSnack(t('metadataAllJobsStopped'));
    }
  }, [cancelQueuedMetadataJobs, setSnack, stopCurrentMetadataJob, t]);

  const handleStopCurrentMetadata = React.useCallback(async () => {
    const stopped = await stopCurrentMetadataJob('user');
    if (stopped) setSnack(t('metadataRunningJobStopped'));
  }, [setSnack, stopCurrentMetadataJob, t]);

  const handleCancelQueuedMetadata = React.useCallback(() => {
    const { count } = cancelQueuedMetadataJobs();
    if (count > 0) setSnack(t('metadataQueuedJobsCancelled', { count }));
  }, [cancelQueuedMetadataJobs, setSnack, t]);
  React.useEffect(() => {
    const prev = lastNetworkStatusRef.current;
    if (!prev) {
      lastNetworkStatusRef.current = networkStatus;
      return;
    }
    if (prev !== 'offline' && networkStatus === 'offline') {
      setSnack('No internet connection. Please reconnect to continue.');
    }
    if (prev === 'offline' && networkStatus === 'online') {
      setSnack('Back online.');
    }
    lastNetworkStatusRef.current = networkStatus;
  }, [networkStatus, setSnack]);
  React.useEffect(() => {
    if (networkStatus !== 'online') return;
    if (offlineDialogOpenRef.current) {
      closeOfflineDialog();
    }
  }, [closeOfflineDialog, networkStatus]);
  const ensureSignedIn = React.useCallback((): boolean => {
    if (planAccess.isSignedIn) return true;
    setBillingGateReason('sign_in');
    return false;
  }, [planAccess.isSignedIn]);
  const extractBillingErrorText = React.useCallback((err: unknown): string => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const candidate = err as {
        message?: unknown;
        details?: unknown;
        hint?: unknown;
        code?: unknown;
        status?: unknown;
      };
      const parts: string[] = [];
      for (const value of [candidate.message, candidate.details, candidate.hint, candidate.code, candidate.status]) {
        if (typeof value === 'string' && value.trim()) {
          parts.push(value);
        } else if (typeof value === 'number' && Number.isFinite(value)) {
          parts.push(String(value));
        }
      }
      if (parts.length > 0) return parts.join(' | ');
    }
    return String(err);
  }, []);
  const handleLimitExceeded = React.useCallback(async (kind: 'metadata' | 'upload') => {
    setSnack('Limit reached. Upgrade to continue.');
    try {
      const snapshot = await getUsageSnapshot();
      setUsageSnapshot(snapshot);
      setLimitDialog({ open: true, kind, snapshot });
    } catch (err) {
      handleNetworkError(err);
      setLimitDialog({ open: true, kind, snapshot: null });
    }
  }, [handleNetworkError, setSnack]);
  const handleBillingError = React.useCallback((err: unknown, kind?: 'metadata' | 'upload'): boolean => {
    if (handleNetworkError(err)) {
      return true;
    }
    const message = extractBillingErrorText(err);
    const normalized = message.toLowerCase();
    if (normalized.includes('not_subscribed')) {
      setBillingGateReason('not_subscribed');
      return true;
    }
    if (normalized.includes('limit_exceeded') || normalized.includes('limit_reached')) {
      if (kind) {
        void handleLimitExceeded(kind);
      } else {
        setBillingGateReason('limit_exceeded');
      }
      return true;
    }
    setSnack('Billing check failed. Try again.');
    return false;
  }, [extractBillingErrorText, handleLimitExceeded, handleNetworkError, setSnack]);
  const createRequestId = React.useCallback(() => {
    const c = typeof crypto !== 'undefined' ? crypto : undefined;
    if (c && typeof c.randomUUID === 'function') {
      return c.randomUUID();
    }
    if (c && typeof c.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      c.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = Math.floor(Math.random() * 16);
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }, []);
  const reserveQuotaForRows = React.useCallback(async (
    rows: JobRow[],
    kind: 'metadata' | 'upload',
  ) => {
    const reservations = new Map<string, string>();
    try {
      for (const row of rows) {
        const requestId = createRequestId();
        const reservation = kind === 'metadata'
          ? await reserveMetadata(requestId, 1)
          : await reserveUpload(requestId, 1);
        reservations.set(row.filePath, reservation.reservation_id);
      }
    } catch (err) {
      const reservationIds = Array.from(reservations.values());
      await Promise.all(
        reservationIds.map((reservationId) => releaseQuota(reservationId).catch(() => null)),
      );
      throw err;
    }
    return reservations;
  }, [createRequestId, releaseQuota, reserveMetadata, reserveUpload]);
  const refreshUsageSnapshot = React.useCallback(async () => {
    if (!planAccess.isSignedIn) {
      setUsageSnapshot(null);
      setUsageLoading(false);
      return;
    }
    if (!requireOnline({ showDialog: false })) {
      setUsageLoading(false);
      return;
    }
    setUsageLoading(true);
    try {
      const snapshot = await getUsageSnapshot();
      setUsageSnapshot(snapshot);
    } catch (err) {
      if (handleNetworkError(err)) {
        return;
      }
      const message = extractBillingErrorText(err);
      const normalized = message.toLowerCase();
      if (!normalized.includes('not_subscribed') && !normalized.includes('not_authenticated')) {
        setSnack('Billing check failed. Try again.');
      }
      setUsageSnapshot(null);
    } finally {
      setUsageLoading(false);
    }
  }, [extractBillingErrorText, handleNetworkError, planAccess.isSignedIn, requireOnline, setSnack]);
  const guardUploadAndScheduleAccess = React.useCallback((): boolean => {
    if (limitedMode) {
      setBillingGateReason('reconnect_required');
      return false;
    }
    if (!ensureSignedIn()) return false;
    if (planAccess.isActive) return true;
    setBillingGateReason('not_subscribed');
    return false;
  }, [limitedMode, ensureSignedIn, planAccess.isActive]);
  React.useEffect(() => {
    if (!accountDialogOpen) return;
    void refreshUsageSnapshot();
  }, [accountDialogOpen, refreshUsageSnapshot]);
  React.useEffect(() => {
    if (planAccess.isSignedIn) return;
    setUsageSnapshot(null);
    setUsageLoading(false);
  }, [planAccess.isSignedIn]);
  const [isDragging, setIsDragging] = React.useState(false);
  const [rowDragId, setRowDragId] = React.useState<string | null>(null);
  const [rowDragOverId, setRowDragOverId] = React.useState<string | null>(null);
  const rowDraggingRef = React.useRef(false);

  const getAddedSortKey = React.useCallback((r: JobRow): number => {
    const direct = (r as any).addedAt;
    if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct;
    const id = String(r.id || '');
    const ts = Number(id.split('-')[0]);
    if (Number.isFinite(ts) && ts > 0) return ts;
    return 0;
  }, []);

  const canManualReorder = React.useMemo(() => {
    return sortBy === 'added' && filter === 'all' && !searchQuery.trim();
  }, [sortBy, filter, searchQuery]);

  // Enable native HTML5 dragstart on DataGrid rows (otherwise dragstart only happens when text is selected).
  React.useEffect(() => {
    const apply = () => {
      const rows = document.querySelectorAll('.MuiDataGrid-row');
      rows.forEach((el) => {
        try {
          if (canManualReorder) {
            el.setAttribute('draggable', 'true');
          } else {
            el.removeAttribute('draggable');
          }
        } catch {
          // ignore
        }
      });
    };

    apply();

    const scroller = document.querySelector('.MuiDataGrid-virtualScroller');
    if (!scroller || !canManualReorder) return;

    // DataGrid virtualizes rows; observe DOM changes so new rows also become draggable.
    const obs = new MutationObserver(() => apply());
    obs.observe(scroller, { childList: true, subtree: true });
    return () => {
      try {
        obs.disconnect();
      } catch {
        // ignore
      }
    };
  }, [canManualReorder, rowsById.size]);

  const reorderRowsByDrop = React.useCallback(
    (sourceId: string, targetId: string | null, dropAfter: boolean) => {
      if (!canManualReorder) return;
      if (!sourceId) return;

      const orderMultiplier = sortOrder === 'asc' ? 1 : -1;
      const current = [...rowsRef.current].sort(
        (a, b) => (getAddedSortKey(a) - getAddedSortKey(b)) * orderMultiplier,
      );
      const from = current.findIndex((r) => r.id === sourceId);
      if (from < 0) return;

      const targetIndex = targetId ? current.findIndex((r) => r.id === targetId) : -1;
      const target = targetIndex >= 0 ? targetIndex : current.length - 1;

      const next = current.filter((r) => r.id !== sourceId);
      let insertAt = target + (dropAfter ? 1 : 0);
      if (from < insertAt) insertAt -= 1; // removal shifts indices
      insertAt = Math.max(0, Math.min(next.length, insertAt));

      const moved = current[from];
      next.splice(insertAt, 0, moved);

      // Renormalize addedAt so the new order is stable.
      const base = Date.now();
      const step = 100;
      const n = next.length;
      const map = new Map<string, number>();
      for (let i = 0; i < n; i++) {
        const key = sortOrder === 'asc' ? base + i * step : base + (n - 1 - i) * step;
        map.set(next[i].id, key);
      }

      // Update addedAt for rows - use updateRow to maintain referential stability
      for (const [rowId, addedAt] of map.entries()) {
        updateRow(rowId, (r) => ({ ...r, addedAt }));
      }
    },
    [canManualReorder, getAddedSortKey, sortOrder],
  );
  const copyToClipboard = React.useCallback(async (text: string) => {
    const value = text ?? '';
    try {
      // Prefer browser clipboard API
      // (works in Electron renderer in most setups)
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // Fallback to preload-provided API if available
        (window as any).api?.copyText?.(value);
      }
      setSnack(t('copied'));
    } catch {
      try {
        (window as any).api?.copyText?.(value);
        setSnack(t('copied'));
      } catch {
        setSnack(t('copied'));
      }
    }
  }, [t]);

  // YouTube connect status
  const [ytConnected, setYtConnected] = React.useState<boolean>(false);
  const refreshYtConnected = React.useCallback(async () => {
    try {
      const res = await window.api?.youtubeIsConnected?.();
      setYtConnected(Boolean((res as any)?.connected));
    } catch {
      setYtConnected(false);
    }
  }, []);

  const disconnectYouTube = React.useCallback(async () => {
    try {
      const res = await window.api?.secretsClearYouTubeTokens?.();
      if (!res?.ok) {
        setSnack(t('disconnectFailed'));
        return;
      }
      setSnack(t('youtubeDisconnected'));
    } catch (e) {
      console.error(e);
      setSnack(t('disconnectFailed'));
    } finally {
      void refreshYtConnected();
    }
  }, [refreshYtConnected, setSnack, t]);

  React.useEffect(() => {
    void refreshYtConnected();
  }, [refreshYtConnected]);

  // Load templates on mount
  React.useEffect(() => {
    const loadTemplates = async () => {
      try {
        const loaded = await window.api?.templatesLoad?.();
        if (Array.isArray(loaded)) {
          setTemplates(loaded);
        }
      } catch (e) {
        console.error('Failed to load templates:', e);
      }
    };
    void loadTemplates();
  }, []);

  const selectedIds = React.useMemo(() => {
    if (selectionModel.type === 'include') {
      // Include mode: ids contains selected row IDs
      return Array.from(selectionModel.ids) as string[];
    } else {
      // Exclude mode: ids contains excluded row IDs
      // Selected = all rows except excluded ones
      const excludedIds = new Set(selectionModel.ids);
      const rowsArray = Array.from(rowsById.values());
      return rowsArray.filter((r) => !excludedIds.has(r.id)).map((r) => r.id);
    }
  }, [selectionModel, rowsById]);

  const selectedRows = React.useMemo(() => {
    return selectedIds
      .map((id) => rowsById.get(id))
      .filter((r): r is JobRow => Boolean(r));
  }, [selectedIds, rowsById]);

  // Bulk edit dialog (Visibility + MFK) - enabled only for 2+ selected rows
  const [bulkEditOpen, setBulkEditOpen] = React.useState(false);
  const [bulkEditVisibilityChoice, setBulkEditVisibilityChoice] = React.useState<'' | Visibility>('');
  const [bulkEditMfkChoice, setBulkEditMfkChoice] = React.useState<'' | 'true' | 'false'>('');

  const bulkSelectedNames = React.useMemo(() => {
    return selectedRows
      .slice(0, 3)
      .map((r) => String(r.filename || baseName(r.filePath) || '').trim())
      .filter(Boolean);
  }, [selectedRows]);
  const [selectedRowId, setSelectedRowId] = React.useState<string | null>(null);
  const selectedRow = React.useMemo(() => rows.find((r) => r.id === selectedRowId) || null, [rows, selectedRowId]);

  // New UI state for dialogs
  const [plannerOpen, setPlannerOpen] = React.useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = React.useState(false);
  const [diagnosticsDialogOpen, setDiagnosticsDialogOpen] = React.useState(false);
  const [developerModeDialogOpen, setDeveloperModeDialogOpen] = React.useState(false);
  React.useEffect(() => {
    window.api?.getDeveloperOptions?.().then((opts) => {
      if (opts && typeof opts === 'object') {
        const on = Boolean(opts.autoArchivePosted);
        setAutoArchiveEnabledFromSettings(on);
        if (!on) setShowArchived(false);
      }
    }).catch(() => {});
  }, []);
  const [templateDialogOpen, setTemplateDialogOpen] = React.useState(false);
  const [templates, setTemplates] = React.useState<MetadataTemplate[]>([]);
  const [openEditorAllDialogOpen, setOpenEditorAllDialogOpen] = React.useState(false);
  
  // Context menu state
  const [contextMenu, setContextMenu] = React.useState<{
    mouseX: number;
    mouseY: number;
    rowId: string | null;
    platform?: 'youtube' | 'instagram' | 'tiktok' | null;
  } | null>(null);
  
  // Delete confirm dialog state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [itemsToDelete, setItemsToDelete] = React.useState<string[]>([]);
  const [deletedItems, setDeletedItems] = React.useState<JobRow[]>([]);
  const [undoSnackOpen, setUndoSnackOpen] = React.useState(false);
  const [deleteFromAppConfirmOpen, setDeleteFromAppConfirmOpen] = React.useState(false);
  const [itemsToDeleteFromApp, setItemsToDeleteFromApp] = React.useState<string[]>([]);

  // Scheduled Jobs
  type ScheduledJob = {
    id: string;
    filePath: string;
    publishAtUtcMs: number;
    targets: { youtube: boolean; instagram: boolean; tiktok: boolean };
    visibility?: 'private' | 'unlisted' | 'public';
    selfDeclaredMadeForKids?: boolean;
    createdAt: number;
    run?: {
      youtube?: { done: boolean; at: number; ok: boolean; videoId?: string; error?: string };
      instagram?: { done: boolean; at: number; ok: boolean; error?: string };
      tiktok?: { done: boolean; at: number; ok: boolean; error?: string };
    };
  };
  const [scheduledJobs, setScheduledJobs] = React.useState<ScheduledJob[]>([]);
  // Bump when loadJobs() completes so grid columns (stage, platform cells) re-render with correct schedule state (e.g. after reopen from tray)
  const [jobsLoadedVersion, setJobsLoadedVersion] = React.useState(0);
  const [jobPublishAt, setJobPublishAt] = React.useState<string>('');
  const [jobTargets, setJobTargets] = React.useState<{ youtube: boolean; instagram: boolean; tiktok: boolean }>({
    youtube: true,
    instagram: false,
    tiktok: false,
  });
  const getJobsForRow = React.useCallback(
    (row: JobRow, jobs: ScheduledJob[] = scheduledJobs) => {
      const rowKey = normalizeRowPrefsKey(row.filePath);
      let matched = jobs.filter((j) => normalizeRowPrefsKey(j.filePath) === rowKey);
      if (matched.length === 0) {
        const nameKey = normalizeFileNameKey(row.filePath);
        const byName = jobs.filter((j) => normalizeFileNameKey(j.filePath) === nameKey);
        if (byName.length === 1) {
          matched = byName;
        }
      }
      return matched;
    },
    [scheduledJobs, normalizeRowPrefsKey, normalizeFileNameKey],
  );

  // Undo/Redo system - must be defined early before functions that use it
  type HistoryState = {
    jobs: ScheduledJob[];
    rows?: JobRow[]; // Optional: only saved when rows are modified (e.g., file deletion)
    timestamp: number;
  };
  const [history, setHistory] = React.useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = React.useState<number>(-1);
  const [isUndoRedoInProgress, setIsUndoRedoInProgress] = React.useState(false);

  const loadJobs = React.useCallback(async () => {
    try {
      if (!window.api?.jobsLoad) {
        console.warn('jobsLoad API not available yet');
        setScheduledJobs([]);
        setJobsLoadedVersion((v) => v + 1);
        return;
      }
      const jobs = (await window.api.jobsLoad()) || [];
      setScheduledJobs(Array.isArray(jobs) ? jobs : []);
      setJobsLoadedVersion((v) => v + 1);

      // Don't update rows during undo/redo operations (they are restored from history)
      if (isUndoRedoInProgress) {
        return;
      }
      
      // Update rows with job run status (done/failed) from jobs.json
      // Update upload status from jobs - use updateRow to maintain referential stability
      updateRows((prev) => {
        let hasChanges = false;
        const next = new Map(prev);
        
        for (const row of prev.values()) {
          const rowKey = normalizeRowPrefsKey(row.filePath);
          let jobsForRow = jobs.filter((j: any) => normalizeRowPrefsKey(j.filePath) === rowKey);
          if (jobsForRow.length === 0) {
            const nameKey = normalizeFileNameKey(row.filePath);
            const byName = jobs.filter((j: any) => normalizeFileNameKey(j.filePath) === nameKey);
            if (byName.length === 1) {
              jobsForRow = byName;
            }
          }
          if (jobsForRow.length === 0) continue;
          
          // Merge run status from jobs into upload status.
          // IMPORTANT:
          // - Keep *Processing* optimistic UI (set before IPC finishes).
          // - Do NOT keep stale *Done/Error* states if jobs.json no longer has run[platform].done.
          //   Otherwise rapid toggles like "Unmark Posted" can appear to revert.
          const upload = { ...(row.upload || {}) };
          let uploadChanged = false;
          const doneFromJobs = { youtube: false, instagram: false, tiktok: false };
          for (const job of jobsForRow) {
            if (job.run) {
              if (job.run.youtube?.done) {
                doneFromJobs.youtube = true;
                upload.youtube = {
                  status: job.run.youtube.ok ? 'Done' : 'Error',
                  message: job.run.youtube.videoId || job.run.youtube.error || t('uploadCompletedForPlatform', { platform: platformLabels.youtube }),
                  updatedAt: job.run.youtube.at || Date.now(),
                };
                uploadChanged = true;
              }
              if (job.run.instagram?.done) {
                doneFromJobs.instagram = true;
                upload.instagram = {
                  status: job.run.instagram.ok ? 'Done' : 'Error',
                  message: job.run.instagram.error || t('postedOnPlatform', { platform: platformLabels.instagram }),
                  updatedAt: job.run.instagram.at || Date.now(),
                };
                uploadChanged = true;
              }
              if (job.run.tiktok?.done) {
                doneFromJobs.tiktok = true;
                upload.tiktok = {
                  status: job.run.tiktok.ok ? 'Done' : 'Error',
                  message: job.run.tiktok.error || t('postedOnPlatform', { platform: platformLabels.tiktok }),
                  updatedAt: job.run.tiktok.at || Date.now(),
                };
                uploadChanged = true;
              }
            }
          }

          // Drop stale completion states that are not backed by jobs.json anymore.
          // Keep only optimistic Processing states when not done.
          for (const platform of ['youtube', 'instagram', 'tiktok'] as const) {
            const u = upload[platform];
            if (!u) continue;
            if (doneFromJobs[platform]) continue;
            if (u.status === 'Processing') continue;
            delete upload[platform];
            uploadChanged = true;
          }
          
          // Check if upload object actually changed (deep comparison for upload status)
          const uploadActuallyChanged = uploadChanged || 
            JSON.stringify(upload) !== JSON.stringify(row.upload || {});
          
          // Update if upload changed OR if we need to preserve optimistic updates
          // This ensures UI updates immediately even if job.run[platform].done is not yet available
          if (uploadActuallyChanged) {
            hasChanges = true;
            next.set(row.id, { ...row, upload });
          }
        }
        
        return hasChanges ? next : prev;
      });
    } catch (e) {
      console.error('Failed to load jobs:', e);
      setScheduledJobs([]);
    }
  }, [isUndoRedoInProgress, normalizeRowPrefsKey, normalizeFileNameKey, updateRows]);

  const upsertJobRunForPlatform = React.useCallback(
    async (opts: {
      row: JobRow;
      platform: 'youtube' | 'instagram' | 'tiktok';
      ok: boolean;
      videoId?: string;
      error?: string;
      publishAtUtcMs?: number | null;
    }) => {
      const { row, platform, ok, videoId, error, publishAtUtcMs } = opts;
      const current = await window.api?.jobsLoad?.();
      const jobs = Array.isArray(current) ? current : [];

      const rowKey = normalizeRowPrefsKey(row.filePath);
      const nameKey = normalizeFileNameKey(row.filePath);
      const matched = jobs.filter((j) => {
        if (normalizeRowPrefsKey(j.filePath) === rowKey) return true;
        return normalizeFileNameKey(j.filePath) === nameKey;
      });
      let job = matched.find((j) => j.targets?.[platform] === true);

      if (!job) {
        const targets = { youtube: false, instagram: false, tiktok: false };
        targets[platform] = true;
        const now = Date.now();
        const initialPublishAt =
          typeof publishAtUtcMs === 'number'
            ? publishAtUtcMs
            : typeof row.publishAt === 'number'
              ? row.publishAt
              : now;
        job = {
          id: newId(),
          filePath: row.filePath,
          publishAtUtcMs: initialPublishAt,
          targets,
          visibility: row.visibility || 'private',
          selfDeclaredMadeForKids: row.selfDeclaredMadeForKids ?? false,
          createdAt: row.createdAt || now,
        };
        jobs.push(job);
      } else if (typeof publishAtUtcMs === 'number') {
        job.publishAtUtcMs = publishAtUtcMs;
      }

      job.run = job.run || {};
      job.run[platform] = {
        done: true,
        ok,
        at: Date.now(),
        ...(platform !== 'youtube' ? { mode: 'manual_assist' } : {}),
        ...(videoId ? { videoId } : {}),
        ...(error ? { error } : {}),
      };

      await window.api?.jobsSave?.(jobs);
      setScheduledJobs(jobs);
      // Wait for loadJobs to complete to ensure UI is updated
      await loadJobs();
      // Run data retention (auto-archive posted) so newly posted row can be archived if rules match
      window.api?.retentionRun?.().catch(() => {});
    },
    [normalizeRowPrefsKey, normalizeFileNameKey, setScheduledJobs, loadJobs],
  );

  const jobsLoadRetryRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const tryLoad = () => {
      if (cancelled) return;
      const api: any = (window as any).api;
      if (api?.jobsLoad) {
        void loadJobs();
        return;
      }
      attempts += 1;
      if (attempts < 50) {
        jobsLoadRetryRef.current = window.setTimeout(tryLoad, 200);
      }
    };
    tryLoad();
    return () => {
      cancelled = true;
      if (jobsLoadRetryRef.current != null) {
        window.clearTimeout(jobsLoadRetryRef.current);
      }
    };
  }, [loadJobs]);

  // When window is shown again (e.g. reopen from tray), re-fetch jobs so grid stage/cells stay in sync with Row Details and Assist Center
  React.useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadJobs();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [loadJobs]);

  // When jobs are loaded, create rows for files that have jobs but are not in rows
  // This ensures scheduled jobs are always visible, even after refresh/restart
  React.useEffect(() => {
    if (!libraryLoaded) return;
    if (scheduledJobs.length === 0) return;
    
    // Add new rows from scheduled jobs - use updateRows to maintain referential stability
    updateRows((prev) => {
      const existingFilePaths = new Set(Array.from(prev.values()).map(r => r.filePath.toLowerCase()));
      const newRows: JobRow[] = [];
      
      // Group jobs by filePath so multiple platform jobs create only one row.
      const byFile = new Map<string, ScheduledJob[]>();
      for (const job of scheduledJobs) {
        const k = String(job.filePath || '').toLowerCase();
        if (!k) continue;
        const arr = byFile.get(k) ?? [];
        arr.push(job);
        byFile.set(k, arr);
      }

      for (const [filePathLower, jobsForFile] of byFile.entries()) {
        if (existingFilePaths.has(filePathLower)) continue;
        const filePath = jobsForFile[0]?.filePath;
        if (!filePath) continue;

        const mergedTargets = { youtube: false, instagram: false, tiktok: false };
        let mergedMadeForKids = false;
        let earliestPublishAt: number | null = null;
        let visibility: any = 'private';
        let createdAt = Date.now();
        for (const j of jobsForFile) {
          if (j.targets?.youtube) mergedTargets.youtube = true;
          if (j.targets?.instagram) mergedTargets.instagram = true;
          if (j.targets?.tiktok) mergedTargets.tiktok = true;
          const ms = Number(j.publishAtUtcMs);
          if (Number.isFinite(ms)) {
            earliestPublishAt = earliestPublishAt == null ? ms : Math.min(earliestPublishAt, ms);
          }
          if (j.selfDeclaredMadeForKids === true) mergedMadeForKids = true;
          if (j.visibility) visibility = j.visibility;
          if (j.createdAt) createdAt = Math.min(createdAt, j.createdAt);
        }

        const newRow: JobRow = {
          id: jobsForFile[0]?.id || newId(),
          filePath,
          filename: baseName(filePath),
          status: 'Ready',
          visibility,
          selfDeclaredMadeForKids: mergedMadeForKids,
          publishMode: 'schedule',
          publishAt: earliestPublishAt,
          publishSource: 'manual',
          log: '',
          createdAt: Date.now(),
          addedAt: createdAt,
          targets: mergedTargets,
        };
        newRows.push(newRow);
        existingFilePaths.add(filePathLower);
      }
      
      // If we have new rows, add them to the Map
      if (newRows.length > 0) {
        const next = new Map(prev);
        // Initialize logs for new rows
        setLogsById((prevLogs) => {
          const nextLogs = new Map(prevLogs);
          for (const row of newRows) {
            if (row.log) {
              nextLogs.set(row.id, row.log);
            }
          }
          return nextLogs.size > 0 ? nextLogs : prevLogs;
        });
        for (const row of newRows) {
          next.set(row.id, row);
        }
        return next;
      }
      
      return prev; // No changes
    });
  }, [scheduledJobs, normalizeFileNameKey, normalizeRowPrefsKey, libraryLoaded]);

  // Sync scheduled jobs with rows when both are available
  // This ensures scheduled jobs are always visible in the "Scheduled" filter, even after restart
  React.useEffect(() => {
    if (!libraryLoaded) return;
    const rowsArray = Array.from(rowsById.values());
    if (rowsArray.length === 0 || scheduledJobs.length === 0) return;
    
    // Sync scheduled jobs with rows - update only changed rows to maintain referential stability
    updateRows((prev) => {
      let hasChanges = false;
      const next = new Map(prev);
      
      for (const row of prev.values()) {
        // Find jobs for this row
        const rowKey = normalizeRowPrefsKey(row.filePath);
        let jobsForRow = scheduledJobs.filter(j => normalizeRowPrefsKey(j.filePath) === rowKey);
        if (jobsForRow.length === 0) {
          const nameKey = normalizeFileNameKey(row.filePath);
          const byName = scheduledJobs.filter(j => normalizeFileNameKey(j.filePath) === nameKey);
          if (byName.length === 1) {
            jobsForRow = byName;
          }
        }
        if (jobsForRow.length === 0) {
          // No scheduled jobs exist for this row.
          // Keep user preferences (targets/visibility) even if not scheduled yet,
          // but clear any stale schedule timestamp (job might have been removed).
          if (row.publishMode === 'schedule' && typeof row.publishAt === 'number') {
            hasChanges = true;
            next.set(row.id, {
              ...row,
              publishAt: null,
              publishMode: 'now' as const,
            });
          }
          // Keep the row with its current targets - don't remove it
          continue;
        }
        
        // Merge all targets from jobs
        const mergedTargets = { youtube: false, instagram: false, tiktok: false };
        let mergedMadeForKids = false;
        let earliestPublishAt: number | null = null;
        
        // Check if all active platforms are done
        let allActivePlatformsDone = true;
        const activePlatforms: ('youtube' | 'instagram' | 'tiktok')[] = [];
        
        for (const job of jobsForRow) {
          // Check if job.targets exists before accessing properties
          if (job.targets) {
            if (job.targets.youtube) {
              mergedTargets.youtube = true;
              activePlatforms.push('youtube');
              // Check if YouTube is done
              if (!job.run?.youtube?.done) {
                allActivePlatformsDone = false;
              }
            }
            if (job.targets.instagram) {
              mergedTargets.instagram = true;
              activePlatforms.push('instagram');
              // Check if Instagram is done
              if (!job.run?.instagram?.done) {
                allActivePlatformsDone = false;
              }
            }
            if (job.targets.tiktok) {
              mergedTargets.tiktok = true;
              activePlatforms.push('tiktok');
              // Check if TikTok is done
              if (!job.run?.tiktok?.done) {
                allActivePlatformsDone = false;
              }
            }
          }
          if (job.selfDeclaredMadeForKids === true) {
            mergedMadeForKids = true;
          }
          // Use the earliest publishAt (best represents the next planned time)
          // But only if not all platforms are done
          if (!allActivePlatformsDone && job.publishAtUtcMs && (!earliestPublishAt || job.publishAtUtcMs < earliestPublishAt)) {
            earliestPublishAt = job.publishAtUtcMs;
          }
        }
        
        // If all active platforms are done, clear publishAt and set publishMode to 'now'
        if (allActivePlatformsDone && activePlatforms.length > 0) {
          earliestPublishAt = null;
        }
        
        // Always update targets from jobs, even if all are false
        // This ensures row targets stay in sync with jobs
        
        // Check if update is needed
        const currentTargets = row.targets || { youtube: false, instagram: false, tiktok: false };
        const targetsChanged = 
          currentTargets.youtube !== mergedTargets.youtube ||
          currentTargets.instagram !== mergedTargets.instagram ||
          currentTargets.tiktok !== mergedTargets.tiktok;
        const publishAtChanged = row.publishAt !== earliestPublishAt;
        const publishModeChanged = (earliestPublishAt ? 'schedule' : 'now') !== row.publishMode;
        const madeForKidsChanged = (row.selfDeclaredMadeForKids ?? false) !== mergedMadeForKids;
        
        if (targetsChanged || publishAtChanged || publishModeChanged || madeForKidsChanged) {
          hasChanges = true;
          next.set(row.id, {
            ...row,
            targets: mergedTargets,
            selfDeclaredMadeForKids: mergedMadeForKids,
            publishAt: earliestPublishAt,
            publishMode: earliestPublishAt ? 'schedule' as const : 'now' as const,
          });
        }
      }
      
      return hasChanges ? next : prev;
    });
  }, [rowsById, scheduledJobs, normalizeRowPrefsKey, normalizeFileNameKey, libraryLoaded]);

  const addJob = React.useCallback(async () => {
    if (!selectedRow) return;
    if (!jobPublishAt) {
      setSnack(t('selectPublishTime'));
      return;
    }
    const ms = parseDateTimeLocalValue(jobPublishAt, getIanaTimeZone(timeZoneId));
    if (!ms) {
      setSnack(t('invalidDateTime'));
      return;
    }
    const job: ScheduledJob = {
      id: newId(),
      filePath: selectedRow.filePath,
      publishAtUtcMs: ms,
      targets: { ...jobTargets },
      visibility: selectedRow.visibility || 'private',
      selfDeclaredMadeForKids: selectedRow.selfDeclaredMadeForKids ?? false,
      createdAt: Date.now(),
    };
    try {
      const current = await window.api?.jobsLoad?.();
      const jobs = Array.isArray(current) ? current : [];
      
      // Check if job already exists for this file
      const existingJobIndex = jobs.findIndex(j => j.filePath === selectedRow.filePath);
      if (existingJobIndex >= 0) {
        // Update existing job
        jobs[existingJobIndex].targets = { ...jobTargets };
        jobs[existingJobIndex].publishAtUtcMs = ms;
        jobs[existingJobIndex].selfDeclaredMadeForKids = selectedRow.selfDeclaredMadeForKids ?? false;
      } else {
        jobs.push(job);
      }
      
      await window.api?.jobsSave?.(jobs);
      setScheduledJobs(jobs);
      
      // Update row targets, publishAt, publishMode, and publishSource (manual scheduling)
      updateRow(selectedRow.id, (r) => ({
        ...r,
        targets: { ...jobTargets },
        publishAt: ms,
        publishMode: 'schedule' as const,
        publishSource: 'manual' as const, // Manual scheduling
      }));
      
      setJobPublishAt('');
      setSnack(t('jobAdded'));
    } catch (e) {
      console.error('Failed to save job:', e);
      setSnack(t('failedToAddJob'));
    }
  }, [selectedRow, jobPublishAt, jobTargets, timeZoneId]);

  // Open schedule dialog for a specific platform
  const openScheduleDialog = React.useCallback((row: JobRow, platform: MetaPlatform) => {
    if (!guardUploadAndScheduleAccess()) return;
    setScheduleDialogRow(row);
    setScheduleDialogPlatform(platform);
    setScheduleDialogMode('later');

    // If this row/platform already has a scheduled time, show it in the dialog.
    // Otherwise default to now + 1 hour.
    const existingJob = scheduledJobs.find(
      (j) => j.filePath === row.filePath && (j.targets?.[platform] ?? false),
    );
    const existingMs =
      existingJob?.publishAtUtcMs ??
      (row.publishMode === 'schedule' && typeof row.publishAt === 'number' ? row.publishAt : null);

    const msToShow = existingMs ?? (() => {
      const now = new Date();
      now.setHours(now.getHours() + 1);
      return now.getTime();
    })();

    setScheduleDialogDateTime(toDateTimeLocalValue(msToShow, getIanaTimeZone(timeZoneId)));
    setScheduleDialogOpen(true);
  }, [guardUploadAndScheduleAccess, timeZoneId, scheduledJobs]);

  // `autoEnabled` is declared later in this component; use a ref here to avoid TDZ.
  const autoEnabledRef = React.useRef<boolean>(true);

  // Save current state to history before an action
  const saveToHistory = React.useCallback(async (includeRows?: boolean) => {
    if (isUndoRedoInProgress) return; // Don't save history during undo/redo
    
    try {
      const current = await window.api?.jobsLoad?.();
      const jobs = Array.isArray(current) ? current : [];
      
      setHistory((prev) => {
        // Remove any history after current index (when doing new action after undo)
        const newHistory = prev.slice(0, historyIndex + 1);
        // Add new state
        const newState: HistoryState = {
          jobs: JSON.parse(JSON.stringify(jobs)), // Deep clone
          rows: includeRows ? JSON.parse(JSON.stringify(rows)) : undefined, // Deep clone rows if needed
          timestamp: Date.now(),
        };
        // Limit history to last 50 actions
        const updated = [...newHistory, newState].slice(-50);
        setHistoryIndex(updated.length - 1);
        return updated;
      });
    } catch (e) {
      console.error('Failed to save to history:', e);
    }
  }, [historyIndex, isUndoRedoInProgress, rows]);

  const updateTargetsForRow = React.useCallback(
    async (row: JobRow, nextTargets: { youtube: boolean; instagram: boolean; tiktok: boolean }) => {
      // Save to history before action (only if targets actually changed)
      const currentTargets = row.targets || { youtube: false, instagram: false, tiktok: false };
      const targetsChanged = 
        currentTargets.youtube !== nextTargets.youtube ||
        currentTargets.instagram !== nextTargets.instagram ||
        currentTargets.tiktok !== nextTargets.tiktok;
      
      if (targetsChanged) {
        await saveToHistory();
      }
      
      // Optimistic UI update
      updateRow(row.id, (r) => ({ ...r, targets: { ...nextTargets } }));

      const hasAnyTarget = nextTargets.youtube || nextTargets.instagram || nextTargets.tiktok;

      // If there are no targets, clear schedule info (a plan without targets is meaningless)
      if (!hasAnyTarget) {
        updateRow(row.id, (r) => ({ ...r, targets: { ...nextTargets }, publishAt: null, publishMode: 'now' as const }));
      }

      try {
        const current = await window.api?.jobsLoad?.();
        const jobs = Array.isArray(current) ? current : [];
        const fileJobs = jobs.filter((j) => j.filePath === row.filePath);

        // Persist row preferences even if there is no scheduled job yet.
        const prefKey = normalizeRowPrefsKey(row.filePath);
        setRowPrefs((prev) => {
          const existing = prev[prefKey] ?? {};
          const nextPref: RowPrefs = { ...existing, targets: { ...nextTargets } };

          // Cleanup: if prefs equal defaults, remove entry to keep file small.
          const defaultTargets = autoEnabledRef.current
            ? { youtube: true, instagram: false, tiktok: false }
            : { youtube: false, instagram: false, tiktok: false };
          const targetsIsDefault =
            nextTargets.youtube === defaultTargets.youtube &&
            nextTargets.instagram === defaultTargets.instagram &&
            nextTargets.tiktok === defaultTargets.tiktok;
          const visibilityIsDefault = (nextPref.visibility ?? 'private') === 'private';
          const madeForKidsIsDefault = (nextPref.selfDeclaredMadeForKids ?? false) === false;

          if (targetsIsDefault && visibilityIsDefault && madeForKidsIsDefault) {
            const { [prefKey]: _drop, ...rest } = prev;
            return rest;
          }

          return { ...prev, [prefKey]: nextPref };
        });

        // Don't create new jobs automatically; only update/remove existing ones.
        if (fileJobs.length === 0) {
          return;
        }

        // Get current targets from row to compare with next targets
        const currentTargets = row.targets || { youtube: false, instagram: false, tiktok: false };
        
        // Determine which targets were deselected
        const deselectedTargets: ('youtube' | 'instagram' | 'tiktok')[] = [];
        if (currentTargets.youtube && !nextTargets.youtube) deselectedTargets.push('youtube');
        if (currentTargets.instagram && !nextTargets.instagram) deselectedTargets.push('instagram');
        if (currentTargets.tiktok && !nextTargets.tiktok) deselectedTargets.push('tiktok');

        let nextJobs = jobs;
        
        // Remove jobs only for deselected targets, not all jobs for the file
        // BUT: Don't remove jobs that are already marked as "done" for the deselected target
        // This prevents rows from disappearing after "Assist now" + notification click
        if (deselectedTargets.length > 0) {
          nextJobs = jobs.filter((j) => {
            // Keep jobs that are not for this file
            if (j.filePath !== row.filePath) return true;
            
            // For jobs of this file, check if they should be removed
            const isDeselectedTarget = deselectedTargets.some(
              (target) => j.targets?.[target] === true
            );
            
            if (!isDeselectedTarget) {
              // Job doesn't have deselected target, keep it
              return true;
            }
            
            // Job has deselected target - check if it's already done for that target
            // If done, keep the job (just update targets) to preserve row
            const isDoneForDeselectedTarget = deselectedTargets.some((target) => {
              if (target === 'instagram') return j.run?.instagram?.done === true;
              if (target === 'tiktok') return j.run?.tiktok?.done === true;
              if (target === 'youtube') return j.run?.youtube?.done === true;
              return false;
            });
            
            // Remove job only if it's NOT done for the deselected target
            return isDoneForDeselectedTarget;
          });
          
          // Update remaining jobs for this file with new targets
          nextJobs = nextJobs.map((j) => {
            if (j.filePath === row.filePath) {
              return { ...j, targets: { ...nextTargets } };
            }
            return j;
          });
        } else {
          // No targets were deselected, just update all jobs for this file with new targets
          // This includes the case where all targets are deselected - we still update jobs to reflect the new state
          nextJobs = jobs.map((j) => (j.filePath === row.filePath ? { ...j, targets: { ...nextTargets } } : j));
        }
        // Note: We don't remove jobs that are already "done" for deselected targets
        // This ensures the row stays in the table even after "Assist now" + notification click

        await window.api?.jobsSave?.(nextJobs);
        setScheduledJobs(nextJobs);
      } catch (e) {
        console.error('Failed to update targets:', e);
        setSnack(t('failedToUpdateTargets'));
      }
    },
    [normalizeRowPrefsKey, saveToHistory, t],
  );

  const updateVisibilityForRow = React.useCallback(
    async (row: JobRow, nextVisibility: Visibility) => {
      // Save to history before action (only if visibility actually changed)
      if (row.visibility !== nextVisibility) {
        await saveToHistory();
      }
      
      // Optimistic UI update
      updateRow(row.id, (r) => ({ ...r, visibility: nextVisibility }));

      try {
        const current = await window.api?.jobsLoad?.();
        const jobs = Array.isArray(current) ? current : [];
        const fileJobs = jobs.filter((j) => j.filePath === row.filePath);

        // Persist row preferences even if there is no scheduled job yet.
        const prefKey = normalizeRowPrefsKey(row.filePath);
        setRowPrefs((prev) => {
          const existing = prev[prefKey] ?? {};
          const nextPref: RowPrefs = { ...existing, visibility: nextVisibility };

          // Cleanup: if prefs equal defaults, remove entry to keep file small.
          const defaultTargets = autoEnabledRef.current
            ? { youtube: true, instagram: false, tiktok: false }
            : { youtube: false, instagram: false, tiktok: false };
          const targets = nextPref.targets ?? defaultTargets;
          const targetsIsDefault =
            targets.youtube === defaultTargets.youtube &&
            targets.instagram === defaultTargets.instagram &&
            targets.tiktok === defaultTargets.tiktok;
          const visibilityIsDefault = (nextPref.visibility ?? 'private') === 'private';
          const madeForKidsIsDefault = (nextPref.selfDeclaredMadeForKids ?? false) === false;

          if (targetsIsDefault && visibilityIsDefault && madeForKidsIsDefault) {
            const { [prefKey]: _drop, ...rest } = prev;
            return rest;
          }

          return { ...prev, [prefKey]: nextPref };
        });

        // Don't create new jobs automatically; only update existing ones.
        if (fileJobs.length === 0) {
          return;
        }

        const nextJobs = jobs.map((j) =>
          j.filePath === row.filePath ? { ...j, visibility: nextVisibility } : j,
        );

        await window.api?.jobsSave?.(nextJobs);
        setScheduledJobs(nextJobs);
      } catch (e) {
        console.error('Failed to update visibility:', e);
        setSnack(t('failedToUpdateVisibility'));
      }
    },
    [normalizeRowPrefsKey, saveToHistory, t],
  );

  const bulkUpdateVisibility = React.useCallback(
    async (rows: JobRow[], nextVisibility: Visibility) => {
      if (rows.length < 2) return;
      await saveToHistory();

      // Optimistic UI update (single batch)
      updateRows((prev) => {
        let hasChanges = false;
        const next = new Map(prev);
        for (const row of rows) {
          const existing = prev.get(row.id);
          if (!existing) continue;
          if (existing.visibility === nextVisibility) continue;
          next.set(row.id, { ...existing, visibility: nextVisibility });
          hasChanges = true;
        }
        return hasChanges ? next : prev;
      });

      // Persist row preferences
      const defaultTargets = autoEnabledRef.current
        ? { youtube: true, instagram: false, tiktok: false }
        : { youtube: false, instagram: false, tiktok: false };

      setRowPrefs((prev) => {
        let changed = false;
        const out: Record<string, RowPrefs> = { ...prev };
        for (const row of rows) {
          const prefKey = normalizeRowPrefsKey(row.filePath);
          const existing = out[prefKey] ?? {};
          const nextPref: RowPrefs = { ...existing, visibility: nextVisibility };

          const targets = nextPref.targets ?? defaultTargets;
          const targetsIsDefault =
            targets.youtube === defaultTargets.youtube &&
            targets.instagram === defaultTargets.instagram &&
            targets.tiktok === defaultTargets.tiktok;
          const visibilityIsDefault = (nextPref.visibility ?? 'private') === 'private';
          const madeForKidsIsDefault = (nextPref.selfDeclaredMadeForKids ?? false) === false;

          if (targetsIsDefault && visibilityIsDefault && madeForKidsIsDefault) {
            if (out[prefKey]) {
              delete out[prefKey];
              changed = true;
            }
          } else {
            out[prefKey] = nextPref;
            changed = true;
          }
        }
        return changed ? out : prev;
      });

      // Persist to jobs.json (update existing jobs only)
      try {
        const current = await window.api?.jobsLoad?.();
        const jobs = Array.isArray(current) ? current : [];
        if (jobs.length === 0) return;

        const keySet = new Set(rows.map((r) => normalizeRowPrefsKey(r.filePath)));
        let changed = false;
        const nextJobs = jobs.map((j) => {
          const match = keySet.has(normalizeRowPrefsKey(j.filePath));
          if (!match) return j;
          if ((j.visibility ?? 'private') === nextVisibility) return j;
          changed = true;
          return { ...j, visibility: nextVisibility };
        });

        if (changed) {
          await window.api?.jobsSave?.(nextJobs);
          setScheduledJobs(nextJobs);
        }
      } catch (e) {
        console.error('Failed to bulk update visibility:', e);
        setSnack(t('failedToUpdateVisibility'));
      }
    },
    [normalizeRowPrefsKey, saveToHistory, updateRows, t],
  );

  const updateSelfDeclaredMadeForKidsForRow = React.useCallback(
    async (row: JobRow, nextValue: boolean) => {
      // Save to history before action (only if value actually changed)
      if ((row.selfDeclaredMadeForKids ?? false) !== nextValue) {
        await saveToHistory();
      }

      // Optimistic UI update
      updateRow(row.id, (r) => ({ ...r, selfDeclaredMadeForKids: nextValue }));

      try {
        const current = await window.api?.jobsLoad?.();
        const jobs = Array.isArray(current) ? current : [];
        const fileJobs = jobs.filter((j) => j.filePath === row.filePath);

        // Persist row preferences even if there is no scheduled job yet.
        const prefKey = normalizeRowPrefsKey(row.filePath);
        setRowPrefs((prev) => {
          const existing = prev[prefKey] ?? {};
          const nextPref: RowPrefs = { ...existing, selfDeclaredMadeForKids: nextValue };

          // Cleanup: if prefs equal defaults, remove entry to keep file small.
          const defaultTargets = autoEnabledRef.current
            ? { youtube: true, instagram: false, tiktok: false }
            : { youtube: false, instagram: false, tiktok: false };
          const targets = nextPref.targets ?? defaultTargets;
          const targetsIsDefault =
            targets.youtube === defaultTargets.youtube &&
            targets.instagram === defaultTargets.instagram &&
            targets.tiktok === defaultTargets.tiktok;
          const visibilityIsDefault = (nextPref.visibility ?? 'private') === 'private';
          const madeForKidsIsDefault = (nextPref.selfDeclaredMadeForKids ?? false) === false;

          if (targetsIsDefault && visibilityIsDefault && madeForKidsIsDefault) {
            const { [prefKey]: _drop, ...rest } = prev;
            return rest;
          }

          return { ...prev, [prefKey]: nextPref };
        });

        // Don't create new jobs automatically; only update existing ones.
        if (fileJobs.length === 0) {
          return;
        }

        const nextJobs = jobs.map((j) =>
          j.filePath === row.filePath ? { ...j, selfDeclaredMadeForKids: nextValue } : j,
        );

        await window.api?.jobsSave?.(nextJobs);
        setScheduledJobs(nextJobs);
      } catch (e) {
        console.error('Failed to update made for kids:', e);
        setSnack(t('failedToUpdateMadeForKids'));
      }
    },
    [normalizeRowPrefsKey, saveToHistory, t],
  );

  const bulkUpdateMadeForKids = React.useCallback(
    async (rows: JobRow[], nextValue: boolean) => {
      if (rows.length < 2) return;
      await saveToHistory();

      // Optimistic UI update (single batch)
      updateRows((prev) => {
        let hasChanges = false;
        const next = new Map(prev);
        for (const row of rows) {
          const existing = prev.get(row.id);
          if (!existing) continue;
          const cur = existing.selfDeclaredMadeForKids ?? false;
          if (cur === nextValue) continue;
          next.set(row.id, { ...existing, selfDeclaredMadeForKids: nextValue });
          hasChanges = true;
        }
        return hasChanges ? next : prev;
      });

      // Persist row preferences
      const defaultTargets = autoEnabledRef.current
        ? { youtube: true, instagram: false, tiktok: false }
        : { youtube: false, instagram: false, tiktok: false };

      setRowPrefs((prev) => {
        let changed = false;
        const out: Record<string, RowPrefs> = { ...prev };
        for (const row of rows) {
          const prefKey = normalizeRowPrefsKey(row.filePath);
          const existing = out[prefKey] ?? {};
          const nextPref: RowPrefs = { ...existing, selfDeclaredMadeForKids: nextValue };

          const targets = nextPref.targets ?? defaultTargets;
          const targetsIsDefault =
            targets.youtube === defaultTargets.youtube &&
            targets.instagram === defaultTargets.instagram &&
            targets.tiktok === defaultTargets.tiktok;
          const visibilityIsDefault = (nextPref.visibility ?? 'private') === 'private';
          const madeForKidsIsDefault = (nextPref.selfDeclaredMadeForKids ?? false) === false;

          if (targetsIsDefault && visibilityIsDefault && madeForKidsIsDefault) {
            if (out[prefKey]) {
              delete out[prefKey];
              changed = true;
            }
          } else {
            out[prefKey] = nextPref;
            changed = true;
          }
        }
        return changed ? out : prev;
      });

      // Persist to jobs.json (update existing jobs only)
      try {
        const current = await window.api?.jobsLoad?.();
        const jobs = Array.isArray(current) ? current : [];
        if (jobs.length === 0) return;

        const keySet = new Set(rows.map((r) => normalizeRowPrefsKey(r.filePath)));
        let changed = false;
        const nextJobs = jobs.map((j) => {
          const match = keySet.has(normalizeRowPrefsKey(j.filePath));
          if (!match) return j;
          const cur = j.selfDeclaredMadeForKids ?? false;
          if (cur === nextValue) return j;
          changed = true;
          return { ...j, selfDeclaredMadeForKids: nextValue };
        });

        if (changed) {
          await window.api?.jobsSave?.(nextJobs);
          setScheduledJobs(nextJobs);
        }
      } catch (e) {
        console.error('Failed to bulk update made for kids:', e);
        setSnack(t('failedToUpdateMadeForKids'));
      }
    },
    [normalizeRowPrefsKey, saveToHistory, updateRows, t],
  );

  // Handle schedule dialog actions
  const handleScheduleDialogSubmit = React.useCallback(async () => {
    if (!scheduleDialogRow || !scheduleDialogPlatform) return;
    const requiresNetwork = scheduleDialogMode === 'assist' || scheduleDialogMode === 'now';
    if (requiresNetwork && !requireOnline()) return;
    if (!guardUploadAndScheduleAccess()) return;

    // Save to history before any schedule action
    await saveToHistory();

    if (scheduleDialogMode === 'assist' && scheduleDialogPlatform === 'youtube') {
      // Assist to YouTube now (Manual)
      try {
        // Ensure job exists in jobs.json before triggering assist
        const current = await window.api?.jobsLoad?.();
        const jobs = Array.isArray(current) ? current : [];
        const alreadyDone = getJobsForRow(scheduleDialogRow, jobs).some((j) => Boolean(j.run?.youtube?.done));
        if (alreadyDone) {
          setSnack(t('publishSkippedAlreadyPosted', { platform: platformLabels.youtube, count: 1 }));
          setScheduleDialogOpen(false);
          return;
        }
        const existingJob = jobs.find(j => j.filePath === scheduleDialogRow.filePath);
        
        // Prepare targets with YouTube enabled
        const currentTargets = scheduleDialogRow.targets || { youtube: false, instagram: false, tiktok: false };
        const updatedTargets = {
          ...currentTargets,
          youtube: true, // Enable YouTube target
        };
        
        if (!existingJob) {
          // Create job if it doesn't exist
          const newJob: ScheduledJob = {
            id: newId(),
            filePath: scheduleDialogRow.filePath,
            publishAtUtcMs: Date.now(), // Use current time as placeholder
            targets: updatedTargets,
            visibility: scheduleDialogRow.visibility || 'private',
            selfDeclaredMadeForKids: scheduleDialogRow.selfDeclaredMadeForKids ?? false,
            createdAt: scheduleDialogRow.createdAt || Date.now(),
          };
          jobs.push(newJob);
        } else {
          // Update existing job to enable YouTube target
          existingJob.targets = updatedTargets;
          existingJob.selfDeclaredMadeForKids = scheduleDialogRow.selfDeclaredMadeForKids ?? false;
        }
        
        await window.api?.jobsSave?.(jobs);
        // Ensure state refresh even if the array identity is reused.
        setScheduledJobs([...jobs]);
        // Force a full reload so DetailsPanel Publish plan (platformStatus) updates immediately.
        void loadJobs();
        
        // Update row targets to reflect the enabled platform
        await updateTargetsForRow(scheduleDialogRow, updatedTargets);
        
        const res: any = await (window.api?.autouploadTriggerAssist as any)?.({
          filePath: scheduleDialogRow.filePath,
          platform: 'youtube',
        });
        
        if (res?.ok) {
          // Mark as posted immediately (same as Instagram/TikTok "Open Now")
          await upsertJobRunForPlatform({
            row: scheduleDialogRow,
            platform: 'youtube',
            ok: true,
            publishAtUtcMs: Date.now(),
          });

          // Update row targets only (status comes from jobs.json)
          updateRow(scheduleDialogRow.id, (r) => {
            const upload = { ...(r.upload || {}) };
            delete upload.youtube;
            return { ...r, targets: updatedTargets, upload };
          });

          setSnack(t('assistTriggeredMarkedPosted', { platform: platformLabels.youtube }));
          // Reload jobs to update status
          void loadJobs();
        } else {
          if (res?.error) {
            handleNetworkError(res.error);
          }
          setSnack(res?.error || t('failedToTriggerAssist'));
        }
        
        setScheduleDialogOpen(false);
        setScheduleDialogRow(null);
        setScheduleDialogPlatform(null);
      } catch (e) {
        handleNetworkError(e);
        console.error('Assist now error:', e);
        setSnack(t('failedToTriggerAssist'));
        setScheduleDialogOpen(false);
      }
      return;
    }

    if (scheduleDialogMode === 'now') {
      // Publish Now
      if (scheduleDialogPlatform === 'youtube') {
        // Upload to YouTube immediately
        const publishAtMs = scheduleDialogDateTime
          ? parseDateTimeLocalValue(scheduleDialogDateTime, getIanaTimeZone(timeZoneId))
          : null;

        if (!publishAtMs) {
          setSnack(t('invalidDateTime'));
          setScheduleDialogOpen(false);
          return;
        }

        try {
          const current = await window.api?.jobsLoad?.();
          const jobs = Array.isArray(current) ? current : [];
          const alreadyDone = getJobsForRow(scheduleDialogRow, jobs).some((j) => Boolean(j.run?.youtube?.done));
          if (alreadyDone) {
            setSnack(t('publishSkippedAlreadyPosted', { platform: platformLabels.youtube, count: 1 }));
            setScheduleDialogOpen(false);
            return;
          }
          // Check if YouTube is connected
          const connected = await window.api?.youtubeIsConnected?.();
          if (!connected?.connected) {
            setSnack(t('youtubeNotConnectedPrompt'));
            setScheduleDialogOpen(false);
            return;
          }

          let uploadReservationId: string | null = null;
          const uploadReservedNote = t('uploadCreditsReserved', { count: 1 });
          try {
            const requestId = createRequestId();
            const reservation = await reserveUpload(requestId, 1);
            uploadReservationId = reservation.reservation_id;
          } catch (err) {
            handleBillingError(err, 'upload');
            setScheduleDialogOpen(false);
            return;
          }

          // Get YouTube metadata from row; fallback to exports/metadata from disk for fresh hashtags
          const ym = scheduleDialogRow.meta?.byPlatform?.youtube;
          let title = String(ym?.title || scheduleDialogRow.filename || '').trim();
          let desc = String(ym?.description || '').trim();
          let tagsRaw = ym?.hashtags || '';
          if (!tagsRaw?.trim()) {
            const outputs = await window.api?.readOutputsForPath?.(scheduleDialogRow.filePath);
            const exp = outputs?.exports?.youtube || {};
            const meta = outputs?.meta?.platforms?.youtube || {};
            if (!title?.trim()) title = (exp?.title || meta?.title || scheduleDialogRow.filename || '').trim();
            if (!desc?.trim()) desc = (exp?.description || meta?.description || '').trim();
            tagsRaw = (exp?.hashtags || meta?.hashtags || '').trim();
          }
          // Parse tags (hashtags can be space-separated or comma-separated); strip # for API
          const tags = (tagsRaw || '')
            .split(/[,\n]/)
            .map((x: string) => x.trim())
            .filter(Boolean)
            .map((x: string) => (x.startsWith('#') ? x.slice(1) : x))
            .join(' ');
          // Append hashtags to description so they appear in video description on YouTube
          const hashtagsForDesc = tags ? tags.split(/\s+/).filter(Boolean).map((t) => (t.startsWith('#') ? t.replace(/^#+/, '#') : `#${t}`)).join(' ') : '';
          const description = hashtagsForDesc ? (desc ? `${desc}\n\n${hashtagsForDesc}` : hashtagsForDesc) : desc;

          const payload = {
            filePath: scheduleDialogRow.filePath,
            title,
            description,
            tags,
            publishAt: publishAtMs,
            privacyStatus: scheduleDialogRow.visibility || 'private',
            selfDeclaredMadeForKids: scheduleDialogRow.selfDeclaredMadeForKids ?? false,
          };

          // Set status to Processing before upload starts
          updateRow(scheduleDialogRow.id, (r) => ({
            ...r,
            upload: {
              ...r.upload,
              youtube: {
                status: 'Processing' as const,
                message: t('uploadingToPlatform', { platform: platformLabels.youtube }),
                updatedAt: Date.now(),
              },
            },
          }));

          setSnack(`${t('uploadingFileToPlatform', { file: scheduleDialogRow.filename, platform: platformLabels.youtube })} ${uploadReservedNote}`);
          const res: any = await window.api?.youtubeUpload?.(payload);
          
          if (res?.ok && res?.videoId) {
            if (uploadReservationId) {
              try {
                const snapshot = await finalizeQuota(uploadReservationId);
                setUsageSnapshot(snapshot);
              } catch (err) {
                console.error('Failed to finalize upload quota:', err);
              }
            }
            setSnack(t('uploadedToPlatformWithId', { platform: platformLabels.youtube, id: res.videoId }));
            await upsertJobRunForPlatform({
              row: scheduleDialogRow,
              platform: 'youtube',
              ok: true,
              videoId: res.videoId,
              publishAtUtcMs: payload.publishAt ?? null,
            });
          } else {
            if (res?.error) {
              handleNetworkError(res.error);
            }
            if (uploadReservationId) {
              try {
                await releaseQuota(uploadReservationId);
              } catch (err) {
                console.error('Failed to release upload quota:', err);
              }
            }
            const isDailyLimit = isYoutubeDailyLimitError(res);
            if (isDailyLimit) {
              setYoutubeDailyLimitModalOpen(true);
            }
            const failureMsg = isDailyLimit ? t('youtubeDailyLimitBlockedStatus') : (res?.error || t('failedToUploadToPlatform', { platform: platformLabels.youtube }));
            setSnack(`${failureMsg} ${t('uploadCreditsReleased', { count: 1 })}`);
            await upsertJobRunForPlatform({
              row: scheduleDialogRow,
              platform: 'youtube',
              ok: false,
              error: isDailyLimit ? t('youtubeDailyLimitBlockedStatus') : (res?.error || t('uploadFailed')),
              publishAtUtcMs: payload.publishAt ?? null,
            });
          }
          // Clear transient upload state after completion
          updateRow(scheduleDialogRow.id, (r) => {
            const upload = { ...(r.upload || {}) };
            if (upload.youtube) {
              delete upload.youtube;
            }
            return { ...r, upload };
          });
          setScheduleDialogOpen(false);
        } catch (e) {
          handleNetworkError(e);
          console.error('YouTube upload error:', e);
          if (uploadReservationId) {
            try {
              await releaseQuota(uploadReservationId);
            } catch (err) {
              console.error('Failed to release upload quota:', err);
            }
          }
          const errMsg = String(e?.message ?? e);
          const isDailyLimit = /daily upload limit|upload limit|verify your account|phone verification|youtube verification|exceeded the number of videos|verification required|channel verification/i.test(errMsg);
          if (isDailyLimit) {
            setYoutubeDailyLimitModalOpen(true);
          }
          setSnack(`${t('failedToUploadToPlatformWithError', { platform: platformLabels.youtube, error: errMsg })} ${t('uploadCreditsReleased', { count: 1 })}`);
          await upsertJobRunForPlatform({
            row: scheduleDialogRow,
            platform: 'youtube',
            ok: false,
            error: isDailyLimit ? t('youtubeDailyLimitBlockedStatus') : errMsg,
            publishAtUtcMs: publishAtMs ?? null,
          });
          updateRow(scheduleDialogRow.id, (r) => {
            const upload = { ...(r.upload || {}) };
            if (upload.youtube) {
              delete upload.youtube;
            }
            return { ...r, upload };
          });
          setScheduleDialogOpen(false);
        }
      } else {
        // Instagram/TikTok - open manually (mark posted immediately)
        try {
          // Ensure job exists in jobs.json
          const current = await window.api?.jobsLoad?.();
          const jobs = Array.isArray(current) ? current : [];
          const alreadyDone = getJobsForRow(scheduleDialogRow, jobs).some((j) => Boolean(j.run?.[scheduleDialogPlatform]?.done));
          if (alreadyDone) {
            setSnack(t('publishSkippedAlreadyPosted', { platform: platformLabels[scheduleDialogPlatform], count: 1 }));
            setScheduleDialogOpen(false);
            return;
          }
          const existingJob = jobs.find(j => j.filePath === scheduleDialogRow.filePath);
          
          // Prepare targets with the platform enabled
          const currentTargets = scheduleDialogRow.targets || { youtube: false, instagram: false, tiktok: false };
          const updatedTargets = {
            ...currentTargets,
            [scheduleDialogPlatform]: true, // Enable target for the platform
          };
          
          if (!existingJob) {
            // Create job if it doesn't exist
            const newJob: ScheduledJob = {
              id: newId(),
              filePath: scheduleDialogRow.filePath,
              publishAtUtcMs: Date.now(),
              targets: updatedTargets,
              visibility: scheduleDialogRow.visibility || 'private',
              selfDeclaredMadeForKids: scheduleDialogRow.selfDeclaredMadeForKids ?? false,
              createdAt: scheduleDialogRow.createdAt || Date.now(),
            };
            jobs.push(newJob);
          } else {
            // Update existing job to enable target
            existingJob.targets = updatedTargets;
            existingJob.selfDeclaredMadeForKids = scheduleDialogRow.selfDeclaredMadeForKids ?? false;
          }
          
          await window.api?.jobsSave?.(jobs);
          setScheduledJobs(jobs);
          
          // Update row targets
          await updateTargetsForRow(scheduleDialogRow, updatedTargets);
          
          // Use autouploadTriggerAssist to open browser, File Explorer, and copy metadata (same as "Assist Now")
          const res: any = await (window.api?.autouploadTriggerAssist as any)?.({
            filePath: scheduleDialogRow.filePath,
            platform: scheduleDialogPlatform,
          });
          
          if (!res?.ok) {
            throw new Error(res?.error || t('failedToTriggerAssist'));
          }

          // Mark as posted immediately (same as before)
          await upsertJobRunForPlatform({
            row: scheduleDialogRow,
            platform: scheduleDialogPlatform,
            ok: true,
            publishAtUtcMs: Date.now(),
          });
          
          setSnack(t('openedPlatformMetadataCopied', { platform: platformLabels[scheduleDialogPlatform] }));

          // Update row targets only (status comes from jobs.json)
          updateRow(scheduleDialogRow.id, (r) => {
            const upload = { ...(r.upload || {}) };
            delete upload[scheduleDialogPlatform];
            return { ...r, targets: updatedTargets, upload };
          });
        } catch (e) {
          handleNetworkError(e);
          setSnack(t('failedToOpenPlatform', { platform: platformLabels[scheduleDialogPlatform] }));
        }
      }
    } else {
      // Schedule for later
      if (!scheduleDialogDateTime) {
        setSnack(t('selectDateTime'));
        return;
      }
      const ms = parseDateTimeLocalValue(scheduleDialogDateTime, getIanaTimeZone(timeZoneId));
      if (!ms) {
        setSnack(t('invalidDateTime'));
        return;
      }
      
      // Create or update job
      try {
        const current = await window.api?.jobsLoad?.();
        const jobs = Array.isArray(current) ? current : [];
        
        // Per-platform schedule: one job per filePath + platform.
        const existingJobIndex = jobs.findIndex(
          (j: any) => j.filePath === scheduleDialogRow.filePath && (j.targets?.[scheduleDialogPlatform] ?? false),
        );

        const targetsForThisJob = {
          youtube: false,
          instagram: false,
          tiktok: false,
          [scheduleDialogPlatform]: true,
        } as { youtube: boolean; instagram: boolean; tiktok: boolean };

        if (existingJobIndex >= 0) {
          jobs[existingJobIndex] = {
            ...jobs[existingJobIndex],
            targets: targetsForThisJob,
            publishAtUtcMs: ms,
            visibility: scheduleDialogRow.visibility || 'private',
            selfDeclaredMadeForKids: scheduleDialogRow.selfDeclaredMadeForKids ?? false,
          };
        } else {
          const job: ScheduledJob = {
            id: newId(),
            filePath: scheduleDialogRow.filePath,
            publishAtUtcMs: ms,
            targets: targetsForThisJob,
            visibility: scheduleDialogRow.visibility || 'private',
            selfDeclaredMadeForKids: scheduleDialogRow.selfDeclaredMadeForKids ?? false,
            createdAt: Date.now(),
          };
          jobs.push(job);
        }
        
        await window.api?.jobsSave?.(jobs);
        setScheduledJobs(jobs);
        
        // Update row: enable platform target, set publishAt to earliest scheduled for this file,
        // and mark row as manual so it won't be immediately re-overwritten by auto schedule.
        const mergedTargets = {
          ...(scheduleDialogRow.targets || { youtube: false, instagram: false, tiktok: false }),
          [scheduleDialogPlatform]: true,
        } as { youtube: boolean; instagram: boolean; tiktok: boolean };

        const jobsForFile = jobs.filter((j: any) => j.filePath === scheduleDialogRow.filePath);
        const earliest = jobsForFile.length
          ? Math.min(...jobsForFile.map((j: any) => Number(j.publishAtUtcMs || Infinity)))
          : ms;

        updateRow(scheduleDialogRow.id, (r) => ({
          ...r,
          targets: mergedTargets,
          publishAt: Number.isFinite(earliest) ? earliest : ms,
          publishMode: 'schedule' as const,
          publishSource: 'manual' as const, // Manual scheduling
        }));
        
        setSnack(
          t('scheduledForPlatformAt', {
            platform: platformLabels[scheduleDialogPlatform],
            time: formatForGrid(ms, 'schedule', getIanaTimeZone(timeZoneId)),
          }),
        );
      } catch (e) {
        console.error('Failed to save job:', e);
        setSnack(t('failedToScheduleJob'));
      }
    }
    
    setScheduleDialogOpen(false);
    setScheduleDialogRow(null);
    setScheduleDialogPlatform(null);
  }, [
    scheduleDialogRow,
    scheduleDialogPlatform,
    scheduleDialogMode,
    scheduleDialogDateTime,
    timeZoneId,
    copyToClipboard,
    saveToHistory,
    updateTargetsForRow,
    formatForGrid,
    getIanaTimeZone,
    upsertJobRunForPlatform,
    platformLabels,
    guardUploadAndScheduleAccess,
    handleBillingError,
    handleNetworkError,
    requireOnline,
    t,
  ]);


  // Fingerprint only the scheduling-related fields so we can react to changes
  // (manual edits, imported data, etc.) without being triggered by log/status updates.
  // Exclude rows without publishAt to prevent auto-scheduling when new videos are added
  const scheduleSig = React.useMemo(
    () =>
      rows
        .filter((r) => r.publishMode === 'schedule' && typeof r.publishAt === 'number')
        .map((r) => `${r.id}:${r.publishSource}:${r.publishMode}:${r.publishAt}`)
        .join('|'),
    [rows],
  );

  // Track ongoing refreshes to prevent duplicate calls
  const refreshingPathsRef = React.useRef<Set<string>>(new Set());
  // Track last refresh time per filePath to prevent too frequent refreshes
  const lastRefreshTimeRef = React.useRef<Map<string, number>>(new Map());
  
  const refreshOutputsForPath = React.useCallback(
    async (filePath: string, force: boolean = false, ignoreScrollCheck: boolean = false) => {
      if (!filePath) return;
      if (!window.api?.readOutputsForPath) return;
      
      // Prevent duplicate refresh calls for the same filePath
      if (refreshingPathsRef.current.has(filePath) && !force) {
        // Silently skip - no logging to reduce console spam
        return;
      }
      
      // Prevent too frequent refreshes (unless forced) - minimum 5 seconds between refreshes
      if (!force) {
        const lastRefresh = lastRefreshTimeRef.current.get(filePath);
        const now = Date.now();
        if (lastRefresh && (now - lastRefresh) < 5000) {
          // Silently skip - no logging to reduce console spam
          return;
        }
      }
      
      // REGULĂ STRICTĂ: Nu facem refresh dacă utilizatorul face scroll sau a făcut scroll recent
      // Excepție: dacă ignoreScrollCheck=true (pentru butonul manual de refresh), ocolim verificarea
      if (!ignoreScrollCheck) {
        const timeSinceLastScroll = Date.now() - lastScrollTimeRef.current;
        if (timeSinceLastScroll < 3000) {
          // Utilizatorul face scroll, nu facem refresh pentru a preveni scroll jump
          return;
        }
      }
      
      // Mark as refreshing and update last refresh time
      refreshingPathsRef.current.add(filePath);
      lastRefreshTimeRef.current.set(filePath, Date.now());

      const pickString = (...vals: any[]) => {
        for (const v of vals) {
          if (typeof v === 'string') {
            const t = v.trim();
            if (t) return t;
          }
        }
        return '';
      };

      setMetaLoadingFor(filePath);
      try {
        const res = await window.api.readOutputsForPath(filePath);
        if (!res?.ok) {
          console.log(`[refreshOutputsForPath] readOutputsForPath failed for ${filePath}`);
          return;
        }

        const metaPlatforms = (res?.metadata?.platforms ?? {}) as any;
        const exports = (res as any)?.exports ?? {};

        // Reduced logging - only log when metadata is actually missing (not for force refreshes)
        if (!res?.metadata) {
          console.log(`[refreshOutputsForPath] Loading metadata for ${filePath}:`, {
            hasMetadata: !!res?.metadata,
            platformsKeys: metaPlatforms ? Object.keys(metaPlatforms) : [],
            platforms: metaPlatforms,
          });
        }

        const build = (p: MetaPlatform) => {
          // Check if platform is marked as deleted in persistent tombstone
          // outputs:readForPath should already exclude deleted platforms, but double-check here
          const exp = exports?.[p];
          const mp = metaPlatforms?.[p];
          
          // If exports or metadata.platforms don't exist for this platform, it might be deleted
          // outputs:readForPath should return empty objects for deleted platforms
          // But we need to check if they're truly empty (all fields empty)
          const hasExpData = exp && (
            Boolean(exp.title?.trim()) ||
            Boolean(exp.description?.trim()) ||
            Boolean(exp.hashtags?.trim())
          );
          const hasMetaData = mp && (
            Boolean(mp.title?.trim()) ||
            Boolean(mp.description?.trim()) ||
            Boolean(normalizeHashtagsValue(mp.hashtags)?.trim())
          );
          
          // If neither exports nor metadata has data, treat as deleted/empty
          if (!hasExpData && !hasMetaData) {
            // Return empty metadata (platform is deleted or truly has no data)
            return { title: '', description: '', hashtags: '', source: 'none' as const, dir: exp?.dir };
          }
          
          const title = pickString(exp?.title, mp?.title);
          const description = pickString(exp?.description, mp?.description);
          const hashtags = pickString(
            normalizeHashtagsValue(exp?.hashtags),
            normalizeHashtagsValue(mp?.hashtags),
          );
          const hasExports = !!pickString(exp?.title, exp?.description, exp?.hashtags);
          const hasMeta = !!pickString(mp?.title, mp?.description, normalizeHashtagsValue(mp?.hashtags));
          const source: MetaSource = hasExports ? 'exports' : hasMeta ? 'metadata' : 'none';
          
          // Only log platform details when metadata is missing (not for force refreshes of existing metadata)
          if (!title || !description) {
            console.log(`[refreshOutputsForPath] Platform ${p}: title="${title}", desc="${description}", tags="${hashtags}", source=${source}`);
          }
          
          return { title, description, hashtags, source, dir: exp?.dir } as const;
        };

        // Note: outputs:readForPath now handles persistent tombstone and excludes deleted platforms
        // But we still need to check if returned data is truly empty (all fields empty strings)
        // Only include platforms that have actual data (not all empty strings)
        const byPlatform: Partial<Record<MetaPlatform, any>> = {};
        
        const ytData = build('youtube');
        if (ytData.title?.trim() || ytData.description?.trim() || ytData.hashtags?.trim()) {
          byPlatform.youtube = ytData;
        }
        
        const igData = build('instagram');
        if (igData.title?.trim() || igData.description?.trim() || igData.hashtags?.trim()) {
          byPlatform.instagram = igData;
        }
        
        const ttData = build('tiktok');
        if (ttData.title?.trim() || ttData.description?.trim() || ttData.hashtags?.trim()) {
          byPlatform.tiktok = ttData;
        }
        
        // When force=true, log what we read from disk to debug stale data issues
        if (force) {
          console.log(`[refreshOutputsForPath] Force refresh - read from disk for ${filePath}:`, {
            hasMetadata: !!res?.metadata,
            platformsInMetadata: res?.metadata?.platforms ? Object.keys(res?.metadata.platforms) : [],
            exportsPlatforms: Object.keys(exports || {}),
            youtubeTitle: byPlatform.youtube?.title?.substring(0, 50) || '(empty)',
            instagramTitle: byPlatform.instagram?.title?.substring(0, 50) || '(empty)',
            tiktokTitle: byPlatform.tiktok?.title?.substring(0, 50) || '(empty)',
          });
        }

        // REGULĂ STRICTĂ: Nu actualizăm rows dacă utilizatorul face scroll
        // Această verificare se aplică CHIAR ȘI pentru force=true pentru a preveni scroll jump
        // Scroll check removed - metadata refresh no longer blocked by scroll
        // (Scroll blocking removed to allow metadata updates during scrolling)
        
        // Check if metadata actually changed BEFORE calling setRows
        // This prevents DataGrid from resetting pagination when nothing changed
        // BUT: if force=true, always update (used after regeneration to ensure UI reflects latest state)
        const currentRow = rowsRef.current.find((r) => r.filePath === filePath);
        let metaChanged = false; // Track if metadata changed for logging
        
        // If force=true, skip ALL checks and always update
        if (force) {
          // Reduced logging for force refreshes - only log if it's a new file or missing metadata
          const currentRow = rowsRef.current.find((r) => r.filePath === filePath);
          if (!currentRow || !currentRow.meta) {
            console.log(`[refreshOutputsForPath] Force refresh for ${filePath} (new/missing metadata)`);
          }
          metaChanged = true; // Consider it changed when forcing
          // Continue to update below
        } else if (currentRow && currentRow.meta) {
          // Only check for changes if NOT forcing and row exists with metadata
          const newMeta = {
            byPlatform,
            raw: res?.metadata ?? null,
          };
          
          const oldMeta = currentRow.meta;
          
          // Deep comparison of metadata - check each platform individually
          metaChanged = !oldMeta;
          if (!metaChanged && oldMeta) {
            // Compare byPlatform
            const oldByPlatform = oldMeta.byPlatform || {};
            const newByPlatform = newMeta.byPlatform || {};
            
            // Check if any platform has different content
            for (const platform of ['youtube', 'instagram', 'tiktok'] as const) {
              const oldPlatformMeta = oldByPlatform[platform];
              const newPlatformMeta = newByPlatform[platform];
              
              if (!oldPlatformMeta && newPlatformMeta) {
                metaChanged = true;
                break;
              }
              if (oldPlatformMeta && !newPlatformMeta) {
                metaChanged = true;
                break;
              }
              if (oldPlatformMeta && newPlatformMeta) {
                const oldTitle = (oldPlatformMeta.title || '').trim();
                const newTitle = (newPlatformMeta.title || '').trim();
                const oldDesc = (oldPlatformMeta.description || '').trim();
                const newDesc = (newPlatformMeta.description || '').trim();
                const oldTags = (oldPlatformMeta.hashtags || '').trim();
                const newTags = (newPlatformMeta.hashtags || '').trim();
                
                if (oldTitle !== newTitle || oldDesc !== newDesc || oldTags !== newTags) {
                  metaChanged = true;
                  break;
                }
              }
            }
            
            // Also check raw metadata
            if (!metaChanged) {
              const oldRawStr = JSON.stringify(oldMeta.raw || {});
              const newRawStr = JSON.stringify(newMeta.raw || {});
              if (oldRawStr !== newRawStr) {
                metaChanged = true;
              }
            }
          }
          
          // Only log when metadata actually changed (not for force refreshes)
          if (metaChanged && !force) {
            console.log(`[refreshOutputsForPath] Metadata changed: ${metaChanged}`);
          }
          // If metadata didn't change, DON'T call setRows at all to prevent pagination reset
          // Silently return - no logging to reduce console spam
          if (!metaChanged && !force) {
            return;
          }
        } else if (!currentRow) {
          // No current row - metadata will be new, so consider it changed
          metaChanged = true;
          // Only log when force=true
          if (force) {
            console.log(`[refreshOutputsForPath] No current row found - will create new row`);
          }
        } else if (!currentRow.meta) {
          // Current row has no metadata - metadata will be new, so consider it changed
          metaChanged = true;
          // Only log when force=true
          if (force) {
            console.log(`[refreshOutputsForPath] Current row has no metadata - will update with new metadata`);
          }
        }
        
        // Save pagination before updating rows
        // BUT: Don't save if user is on page 1 by choice (we want to allow staying on page 1)
        // Also: Don't overwrite saved pagination if user is on a different page (page > 0)
        // This prevents overwriting saved pagination when metadata updates happen
        // Pagination save removed - now handled in onPaginationModelChange
        
        // When force=true, always update rowsRef first to ensure we use the latest disk state
        // This prevents stale state issues when regenerating metadata
        if (force) {
          // Update rowsRef immediately before updateRow to ensure consistency
          const currentRows = rowsRef.current;
          const updatedRowsRef = currentRows.map((r) => {
            if (r.filePath !== filePath) return r;
            return {
              ...r,
              meta: {
                byPlatform,
                raw: res?.metadata ?? null,
              },
            };
          });
          rowsRef.current = updatedRowsRef;
        }
        
        // Find the row by filePath and update only that row (maintains referential stability)
        const rowToUpdate = Array.from(rowsById.values()).find((r) => r.filePath === filePath);
        if (rowToUpdate) {
          // Note: outputs:readForPath now handles persistent tombstone and excludes deleted platforms
          // So byPlatform already excludes deleted platforms, no need for additional filtering
          const newMeta = {
            byPlatform,
            raw: res?.metadata ?? null,
          };
          
          // Log when metadata is updated (especially for force refreshes to debug indicator disappearing)
          if (force || metaChanged) {
            console.log(`[refreshOutputsForPath] Updating row for ${filePath}:`, {
              platforms: Object.keys(byPlatform),
              force,
              metaChanged,
              hasYtMeta: Boolean(byPlatform.youtube),
              hasIgMeta: Boolean(byPlatform.instagram),
              hasTtMeta: Boolean(byPlatform.tiktok),
            });
          }
          
          // Update only this specific row - maintains referential stability for all other rows
          updateRow(rowToUpdate.id, (r) => ({
            ...r,
            meta: newMeta,
          }));
          
          // Update rowsRef for consistency
          const updatedRow = { ...rowToUpdate, meta: newMeta };
          rowsRef.current = rowsRef.current.map((r) => (r.id === rowToUpdate.id ? updatedRow : r));
          
          // Only log when metadata actually changed (not for force refreshes)
          if (metaChanged && !force) {
            console.log(`[refreshOutputsForPath] Updated rowsRef.current for ${filePath}`);
          }
        }
        // Note: Scroll position is preserved by the useEffect that watches rows changes
      } catch (_e) {
        // ignore; errors are still visible via pipeline logs / last_run.log
      } finally {
        setMetaLoadingFor((cur) => (cur === filePath ? null : cur));
        // Remove from refreshing set
        refreshingPathsRef.current.delete(filePath);
      }
    },
    [updateRow, rowsById],
  );

  // When a row becomes Done (or user selects another Done row), pull metadata from outputs.
  React.useEffect(() => {
    if (!selectedRow) return;
    if (selectedRow.status !== 'Done') return;
    
    // REGULĂ STRICTĂ: Nu facem refresh dacă utilizatorul face scroll
    const timeSinceLastScroll = Date.now() - lastScrollTimeRef.current;
    if (timeSinceLastScroll < 3000) {
      // Utilizatorul a făcut scroll recent, nu facem refresh
      return;
    }
    
    // Only refresh if not already refreshing to prevent duplicate calls
    if (refreshingPathsRef.current.has(selectedRow.filePath)) {
      // Silently skip - no logging to reduce console spam
      return;
    }
    // Always try to refresh metadata for Done rows, even if meta exists (in case it was updated)
    // Use refreshOutputsForPathRef to avoid dependency on refreshOutputsForPath function reference
    void refreshOutputsForPathRef.current(selectedRow.filePath);
  }, [selectedRow?.filePath, selectedRow?.status]); // Removed refreshOutputsForPath from dependencies
  
  // Also refresh all Done rows periodically to catch metadata updates
  // Completely pause refresh when user is scrolling to prevent scroll jump
  const metadataRefreshIntervalRef = React.useRef<number | null>(null);
  const rowsRef = React.useRef(rows);
  const refreshOutputsForPathRef = React.useRef(refreshOutputsForPath);
  const lastRefreshTimeRefForInterval = React.useRef<Map<string, number>>(new Map());
  
  // Keep refs in sync
  React.useEffect(() => {
    rowsRef.current = rows;
    refreshOutputsForPathRef.current = refreshOutputsForPath;
  }, [rows, refreshOutputsForPath]);

  // Check metadata for all rows on startup/restart
  const hasCheckedMetadataOnStartupRef = React.useRef(false);
  React.useEffect(() => {
    if (!window.api?.readOutputsForPath) return;
    if (rows.length === 0) return;
    if (hasCheckedMetadataOnStartupRef.current) return; // Only check once on startup
    
    // Wait a bit for IPC handlers and rows to be ready
    const timer = setTimeout(async () => {
      // Check metadata for all rows (Ready, Done, etc.) to detect existing metadata
      const updates: Array<{ rowId: string; metadata: any; status: 'Done' }> = [];
      
      await Promise.all(
        rows.map(async (row: JobRow) => {
          if (row.filePath && (row.status === 'Ready' || !row.status || row.status === 'Error')) {
            try {
              if (!window.api?.readOutputsForPath) return;
              const res: any = await window.api?.readOutputsForPath(row.filePath);
              if (res?.ok) {
                const hasMetadata = Boolean(
                  res.exports?.youtube?.title ||
                  res.exports?.instagram?.title ||
                  res.exports?.tiktok?.title ||
                  res.metadata?.platforms?.youtube?.title ||
                  res.metadata?.platforms?.instagram?.title ||
                  res.metadata?.platforms?.tiktok?.title
                );
                
                // If metadata exists but row status is not 'Done', prepare update
                if (hasMetadata) {
                  const metaPlatforms = (res?.metadata?.platforms ?? {}) as any;
                  const exports = (res as any)?.exports ?? {};
                  
                  const pickString = (...vals: any[]) => {
                    for (const v of vals) {
                      if (typeof v === 'string') {
                        const t = v.trim();
                        if (t) return t;
                      }
                    }
                    return '';
                  };
                  
                  const build = (p: MetaPlatform) => {
                    const exp = exports?.[p];
                    const mp = metaPlatforms?.[p];
                    
                    const title = pickString(exp?.title, mp?.title);
                    const description = pickString(exp?.description, mp?.description);
                    const hashtags = pickString(
                      normalizeHashtagsValue(exp?.hashtags),
                      normalizeHashtagsValue(mp?.hashtags),
                    );
                    const hasExports = !!pickString(exp?.title, exp?.description, exp?.hashtags);
                    const hasMeta = !!pickString(mp?.title, mp?.description, normalizeHashtagsValue(mp?.hashtags));
                    const source: MetaSource = hasExports ? 'exports' : hasMeta ? 'metadata' : 'none';
                    
                    return { title, description, hashtags, source, dir: exp?.dir } as const;
                  };
                  
                  const byPlatform: Partial<Record<MetaPlatform, any>> = {
                    youtube: build('youtube'),
                    instagram: build('instagram'),
                    tiktok: build('tiktok'),
                  };
                  
                  updates.push({
                    rowId: row.id,
                    metadata: {
                      byPlatform,
                      raw: res?.metadata ?? null,
                    },
                    status: 'Done',
                  });
                }
              }
            } catch {
              // Ignore errors
            }
          }
        })
      );
      
      // Apply all updates at once - use updateRows to maintain referential stability
      if (updates.length > 0) {
        updateRows((prev) => {
          let hasChanges = false;
          const next = new Map(prev);
          const updatesMap = new Map(updates.map(u => [u.rowId, u]));
          
          for (const row of prev.values()) {
            const update = updatesMap.get(row.id);
            if (update) {
              next.set(row.id, {
                ...row,
                meta: update.metadata,
                status: update.status,
              });
              hasChanges = true;
            }
          }
          
          return hasChanges ? next : prev;
        });
      }
      
      hasCheckedMetadataOnStartupRef.current = true; // Mark as checked
    }, 1000); // Wait 1 second for everything to be ready
    
    return () => clearTimeout(timer);
  }, [rows.length]); // Run when rows are loaded
  
  const startMetadataRefresh = React.useCallback(() => {
    // Clear existing interval
    if (metadataRefreshIntervalRef.current) {
      clearInterval(metadataRefreshIntervalRef.current);
      metadataRefreshIntervalRef.current = null;
    }
    
    // Don't start if user recently scrolled
    const timeSinceLastScroll = Date.now() - lastScrollTimeRef.current;
    if (timeSinceLastScroll < 3000) {
      return;
    }
    
    // Start new interval
    metadataRefreshIntervalRef.current = window.setInterval(() => {
      // Double-check user is not scrolling
      const timeSinceLastScroll = Date.now() - lastScrollTimeRef.current;
      if (timeSinceLastScroll < 3000) {
        return;
      }
      
      // Refresh metadata using refs to avoid dependency issues
      // Only refresh rows that are not already being refreshed and haven't been refreshed recently
      const now = Date.now();
      rowsRef.current.forEach((row) => {
        if (row.status === 'Done' && row.filePath) {
          // Check if already refreshing to prevent duplicate calls
          if (refreshingPathsRef.current.has(row.filePath)) {
            return; // Skip if already refreshing
          }
          // Check if refreshed recently (within last 10 seconds) using the interval's own tracking
          const lastRefresh = lastRefreshTimeRefForInterval.current.get(row.filePath);
          if (lastRefresh && (now - lastRefresh) < 10000) {
            return; // Skip if refreshed recently
          }
          // Update last refresh time before calling
          lastRefreshTimeRefForInterval.current.set(row.filePath, now);
          refreshOutputsForPathRef.current(row.filePath);
        }
      });
    }, 15000); // Check every 15 seconds (increased to reduce load)
  }, []); // No dependencies - uses refs
  
  React.useEffect(() => {
    startMetadataRefresh();
    
    return () => {
      if (metadataRefreshIntervalRef.current) {
        clearInterval(metadataRefreshIntervalRef.current);
        metadataRefreshIntervalRef.current = null;
      }
    };
  }, [startMetadataRefresh]);


  // Schedule controls
  const [autoEnabled, setAutoEnabled] = React.useState<boolean>(() => {
    try {
      const v = localStorage.getItem('autoEnabled');
      return v === '1';
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem('autoEnabled', autoEnabled ? '1' : '0');
    } catch {
      // ignore
    }
  }, [autoEnabled]);
  const [autoPlanApplyTo, setAutoPlanApplyTo] = React.useState<'all' | MetaPlatform>(() => {
    try {
      const v = localStorage.getItem('autoPlanApplyTo');
      if (v === 'youtube' || v === 'instagram' || v === 'tiktok') return v;
      return 'all';
    } catch {
      return 'all';
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem('autoPlanApplyTo', autoPlanApplyTo);
    } catch {
      // ignore
    }
  }, [autoPlanApplyTo]);

  // Keep the ref in sync (used by callbacks declared earlier).
  React.useEffect(() => {
    autoEnabledRef.current = autoEnabled;
  }, [autoEnabled]);

const [autoUploadEnabled, setAutoUploadEnabled] = React.useState<boolean>(() => {
  try {
    return localStorage.getItem('autoUploadEnabled') === '1';
  } catch {
    return false;
  }
});

const [silentMode, setSilentMode] = React.useState<boolean>(() => {
  try {
    return localStorage.getItem('silentMode') === '1';
  } catch {
    return false;
  }
});
  const [videosPerDay, setVideosPerDay] = React.useState<number>(3);
  const [timesCsv, setTimesCsv] = React.useState<string>('09:00 13:00 18:00');
  // Start date for scheduling (defaults to today)
  const [scheduleStartDate, setScheduleStartDate] = React.useState<string>(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  // Combined Schedule editor (Videos/day + Times) under one button/popover.
  const [scheduleAnchorEl, setScheduleAnchorEl] = React.useState<HTMLElement | null>(null);
  const scheduleOpen = Boolean(scheduleAnchorEl);
  const closeSchedule = () => setScheduleAnchorEl(null);
  const toggleSchedule = (e: React.MouseEvent<HTMLElement>) => {
    setGenCount((c) => (Number.isFinite(c) && c > 0 ? c : Math.max(1, videosPerDay)));
    setScheduleAnchorEl((prev) => (prev ? null : (e.currentTarget as HTMLElement)));
  };

  const timesList = React.useMemo(() => parseTimesCsv(timesCsv), [timesCsv]);
  const timesPopoverWidth = React.useMemo(() => {
    const n = timesList.length;
    if (n >= 14) return 640;
    if (n >= 10) return 600;
    if (n >= 6) return 540;
    return 480;
  }, [timesList.length]);

  // Time picker inside Schedule popover
  const [timePickValue, setTimePickValue] = React.useState<string>('09:00');

  // Time generator (start/end/step) + spread generator (N slots)
  const [genStart, setGenStart] = React.useState<string>('09:00');
  const [genEnd, setGenEnd] = React.useState<string>('18:00');
  const [genStep, setGenStep] = React.useState<number>(60);
  const [genCount, setGenCount] = React.useState<number>(3);
  // When Auto schedule is turned ON, schedule any rows that are marked as auto but don't have a slot yet.
  const prevAutoEnabledRef = React.useRef<boolean>(autoEnabled);
  React.useEffect(() => {
    const was = prevAutoEnabledRef.current;
    prevAutoEnabledRef.current = autoEnabled;
    if (was || !autoEnabled) return;

    // Auto-apply schedule - use updateRows to maintain referential stability
    updateRows((prev) => {
      const allRows = Array.from(prev.values());
      const existingScheduled = allRows.filter((r) => r.publishMode === 'schedule' && typeof r.publishAt === 'number');
      const toAssign = allRows
        .filter((r) => r.publishSource === 'auto' && (r.publishMode !== 'schedule' || !r.publishAt))
        .map((r) => ({ ...r, publishMode: 'schedule' as const, publishAt: null }));

      if (!toAssign.length) return prev;

      const assigned = applyAutoSchedule(toAssign, existingScheduled);
      const byId = new Map(assigned.map((a) => [a.id, a]));
      
      let hasChanges = false;
      const next = new Map(prev);
      for (const [id, assignedRow] of byId.entries()) {
        const currentRow = prev.get(id);
        if (currentRow && (
          currentRow.publishAt !== assignedRow.publishAt ||
          currentRow.publishMode !== assignedRow.publishMode
        )) {
          next.set(id, assignedRow);
          hasChanges = true;
        }
      }
      
      return hasChanges ? next : prev;
    });
  }, [autoEnabled]);


// === Auto upload (YouTube full auto, IG/TikTok manual assist) ===
React.useEffect(() => {
  try {
    localStorage.setItem('autoUploadEnabled', autoUploadEnabled ? '1' : '0');
  } catch {
    // ignore
  }
  const api: any = (window as any).api;
  api?.autouploadSetEnabled?.(autoUploadEnabled).catch?.(() => {});
}, [autoUploadEnabled]);

// Load and save silent mode
React.useEffect(() => {
  window.api?.autouploadGetSilentMode?.().then((silent: boolean) => {
    setSilentMode(silent);
    try {
      localStorage.setItem('silentMode', silent ? '1' : '0');
    } catch {
      // ignore
    }
  }).catch(() => {});
}, []);

React.useEffect(() => {
  try {
    localStorage.setItem('silentMode', silentMode ? '1' : '0');
  } catch {
    // ignore
  }
  const api: any = (window as any).api;
  api?.autouploadSetSilentMode?.(silentMode).catch?.(() => {});
}, [silentMode]);

// Save scheduled jobs to main process (debounced)
// Save jobs even if autoupload is disabled (for sync and when re-enabled)
const jobsSaveTimerRef = React.useRef<number | null>(null);
React.useEffect(() => {
  const api: any = (window as any).api;
  if (!api?.jobsSave) return;

  if (jobsSaveTimerRef.current) window.clearTimeout(jobsSaveTimerRef.current);
  jobsSaveTimerRef.current = window.setTimeout(() => {
    // Source of truth is scheduledJobs, because we support per-platform schedules (one job per platform).
    api.jobsSave(scheduledJobs).catch?.(() => {});
  }, 400);

  return () => {
    if (jobsSaveTimerRef.current) window.clearTimeout(jobsSaveTimerRef.current);
  };
}, [scheduledJobs]); // Note: autoUploadEnabled removed - jobs should be saved even if auto-upload is disabled

  // SINGLE mount effect: Restore pagination/scroll using apiRef
  React.useEffect(() => {
    if (scrollRestoredRef.current) return;
  
    // Wait for grid to be ready using apiRef
    const waitForGridReady = (): Promise<boolean> => {
      return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 60; // ~1 second at 60fps
        
        const check = () => {
          const api = gridApiRef.current;
          if (!api) {
            attempts++;
            if (attempts >= maxAttempts) {
              resolve(false);
              return;
            }
            requestAnimationFrame(check);
            return;
          }
          
          // Check if root element exists and has size
          const rootElement = (api as any).rootElementRef?.current as HTMLElement | undefined;
          if (rootElement) {
            const rect = rootElement.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              resolve(true);
              return;
            }
          }
          
          attempts++;
          if (attempts >= maxAttempts) {
            resolve(false);
            return;
          }
          
          requestAnimationFrame(check);
        };
        
        requestAnimationFrame(check);
      });
    };
    
    // Restore pagination and scroll after grid is ready
    waitForGridReady().then((ready) => {
      if (!ready || scrollRestoredRef.current) return;
      
      const api = gridApiRef.current;
      if (!api) return;
      
      // Restore pagination (already set via initial state, but ensure it's applied)
      try {
        const savedPaginationStr = localStorage.getItem('dataGridPagination');
        if (savedPaginationStr) {
          const savedPagination = JSON.parse(savedPaginationStr);
          if (savedPagination && 
              typeof savedPagination.page === 'number' && 
              typeof savedPagination.pageSize === 'number' &&
              savedPagination.page >= 0 && 
              savedPagination.pageSize > 0 &&
              (savedPagination.page !== paginationModel.page || savedPagination.pageSize !== paginationModel.pageSize)) {
            setPaginationModel({
              page: savedPagination.page,
              pageSize: savedPagination.pageSize,
            });
          }
        }
      } catch (e) {
        console.warn('[PAGINATION] Failed to restore from localStorage:', e);
      }
      
      // Restore scroll position using virtual scroller DOM (apiRef doesn't expose direct scroll methods)
      // Get virtual scroller via apiRef root element
      const rootElement = (api as any).rootElementRef?.current as HTMLElement | undefined;
      if (rootElement) {
        const virtualScroller = rootElement.querySelector('.MuiDataGrid-virtualScroller') as HTMLElement;
        if (virtualScroller && (initialScroll.top > 0 || initialScroll.left > 0)) {
          // Restore scroll after a short delay to ensure grid is fully rendered
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setTimeout(() => {
                const currentTop = virtualScroller.scrollTop ?? 0;
                const currentLeft = virtualScroller.scrollLeft ?? 0;
                const needsRestore = Math.abs(currentTop - initialScroll.top) > 1 ||
                                    Math.abs(currentLeft - initialScroll.left) > 1;
                
                if (needsRestore) {
                  virtualScroller.scrollTo({
                    top: initialScroll.top,
                    left: initialScroll.left,
                    behavior: 'auto',
                  });
                }
                
                scrollRestoredRef.current = true;
              }, 50);
            });
          });
          return;
        }
      }
      
      scrollRestoredRef.current = true;
    });
  }, []); // Run once on mount

  // Save scroll position on user scroll (throttled)
  React.useEffect(() => {
    let scrollSaveTimer: number | null = null;
    
    const handleScroll = () => {
      const api = gridApiRef.current;
      if (!api) return;
      
      // Get virtual scroller via apiRef root element
      const rootElement = (api as any).rootElementRef?.current as HTMLElement | undefined;
      if (!rootElement) return;
      
      const virtualScroller = rootElement.querySelector('.MuiDataGrid-virtualScroller') as HTMLElement;
      if (!virtualScroller) return;
      
      const scrollTop = virtualScroller.scrollTop;
      const scrollLeft = virtualScroller.scrollLeft;
      
      // Throttle localStorage saves (every 250ms)
      if (scrollSaveTimer) return;
      scrollSaveTimer = window.setTimeout(() => {
        scrollSaveTimer = null;
        if (scrollTop > 0 || scrollLeft > 0) {
          try {
            localStorage.setItem('dataGridScrollPosition', JSON.stringify({
              top: scrollTop,
              left: scrollLeft,
              timestamp: Date.now(),
            }));
          } catch (e) {
            // Ignore localStorage errors
          }
        }
      }, 250);
      
      // Stop metadata refresh while scrolling
      if (metadataRefreshIntervalRef.current) {
        clearInterval(metadataRefreshIntervalRef.current);
        metadataRefreshIntervalRef.current = null;
      }
    };

    // Attach scroll listener via apiRef
    const api = gridApiRef.current;
    if (api) {
      const rootElement = (api as any).rootElementRef?.current as HTMLElement | undefined;
      if (rootElement) {
        const virtualScroller = rootElement.querySelector('.MuiDataGrid-virtualScroller') as HTMLElement;
        if (virtualScroller) {
          virtualScroller.addEventListener('scroll', handleScroll, { passive: true });
        }
      }
    }

    // Also try to attach after a delay in case grid isn't ready yet
    const timeoutId = setTimeout(() => {
      const api = gridApiRef.current;
      if (api) {
        const rootElement = (api as any).rootElementRef?.current as HTMLElement | undefined;
        if (rootElement) {
          const virtualScroller = rootElement.querySelector('.MuiDataGrid-virtualScroller') as HTMLElement;
          if (virtualScroller) {
            virtualScroller.addEventListener('scroll', handleScroll, { passive: true });
          }
        }
      }
    }, 500);

    return () => {
      const api = gridApiRef.current;
      if (api) {
        const rootElement = (api as any).rootElementRef?.current as HTMLElement | undefined;
        if (rootElement) {
          const virtualScroller = rootElement.querySelector('.MuiDataGrid-virtualScroller') as HTMLElement;
          if (virtualScroller) {
            virtualScroller.removeEventListener('scroll', handleScroll);
          }
        }
      }
      if (scrollSaveTimer) {
        clearTimeout(scrollSaveTimer);
      }
      clearTimeout(timeoutId);
    };
  }, []); // Run once on mount

// REMOVED: All scroll restore logic disabled
// With stable rows identity, DataGrid maintains scroll position automatically

  // REMOVED: Pagination save is now handled in onPaginationModelChange

// Receive status updates from background auto-upload runner
React.useEffect(() => {
  const api: any = (window as any).api;
  if (!api?.onAutoUploadStatus) return;
  return api.onAutoUploadStatus((msg: AutoUploadStatusMsg) => {
    // Update upload status from auto-upload
    // Try to find row by job.id first, if not found, try to find by filePath from jobs
    const rowById = rowsById.get(msg.id);
    if (rowById) {
      // Found by ID - update directly
      if (msg.status === 'Done' || msg.status === 'Error') {
        // For Done/Error status, set upload status temporarily and wait for loadJobs to complete
        updateRow(msg.id, (r) => {
          const upload = { ...(r.upload || {}) };
          upload[msg.platform] = { 
            status: msg.status === 'Done' ? 'Done' : 'Error', 
            message: msg.message, 
            updatedAt: Date.now() 
          };
          return { ...r, upload };
        });
        // Use setTimeout to avoid state update during render
        setTimeout(() => {
          if (filter === 'scheduled') {
            setFilter('all');
          }
        }, 100);
        // Sync jobs/run status from disk and wait for it to complete
        void (async () => {
          await loadJobs();
          // After loadJobs completes, check if job.run[platform].done exists
          // Only clear the temporary upload status if job.run[platform].done exists
          // This ensures UI stays updated even if there's a delay in job.run being written
          setTimeout(async () => {
            // Re-read jobs from disk to get the latest state (scheduledJobs in closure might be stale)
            const current = await window.api?.jobsLoad?.();
            const jobs = Array.isArray(current) ? current : [];
            const job = jobs.find(j => j.id === msg.id);
            const hasRunDone = job?.run?.[msg.platform]?.done === true;
            
            // Only clear if job.run[platform].done exists (confirmed from disk)
            // Otherwise, keep the optimistic update until it's confirmed
            if (hasRunDone) {
              updateRow(msg.id, (r) => {
                const upload = { ...(r.upload || {}) };
                // Only clear if it's still the same status we set (don't clear if user changed it)
                if (upload[msg.platform]?.status === (msg.status === 'Done' ? 'Done' : 'Error')) {
                  delete upload[msg.platform];
                }
                return { ...r, upload };
              });
            }
          }, 100);
        })();
      } else {
        // For Processing/Assist/Info status, update directly
        updateRow(msg.id, (r) => {
          const upload = { ...(r.upload || {}) };
          upload[msg.platform] = { status: msg.status, message: msg.message, updatedAt: Date.now() };
          return { ...r, upload };
        });
      }
    } else {
      // Not found by ID - try to find by filePath from jobs (state or disk)
      void (async () => {
        let job = scheduledJobs.find(j => j.id === msg.id);
        if (!job) {
          const current = await window.api?.jobsLoad?.();
          const jobs = Array.isArray(current) ? current : [];
          job = jobs.find(j => j.id === msg.id);
        }
        if (job && job.filePath) {
          const jobKey = normalizeRowPrefsKey(job.filePath);
          // Find row by normalized filePath
          let rowByPath = Array.from(rowsById.values()).find(r => normalizeRowPrefsKey(r.filePath) === jobKey);
          if (!rowByPath) {
            const nameKey = normalizeFileNameKey(job.filePath);
            const byName = Array.from(rowsById.values()).filter(r => normalizeFileNameKey(r.filePath) === nameKey);
            if (byName.length === 1) {
              rowByPath = byName[0];
            }
          }
          if (rowByPath) {
            if (msg.status === 'Done' || msg.status === 'Error') {
              // For Done/Error status, set upload status temporarily and wait for loadJobs to complete
              updateRow(rowByPath.id, (r) => {
                const upload = { ...(r.upload || {}) };
                upload[msg.platform] = { 
                  status: msg.status === 'Done' ? 'Done' : 'Error', 
                  message: msg.message, 
                  updatedAt: Date.now() 
                };
                return { ...r, upload };
              });
              // Use setTimeout to avoid state update during render
              setTimeout(() => {
                if (filter === 'scheduled') {
                  setFilter('all');
                }
              }, 100);
              // Sync jobs/run status from disk and wait for it to complete
              void (async () => {
                await loadJobs();
                // After loadJobs completes, check if job.run[platform].done exists
                // Only clear the temporary upload status if job.run[platform].done exists
                // This ensures UI stays updated even if there's a delay in job.run being written
                setTimeout(async () => {
                  // Re-read jobs from disk to get the latest state (scheduledJobs in closure might be stale)
                  const current = await window.api?.jobsLoad?.();
                  const jobs = Array.isArray(current) ? current : [];
                  const job = jobs.find(j => j.id === msg.id);
                  const hasRunDone = job?.run?.[msg.platform]?.done === true;
                  
                  // Only clear if job.run[platform].done exists (confirmed from disk)
                  // Otherwise, keep the optimistic update until it's confirmed
                  if (hasRunDone) {
                    updateRow(rowByPath.id, (r) => {
                      const upload = { ...(r.upload || {}) };
                      // Only clear if it's still the same status we set (don't clear if user changed it)
                      if (upload[msg.platform]?.status === (msg.status === 'Done' ? 'Done' : 'Error')) {
                        delete upload[msg.platform];
                      }
                      return { ...r, upload };
                    });
                  }
                }, 100);
              })();
            } else {
              // For Processing/Assist/Info status, update directly
              updateRow(rowByPath.id, (r) => {
                const upload = { ...(r.upload || {}) };
                upload[msg.platform] = { status: msg.status, message: msg.message, updatedAt: Date.now() };
                return { ...r, upload };
              });
            }
          }
        }
      })();
    }
  });
}, [filter, rowsById, scheduledJobs, updateRow, normalizeRowPrefsKey, normalizeFileNameKey, loadJobs]);

// REMOVED: All scroll restore logic disabled
// With stable rows identity, DataGrid maintains scroll position automatically

  // REMOVED: Pagination save is now handled in onPaginationModelChange

// REMOVED: All scroll restore logic on rows change disabled
// With stable rows identity, DataGrid maintains scroll position automatically

// REMOVED: useLayoutEffect that restored scroll on rows/selectedRowId/paginationModel changes
// Now scroll is only restored on mount by the consolidated controller above

// Scroll preservation: Track user scrolling to avoid restoring scroll during active scrolling
React.useEffect(() => {
  const handleScroll = () => {
    isUserScrollingRef.current = true;
    // Clear existing timeout
    if (scrollTimeoutRef.current !== null) {
      clearTimeout(scrollTimeoutRef.current);
    }
    // Reset flag after scroll stops (150ms debounce)
    scrollTimeoutRef.current = window.setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 150);
  };

  // Wait for DataGrid to be rendered
  let vs: HTMLElement | null = null;
  let timeoutId: number | null = null;

  const setupScrollListener = () => {
    vs = document.querySelector('.MuiDataGrid-virtualScroller') as HTMLElement | null;
    if (vs) {
      vs.addEventListener('scroll', handleScroll, { passive: true });
      return true;
    }
    return false;
  };

  // Try to set up immediately
  if (!setupScrollListener()) {
    // If DataGrid not ready, wait a bit and try again
    timeoutId = window.setTimeout(() => {
      setupScrollListener();
    }, 100);
  }

  return () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    if (vs) {
      vs.removeEventListener('scroll', handleScroll);
    }
    if (scrollTimeoutRef.current !== null) {
      clearTimeout(scrollTimeoutRef.current);
    }
  };
}, [rowsById.size]); // Re-run when rows change (DataGrid might remount)

// Scroll preservation: Restore scroll position after rows deletion (pre-paint)
React.useLayoutEffect(() => {
  // Only restore if we have pending restore data and user is not actively scrolling
  if (pendingRestoreRef.current && !isUserScrollingRef.current) {
    const { top, left, ts } = pendingRestoreRef.current;
    // Only restore if restore request is recent (within 2 seconds)
    if (Date.now() - ts < 2000) {
      const vs = document.querySelector('.MuiDataGrid-virtualScroller') as HTMLElement | null;
      if (vs) {
        // Clamp scrollTop to valid range to avoid overscroll after deletion
        const maxScrollTop = Math.max(0, vs.scrollHeight - vs.clientHeight);
        const clampedTop = Math.min(top, maxScrollTop);
        vs.scrollTop = clampedTop;
        vs.scrollLeft = left;
      }
    }
    // Clear pending restore after attempting restoration
    pendingRestoreRef.current = null;
  }
}, [dataRevision]);

// REMOVED: Duplicate status update handler (already handled above)

// Handle focus job request from notifications
React.useEffect(() => {
  const api: any = (window as any).api;
  if (!api?.onFocusJob) return;
  return api.onFocusJob((data: { filePath: string; platform: string }) => {
    // Find the row matching the filePath
    const rowsArray = Array.from(rowsById.values());
    const matchingRow = rowsArray.find(r => r.filePath.toLowerCase() === data.filePath.toLowerCase());
    if (matchingRow) {
      // Set filter to show scheduled jobs
      setFilter('scheduled');
      // Select the row
      setSelectionModel({ type: 'include', ids: new Set([matchingRow.id]) });
      // Optionally scroll to the row (DataGrid will handle this automatically when selected)
      setSnack(
        t('focusedJobForFile', {
          platform: platformLabels[(data.platform as MetaPlatform) ?? 'youtube'] || data.platform,
          file: baseName(data.filePath),
        }),
      );
    } else {
      // Row not found, try to load it or show message
      setSnack(t('jobNotFoundForFile', { file: baseName(data.filePath) }));
    }
  });
}, [platformLabels, rows, t]);

  const slotsMinutes = React.useMemo(() => {
    const t = parseTimesCsv(timesCsv);
    return t.length ? t : [9 * 60, 13 * 60, 18 * 60];
  }, [timesCsv]);

  // logs from pipeline - SEPARATED from rows to prevent scroll reset
  // Logs are stored in separate state (logsById) and merged into rows via useMemo
  // This prevents DataGrid from resetting scroll when logs update frequently
  const pipelineLogBufferRef = React.useRef('');
  const pipelineFileDoneCooldownRef = React.useRef<Map<string, number>>(new Map());
  const handlePipelineFileDone = React.useCallback((filePath: string, status?: string) => {
    if (!filePath) return;
    const fileKey = normalizeRowPrefsKey(filePath);
    const now = Date.now();
    const last = pipelineFileDoneCooldownRef.current.get(fileKey);
    if (last && (now - last) < 1000) return;
    pipelineFileDoneCooldownRef.current.set(fileKey, now);
    let rowByPath = rowsRef.current.find((r) => normalizeRowPrefsKey(r.filePath) === fileKey);
    if (!rowByPath) {
      const nameKey = normalizeFileNameKey(filePath);
      const matches = rowsRef.current.filter((r) => normalizeFileNameKey(r.filePath) === nameKey);
      if (matches.length === 1) {
        rowByPath = matches[0];
      }
    }
    if (!rowByPath) return;
    const statusText = String(status || '').toLowerCase();
    const nextStatus = statusText === 'error' ? 'Error' : 'Done';
    updateRow(rowByPath.id, (r) => {
      if (r.status === nextStatus) return r;
      return { ...r, status: nextStatus as const };
    });
    const refreshNow = () => {
      void refreshOutputsForPathRef.current(rowByPath.filePath, true, true);
    };
    refreshNow();
    // Clear tombstones for regenerated metadata and refresh again
    void (async () => {
      if (window.api?.unmarkDeletedMetadata) {
        const platforms: MetaPlatform[] = ['youtube', 'instagram', 'tiktok'];
        await Promise.all(
          platforms.map(async (platform) => {
            try {
              await window.api?.unmarkDeletedMetadata?.({ filePath: rowByPath?.filePath, platform });
            } catch {
              // ignore
            }
          }),
        );
      }
      refreshNow();
      window.setTimeout(refreshNow, 500);
    })();
  }, [normalizeRowPrefsKey, normalizeFileNameKey, updateRow]);
  React.useEffect(() => {
    if (!window.api?.onPipelineLog) return;
    const off = window.api.onPipelineLog((msg) => {
      // Update logs in separate state - this doesn't trigger rows rebuild
      setLogsById((prev) => {
        const next = new Map(prev);
        // Find Processing rows and update their logs
        // Use rowsById from closure to avoid dependency
        const currentRowsById = rowsById;
        for (const row of currentRowsById.values()) {
          if (row.status === 'Processing') {
            // Get log from separate state, fallback to empty string
            const currentLog = prev.get(row.id) || '';
            const newLog = (currentLog + msg.line).slice(-20000);
            if (newLog !== currentLog) {
              next.set(row.id, newLog);
            }
          }
        }
        return next.size > 0 ? next : prev;
      });
      if (msg?.line) {
        pipelineLogBufferRef.current += msg.line;
        const lines = pipelineLogBufferRef.current.split(/\r?\n/);
        pipelineLogBufferRef.current = lines.pop() ?? '';
        for (const line of lines) {
          const marker = 'PIPELINE_FILE_DONE|';
          const markerIndex = line.indexOf(marker);
          if (markerIndex === -1) continue;
          const raw = line.slice(markerIndex + marker.length);
          const parts = raw.split('|');
          const action = (parts[0] || '').trim();
          const filePath = parts.slice(1).join('|').trim();
          if (filePath) {
            const nextStatus = action === 'ERROR' ? 'Error' : 'Done';
            handlePipelineFileDone(filePath, nextStatus);
          }
        }
      }
    });
    return () => off?.();
  }, [rowsById, handlePipelineFileDone]);

  // Progressive per-file updates from pipeline runner
  React.useEffect(() => {
    if (!window.api?.onPipelineFileDone) return;
    const off = window.api.onPipelineFileDone((msg) => {
      const filePath = msg?.filePath;
      if (!filePath) return;
      handlePipelineFileDone(filePath, msg?.status);
    });
    return () => off?.();
  }, [handlePipelineFileDone]);

  const syncSupabaseToken = React.useCallback(async () => {
    if (!requireOnline({ showDialog: false })) return;
    const supabase = getSupabase();
    if (!supabase || !window.api?.authSetSupabaseAccessToken) return;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token ?? '';
      const baseUrl = (import.meta as any)?.env?.VITE_SUPABASE_URL as string | undefined;
      const functionsUrl = baseUrl ? `${String(baseUrl).replace(/\/+$/, '')}/functions/v1` : '';
      await window.api.authSetSupabaseAccessToken(token, functionsUrl);
    } catch (err) {
      handleNetworkError(err);
    }
  }, [handleNetworkError, requireOnline]);

  const loadAuthAndEntitlement = React.useCallback(async () => {
    const supabase = getSupabase();
    if (!requireOnline({ showDialog: false })) {
      setEntitlementLoading(false);
      return authEntitlementRef.current;
    }
    setEntitlementLoading(true);
    try {
      const snapshot = await loadAuthAndEntitlementState(supabase);
      setAuthEntitlement(snapshot);
      setSupabaseUser(snapshot.user);
      setEntitlement(snapshot.entitlement as EntitlementRow | null);
      setSubscriptionInfo(snapshot.subscription as SubscriptionRow | null);
      if (snapshot.isSignedIn) {
        const now = Date.now();
        setLastEntitlementCheckAt(now);
        try {
          localStorage.setItem(ENTITLEMENT_LAST_CHECK_AT_KEY, String(now));
        } catch {
          // ignore
        }
      }
      void syncSupabaseToken();
      return snapshot;
    } catch (err: unknown) {
      if (handleNetworkError(err)) {
        return authEntitlementRef.current;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error('[auth] load auth+entitlement failed:', message);
      setAuthEntitlement({
        ...INITIAL_AUTH_ENTITLEMENT,
        authState: 'signedOut',
      });
      setSupabaseUser(null);
      setEntitlement(null);
      setSubscriptionInfo(null);
      void syncSupabaseToken();
      return {
        ...INITIAL_AUTH_ENTITLEMENT,
        authState: 'signedOut' as const,
      };
    } finally {
      setEntitlementLoading(false);
    }
  }, [handleNetworkError, requireOnline, syncSupabaseToken]);

  React.useEffect(() => {
    if (networkStatus !== 'online') return;
    void loadAuthAndEntitlement();
    void refreshUsageSnapshot();
  }, [loadAuthAndEntitlement, networkStatus, refreshUsageSnapshot]);

  const ENTITLEMENT_RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
  React.useEffect(() => {
    const id = window.setInterval(() => {
      void loadAuthAndEntitlement();
    }, ENTITLEMENT_RECHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [loadAuthAndEntitlement]);

  React.useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && networkStatus === 'online') {
        void loadAuthAndEntitlement();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [loadAuthAndEntitlement, networkStatus]);

  // Deep link: parse callback URL, exchange code or setSession, update auth state, close Account modal, toast
  const handleAuthDeepLink = React.useCallback(async (url: string) => {
    if (!url) return;
    if (!requireOnline()) {
      window.dispatchEvent(new CustomEvent('auth:sign-in-failed'));
      return;
    }
    const now = Date.now();
    const last = lastProcessedDeepLinkRef.current;
    if (last && last.url === url && now - last.ts < 2000) {
      console.log('[auth] duplicate deep link ignored');
      return;
    }
    lastProcessedDeepLinkRef.current = { url, ts: now };

    setAuthDeepLinkUrl(url);

    const { merged } = parseParamsFromUrl(url);
    const hasCode = Boolean(merged.code);
    const hasAccessToken = Boolean(merged.access_token);
    const hasRefreshToken = Boolean(merged.refresh_token);
    console.log('[auth] parsed params', {
      hasCode,
      hasAccessToken,
      hasRefreshToken,
      paramKeys: Object.keys(merged),
    });

    const supabase = getSupabase();
    if (!supabase) {
      setSnack(t('authNotConfigured'));
      window.dispatchEvent(new CustomEvent('auth:sign-in-failed'));
      return;
    }

    let branch: 'exchangeCodeForSession' | 'setSession' | 'missing';
    try {
      if (hasCode) {
        branch = 'exchangeCodeForSession';
        const { error } = await supabase.auth.exchangeCodeForSession(merged.code!);
        if (error) throw error;
        console.log('[auth] exchangeCodeForSession success');
      } else if (hasAccessToken && hasRefreshToken) {
        branch = 'setSession';
        const { error } = await supabase.auth.setSession({
          access_token: merged.access_token!,
          refresh_token: merged.refresh_token!,
        });
        if (error) throw error;
        console.log('[auth] setSession success');
      } else {
        branch = 'missing';
        console.log('[auth] branch used', branch);
        setSnack(t('authCallbackMissingCodeOrTokens'));
        window.dispatchEvent(new CustomEvent('auth:sign-in-failed'));
        return;
      }

      console.log('[auth] branch used', branch);
      const snapshot = await loadAuthAndEntitlement();
      void syncSupabaseToken();
      setSnack(snapshot.user?.email ? t('signedInAs', { email: snapshot.user.email }) : t('authSignedInSuccess'));
      console.log('[auth] session exists', Boolean(snapshot.user), 'user email:', snapshot.user?.email ?? '—');

      setAccountDialogOpen(false);
      setAuthDeepLinkUrl(null);
      console.log('[auth] modal closed');
      window.dispatchEvent(new CustomEvent('auth:signed-in'));
    } catch (err: unknown) {
      if (handleNetworkError(err)) {
        window.dispatchEvent(new CustomEvent('auth:sign-in-failed'));
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error('[auth] finalize failed:', message);
      setSnack(t('authExchangeFailed', { message }));
      window.dispatchEvent(new CustomEvent('auth:sign-in-failed'));
    }
  }, [handleNetworkError, loadAuthAndEntitlement, requireOnline, syncSupabaseToken, t]);

  React.useEffect(() => {
    const onDeepLink = (e: Event) => {
      const url = (e as CustomEvent<string>).detail;
      void handleAuthDeepLink(url);
    };
    window.addEventListener('clipcast-deep-link', onDeepLink);
    return () => window.removeEventListener('clipcast-deep-link', onDeepLink);
  }, [handleAuthDeepLink]);

  // Load existing session on mount + onAuthStateChange so UI reacts to SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT
  React.useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    void loadAuthAndEntitlement();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      void loadAuthAndEntitlement();
      void syncSupabaseToken();
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [loadAuthAndEntitlement, syncSupabaseToken]);

  const handleOpenExternal = React.useCallback(
    async (url: string) => {
      const opener = window.clipcast?.openExternal ?? window.api?.openExternal;
      if (!opener) {
        setSnack(t('signInNotConfigured'));
        return;
      }
      if (networkStatus === 'offline') {
        setSnack('You are offline. This page may not load.');
      }
      const result = await opener(url);
      if (result?.ok !== true && result?.error) {
        setSnack(result.error ?? t('signInError', { message: 'Failed to open browser' }));
      }
    },
    [networkStatus, setSnack, t],
  );

  const handleUpgrade = React.useCallback(() => {
    void handleOpenExternal(PRICING_URL);
  }, [handleOpenExternal]);
  const handleManageBilling = React.useCallback(() => {
    void handleOpenExternal(BILLING_URL);
  }, [handleOpenExternal]);

  // Remove videos function (supports single or bulk)
  const removeVideos = React.useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      
      // Save to history before action (including rows since we're deleting files)
      await saveToHistory(true);
      
      // Find rows to remove
      const rowsArray = Array.from(rowsById.values());
      const rowsToRemove = rowsArray.filter((r) => ids.includes(r.id));
      if (rowsToRemove.length === 0) return;
      
      // Store for undo (legacy system - keeping for backward compatibility)
      setDeletedItems(rowsToRemove);
      
      // Capture scroll state BEFORE deletion (only if user is not actively scrolling)
      if (!isUserScrollingRef.current) {
        const vs = document.querySelector('.MuiDataGrid-virtualScroller') as HTMLElement | null;
        if (vs) {
          pendingRestoreRef.current = {
            top: vs.scrollTop,
            left: vs.scrollLeft,
            ts: Date.now(),
          };
        }
      }
      
      // Update selection model BEFORE rows update (synchronously, no requestAnimationFrame)
      // This avoids extra rerender that could cause scroll reset
      setSelectionModel((prev) => {
        if (prev.type === 'include') {
          const newIds = new Set(prev.ids);
          ids.forEach(id => newIds.delete(id));
          return { type: 'include', ids: newIds };
        }
        return prev;
      });
      
      // Remove from rows
      // Remove rows - use updateRows to maintain referential stability
      updateRows((prev) => {
        const next = new Map(prev);
        for (const id of ids) {
          next.delete(id);
        }
        return next;
      });
      
      // Also remove associated jobs from jobs.json
      try {
        const current = await window.api?.jobsLoad?.();
        const jobs = Array.isArray(current) ? current : [];
        const filePathsToRemove = new Set(rowsToRemove.map(r => r.filePath));
        const filteredJobs = jobs.filter(j => !filePathsToRemove.has(j.filePath));
        
        if (filteredJobs.length !== jobs.length) {
          await window.api?.jobsSave?.(filteredJobs);
          setScheduledJobs(filteredJobs);
        }
      } catch (e) {
        console.error('Failed to remove jobs:', e);
      }
      
      // Show undo snack
      setUndoSnackOpen(true);
    },
    [rowsById, saveToHistory, updateRows, setSelectionModel, setDeletedItems, setScheduledJobs, setUndoSnackOpen, gridApiRef],
  );
  
  // Undo delete
  const undoDelete = React.useCallback(() => {
    if (deletedItems.length === 0) return;
    
    // Restore rows
    // Restore deleted rows - use updateRows to maintain referential stability
    updateRows((prev) => {
      const existingIds = new Set(prev.keys());
      const toRestore = deletedItems.filter(r => !existingIds.has(r.id));
      if (toRestore.length === 0) return prev;
      
      const next = new Map(prev);
      for (const row of toRestore) {
        next.set(row.id, row);
      }
      return next;
    });
    
    // Restore jobs
    const restoreJobs = async () => {
      try {
        const current = await window.api?.jobsLoad?.();
        const jobs = Array.isArray(current) ? current : [];
        const existingPaths = new Set(jobs.map(j => j.filePath));
        
        // Re-add jobs for restored rows that had scheduled jobs
        for (const row of deletedItems) {
          if (row.publishMode === 'schedule' && row.publishAt && row.targets) {
            const hasAnyTarget = row.targets.youtube || row.targets.instagram || row.targets.tiktok;
            if (hasAnyTarget && !existingPaths.has(row.filePath)) {
              jobs.push({
                id: newId(),
                filePath: row.filePath,
                publishAtUtcMs: row.publishAt,
                targets: row.targets,
                visibility: row.visibility || 'private',
                selfDeclaredMadeForKids: row.selfDeclaredMadeForKids ?? false,
                createdAt: Date.now(),
              });
            }
          }
        }
        
        await window.api?.jobsSave?.(jobs);
        setScheduledJobs(jobs);
      } catch (e) {
        console.error('Failed to restore jobs:', e);
      }
    };
    
    void restoreJobs();
    setDeletedItems([]);
    setUndoSnackOpen(false);
  }, [deletedItems]);
  
  // Handle delete confirmation
  const handleDeleteConfirm = React.useCallback(() => {
    if (itemsToDelete.length > 0) {
      removeVideos(itemsToDelete);
      setItemsToDelete([]);
    }
    setDeleteConfirmOpen(false);
  }, [itemsToDelete, removeVideos]);

  // Restore archived rows (clear archivedAt)
  const restoreArchivedRows = React.useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      updateRows((prev) => {
        let hasChanges = false;
        const next = new Map(prev);
        for (const id of ids) {
          const row = prev.get(id);
          if (row?.archivedAt != null) {
            const { archivedAt: _a, ...rest } = row;
            next.set(id, { ...rest, archivedAt: undefined });
            hasChanges = true;
          }
        }
        return hasChanges ? next : prev;
      });
      setSnack(t('archivedRowsRestored'));
    },
    [updateRows, t],
  );

  // Delete rows from app only (removes from library + jobs; does not delete video files)
  const deleteFromApp = React.useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const rowsArray = Array.from(rowsById.values());
      const rowsToRemove = rowsArray.filter((r) => ids.includes(r.id));
      if (rowsToRemove.length === 0) return;
      setSelectionModel((prev) => {
        if (prev.type === 'include') {
          const newIds = new Set(prev.ids);
          ids.forEach((id) => newIds.delete(id));
          return { type: 'include', ids: newIds };
        }
        return prev;
      });
      updateRows((prev) => {
        const next = new Map(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      try {
        const current = await window.api?.jobsLoad?.();
        const jobs = Array.isArray(current) ? current : [];
        const filePathsToRemove = new Set(rowsToRemove.map((r) => r.filePath));
        const filteredJobs = jobs.filter((j) => !filePathsToRemove.has(j.filePath));
        if (filteredJobs.length !== jobs.length) {
          await window.api?.jobsSave?.(filteredJobs);
          setScheduledJobs(filteredJobs);
        }
      } catch (e) {
        console.error('Failed to remove jobs:', e);
      }
      setSnack(t('rowsRemovedFromApp'));
    },
    [rowsById, updateRows, setSelectionModel, setScheduledJobs, t],
  );

  const handleDeleteFromAppConfirm = React.useCallback(() => {
    if (itemsToDeleteFromApp.length > 0) {
      deleteFromApp(itemsToDeleteFromApp);
      setItemsToDeleteFromApp([]);
    }
    setDeleteFromAppConfirmOpen(false);
  }, [itemsToDeleteFromApp, deleteFromApp]);

  // Handle context menu
  const handleContextMenu = React.useCallback((event: React.MouseEvent, rowId?: string, platform?: 'youtube' | 'instagram' | 'tiktok') => {
    event.preventDefault();
    event.stopPropagation();
    
    setContextMenu(
      contextMenu === null
        ? {
            mouseX: event.clientX + 2,
            mouseY: event.clientY - 6,
            rowId: rowId || null,
            platform: platform || null,
          }
        : null,
    );
  }, [contextMenu]);
  
  const handleCloseContextMenu = React.useCallback(() => {
    setContextMenu(null);
  }, []);
  
  
  // Undo function
  const performUndo = React.useCallback(async () => {
    if (historyIndex < 0 || history.length === 0) {
      setSnack(t('nothingToUndo'));
      return;
    }

    try {
      setIsUndoRedoInProgress(true);
      const previousState = history[historyIndex];
      
      if (!previousState) {
        setSnack(t('invalidHistoryState'));
        return;
      }
      
      // Restore jobs from history
      await window.api?.jobsSave?.(JSON.parse(JSON.stringify(previousState.jobs))); // Deep clone
      setScheduledJobs(JSON.parse(JSON.stringify(previousState.jobs))); // Deep clone
      
      // Restore rows if they were saved in history (e.g., after file deletion)
      if (previousState.rows) {
        setAllRows(JSON.parse(JSON.stringify(previousState.rows))); // Deep clone
      }
      
      // Move history index back (but don't go below -1)
      setHistoryIndex((prev) => Math.max(-1, prev - 1));
      
      // Reload jobs to sync UI
      void loadJobs();
      
      setSnack(t('undone'));
    } catch (e) {
      console.error('Failed to undo:', e);
      setSnack(t('failedToUndo'));
    } finally {
      setIsUndoRedoInProgress(false);
    }
  }, [history, historyIndex, loadJobs, setSnack, setAllRows, t]);

  // Redo function
  const performRedo = React.useCallback(async () => {
    // Check if we can redo (must have a next state in history)
    if (historyIndex < -1 || historyIndex >= history.length - 1) {
      setSnack(t('nothingToRedo'));
      return;
    }

    try {
      setIsUndoRedoInProgress(true);
      const nextIndex = historyIndex + 1;
      const nextState = history[nextIndex];
      
      if (!nextState) {
        setSnack(t('invalidHistoryStateRedo'));
        return;
      }
      
      // Restore jobs from history
      await window.api?.jobsSave?.(JSON.parse(JSON.stringify(nextState.jobs))); // Deep clone
      setScheduledJobs(JSON.parse(JSON.stringify(nextState.jobs))); // Deep clone
      
      // Restore rows if they were saved in history (e.g., after file deletion)
      if (nextState.rows) {
        setAllRows(JSON.parse(JSON.stringify(nextState.rows))); // Deep clone
      }
      
      // Move history index forward
      setHistoryIndex(nextIndex);
      
      // Reload jobs to sync UI
      void loadJobs();
      
      setSnack(t('redone'));
    } catch (e) {
      console.error('Failed to redo:', e);
      setSnack(t('failedToRedo'));
    } finally {
      setIsUndoRedoInProgress(false);
    }
  }, [history, historyIndex, loadJobs, setSnack, setAllRows, t]);

  // Keyboard shortcuts for Delete, Undo, and Redo
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when not typing in an input
      const isInputFocused = e.target instanceof HTMLInputElement || 
                            e.target instanceof HTMLTextAreaElement ||
                            (e.target instanceof HTMLElement && e.target.isContentEditable);
      
      // Ctrl+Z for Undo
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey && !isInputFocused) {
        e.preventDefault();
        void performUndo();
        return;
      }
      
      // Ctrl+Shift+Z or Ctrl+Y for Redo
      if (e.ctrlKey && ((e.shiftKey && e.key === 'z') || e.key === 'y') && !isInputFocused) {
        e.preventDefault();
        void performRedo();
        return;
      }

      // Ctrl+Shift+X to stop metadata pipeline + clear queue
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'x' && !isInputFocused) {
        e.preventDefault();
        void stopAllMetadataJobs('shortcut');
        return;
      }
      
      // Delete key
      if (e.key === 'Delete' && !isInputFocused) {
        if (selectedIds.length > 0) {
          e.preventDefault();
          setItemsToDelete(selectedIds);
          setDeleteConfirmOpen(true);
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, performUndo, performRedo, stopAllMetadataJobs]);

  // Remove a single scheduled job or a platform from a job
  const removeJob = React.useCallback(async (jobId: string, platform?: 'youtube' | 'instagram' | 'tiktok') => {
    try {
      // Save to history before action
      await saveToHistory();
      
      // First, find the job in scheduledJobs state (this is the source of truth for UI)
      const jobFromState = scheduledJobs.find(j => j.id === jobId);
      if (!jobFromState) {
        console.error('Job not found in state. Looking for ID:', jobId);
        console.error('Available jobs in state:', scheduledJobs.map(j => ({ id: j.id, filePath: j.filePath })));
        setSnack(t('jobNotFoundRefresh'));
        return;
      }
      
      // Load current jobs from storage
      const current = await window.api?.jobsLoad?.();
      const jobs = Array.isArray(current) ? current : [];
      
      // Find the job in storage - try by ID first
      let jobIndex = jobs.findIndex(j => j.id === jobId);
      
      // If not found by ID, try to find by filePath and publishAtUtcMs
      if (jobIndex === -1) {
        jobIndex = jobs.findIndex(j => 
          j.filePath === jobFromState.filePath && 
          j.publishAtUtcMs === jobFromState.publishAtUtcMs
        );
      }
      
      // If still not found, try just by filePath (in case there's only one job for this file)
      if (jobIndex === -1) {
        const jobsForFile = jobs.filter(j => j.filePath === jobFromState.filePath);
        if (jobsForFile.length === 1) {
          jobIndex = jobs.findIndex(j => j.filePath === jobFromState.filePath);
        }
      }
      
      // If still not found, create a new job entry based on state
      let job: ScheduledJob;
      if (jobIndex === -1) {
        // Job exists in state but not in storage - use state data
        job = jobFromState;
        // Add it to jobs array so we can update it
        jobs.push(job);
        jobIndex = jobs.length - 1;
      } else {
        job = jobs[jobIndex];
      }
      
      // If platform is specified, remove only that platform from the job
      if (platform) {
        const updatedTargets = { ...job.targets };
        updatedTargets[platform] = false;
        
        // Check if any targets remain
        const hasAnyTarget = updatedTargets.youtube || updatedTargets.instagram || updatedTargets.tiktok;
        
        if (!hasAnyTarget) {
          // No targets left, remove the entire job
          const filteredJobs = jobs.filter(j => j.id !== jobId);
          await window.api?.jobsSave?.(filteredJobs);
          setScheduledJobs(filteredJobs);
        } else {
          // Update the job with remaining targets
          jobs[jobIndex] = { ...job, targets: updatedTargets };
          await window.api?.jobsSave?.(jobs);
          setScheduledJobs([...jobs]);
        }
      } else {
        // Remove the entire job
        const filteredJobs = jobs.filter(j => j.id !== jobId);
        await window.api?.jobsSave?.(filteredJobs);
        setScheduledJobs(filteredJobs);
      }
      
      // Reload jobs to get updated state
      const updated = await window.api?.jobsLoad?.();
      const updatedJobs = Array.isArray(updated) ? updated : [];
      setScheduledJobs(updatedJobs);
      
      // Update rows to reflect the changes
      // Update rows based on remaining jobs - use updateRows to maintain referential stability
      updateRows((prev) => {
        let hasChanges = false;
        const next = new Map(prev);
        
        for (const row of prev.values()) {
          if (row.filePath === job.filePath) {
            // Find remaining jobs for this row
            const remainingJobs = updatedJobs.filter(j => j.filePath === row.filePath);
            
            if (remainingJobs.length === 0) {
              // No more jobs for this row, clear targets and publishAt
              next.set(row.id, {
                ...row,
                targets: { youtube: false, instagram: false, tiktok: false },
                publishAt: null,
                publishMode: 'now' as const,
              });
              hasChanges = true;
            } else {
              // Merge targets from remaining jobs
              const mergedTargets = { youtube: false, instagram: false, tiktok: false };
              let latestPublishAt: number | null = null;
              
              for (const j of remainingJobs) {
                if (j.targets && j.targets.youtube) mergedTargets.youtube = true;
                if (j.targets && j.targets.instagram) mergedTargets.instagram = true;
                if (j.targets && j.targets.tiktok) mergedTargets.tiktok = true;
                if (j.publishAtUtcMs && (!latestPublishAt || j.publishAtUtcMs > latestPublishAt)) {
                  latestPublishAt = j.publishAtUtcMs;
                }
              }
              
              const currentTargets = row.targets || { youtube: false, instagram: false, tiktok: false };
              const targetsChanged = 
                currentTargets.youtube !== mergedTargets.youtube ||
                currentTargets.instagram !== mergedTargets.instagram ||
                currentTargets.tiktok !== mergedTargets.tiktok;
              const publishAtChanged = row.publishAt !== latestPublishAt;
              const publishModeChanged = (latestPublishAt ? 'schedule' : 'now') !== row.publishMode;
              
              if (targetsChanged || publishAtChanged || publishModeChanged) {
                next.set(row.id, {
                  ...row,
                  targets: mergedTargets,
                  publishAt: latestPublishAt,
                  publishMode: latestPublishAt ? 'schedule' as const : 'now' as const,
                });
                hasChanges = true;
              }
            }
          }
        }
        
        return hasChanges ? next : prev;
      });
      
      setSnack(platform ? t('removedPlatformFromJob', { platform: platformLabels[platform] }) : t('jobRemoved'));
    } catch (e) {
      console.error('Failed to remove job:', e);
      setSnack(t('failedToRemoveJob'));
    }
  }, [scheduledJobs, normalizeRowPrefsKey, normalizeFileNameKey, platformLabels, t]);

  // Helper function to get platform status for a row
  const getPlatformStatus = React.useCallback((row: JobRow, platform: MetaPlatform): {
    status: 'none' | 'scheduled' | 'ready' | 'processing' | 'done' | 'failed';
    scheduledTime?: number;
    postedAt?: number;
    message?: string;
  } => {
    // First, check if there's a temporary upload status (for immediate UI feedback)
    // This is set when status updates are received but loadJobs() hasn't finished yet
    const uploadStatus = row.upload?.[platform];
    if (uploadStatus) {
      if (uploadStatus.status === 'Done') return { status: 'done', message: uploadStatus.message, postedAt: uploadStatus.updatedAt };
      if (uploadStatus.status === 'Error') return { status: 'failed', message: uploadStatus.message };
      if (uploadStatus.status === 'Processing') return { status: 'processing', message: uploadStatus.message };
      if (uploadStatus.status === 'Assist') return { status: 'ready', message: uploadStatus.message };
      if (uploadStatus.status === 'Info') return { status: 'ready', message: uploadStatus.message };
    }

    // Check if there's a scheduled job for this platform (from scheduledJobs or from row.publishAt)
    const jobsForRow = getJobsForRow(row);
    const jobsForPlatform = jobsForRow.filter(
      (j) => Boolean(j.targets?.[platform]) || Boolean(j.run?.[platform]),
    );
    if (jobsForPlatform.length === 0) return { status: 'none' };

    const runDoneJob = jobsForPlatform.find((j) => j.run?.[platform]?.done);
    if (runDoneJob) {
      const runStatus = runDoneJob.run?.[platform];
      if (runStatus?.ok) {
        return { 
          status: 'done',
          postedAt: typeof runStatus.at === 'number' ? runStatus.at : undefined
        };
      }
      return { status: 'failed', message: runStatus?.error };
    }

    const job = jobsForPlatform.find((j) => typeof j.publishAtUtcMs === 'number');
    const scheduledTime = typeof job?.publishAtUtcMs === 'number' ? job.publishAtUtcMs : null;
    
    if (scheduledTime != null) {
      const now = Date.now();
      if (scheduledTime > now) {
        // Future scheduled time
        return { status: 'scheduled', scheduledTime };
      }
      return { status: 'ready', scheduledTime };
    }

    // Job exists but no scheduled time - ready to schedule
    return { status: 'ready' };
  }, [getJobsForRow]);

  // Calculate overall row status based on user requirements
  // Priority order: Failed > Processing > Done > Scheduled > Ready > Needs action
  const getRowStatus = React.useCallback((row: JobRow): 'needsAction' | 'ready' | 'scheduled' | 'processing' | 'done' | 'failed' => {
    // 1. Check for Failed status (highest priority)
    // - Pipeline failed (status === 'Error')
    if (row.status === 'Error') {
      return 'failed';
    }
    
    const jobsForRow = getJobsForRow(row);
    const platformSet = new Set<MetaPlatform>();
    for (const j of jobsForRow) {
      if (j.targets?.youtube || j.run?.youtube) platformSet.add('youtube');
      if (j.targets?.instagram || j.run?.instagram) platformSet.add('instagram');
      if (j.targets?.tiktok || j.run?.tiktok) platformSet.add('tiktok');
    }
    const platforms = Array.from(platformSet);
    
    for (const platform of platforms) {
      const platformStatus = getPlatformStatus(row, platform);
      if (platformStatus.status === 'failed') {
        return 'failed';
      }
    }

    // Check jobs for failed status
    for (const job of jobsForRow) {
      if (job.run) {
        for (const platform of platforms) {
          const runStatus = job.run[platform as 'youtube' | 'instagram' | 'tiktok'];
          if (runStatus?.done && !runStatus.ok) {
            return 'failed';
          }
        }
      }
    }
    
    // 2. Check for Processing status
    // - Pipeline running (status === 'Processing')
    if (row.status === 'Processing') {
      return 'processing';
    }
    
    // - Upload in progress for any enabled platform
    for (const platform of platforms) {
      const platformStatus = getPlatformStatus(row, platform);
      if (platformStatus.status === 'processing') {
        return 'processing';
      }
    }
    
    // 3. Check for Done status
    // - All enabled platforms are done
    if (platforms.length > 0) {
      let allDone = true;
      for (const platform of platforms) {
        const platformStatus = getPlatformStatus(row, platform);
        if (platformStatus.status !== 'done') {
          allDone = false;
          break;
        }
      }
      if (allDone) {
        return 'done';
      }
    }
    
    // 4. Check for Scheduled status (future time) or due (past scheduled time – job still exists, assist pending)
    for (const platform of platforms) {
      const platformStatus = getPlatformStatus(row, platform);
      if (platformStatus.status === 'scheduled') {
        return 'scheduled';
      }
      // Due = past scheduled time; keep Stage as scheduled so grid matches Row Details / Assist Center
      if (platformStatus.status === 'ready' && platformStatus.scheduledTime != null) {
        return 'scheduled';
      }
    }

    // 5. Check for Ready status
    // - Metadata complete (title + description + hashtags) for at least one platform (not just enabled ones)
    // - NO publishAt set yet
    // - Not processing and not failed
    // Note: Targets are NOT required for Ready status (can be set later)
    
    // Check if metadata is complete for at least one platform (check all platforms, not just enabled ones)
    let hasCompleteMetadata = false;
    const allPlatforms: MetaPlatform[] = ['youtube', 'instagram', 'tiktok'];
    for (const platform of allPlatforms) {
      const meta = row.meta?.byPlatform?.[platform];
      if (meta) {
        const hasTitle = Boolean(meta.title?.trim());
        const hasDescription = Boolean(meta.description?.trim());
        const hasHashtags = Boolean(
          (Array.isArray(meta.hashtags) && meta.hashtags.length > 0) ||
          (typeof meta.hashtags === 'string' && meta.hashtags.trim())
        );
        if (hasTitle && hasDescription && hasHashtags) {
          hasCompleteMetadata = true;
          break;
        }
      }
    }
    
    const noPublishAt = !jobsForRow.some(j => typeof j.publishAtUtcMs === 'number' && j.publishAtUtcMs > 0);
    
    if (hasCompleteMetadata && noPublishAt) {
      return 'ready';
    }
    
    // 6. Needs Action (lowest priority, catch-all)
    // - Missing metadata OR
    // - Missing exports OR
    // - File missing (warning)
    // Note: Missing targets is NOT a reason for Needs Action (targets can be set later)
    return 'needsAction';
  }, [getJobsForRow, getPlatformStatus]);

  // Get status message/tooltip for a row
  const getRowStatusMessage = React.useCallback((row: JobRow): string => {
    const status = getRowStatus(row);
    const jobsForRow = getJobsForRow(row);
    const platformSet = new Set<MetaPlatform>();
    for (const j of jobsForRow) {
      if (j.targets?.youtube || j.run?.youtube) platformSet.add('youtube');
      if (j.targets?.instagram || j.run?.instagram) platformSet.add('instagram');
      if (j.targets?.tiktok || j.run?.tiktok) platformSet.add('tiktok');
    }
    const hasTargets = platformSet.size > 0;
    
    // Check metadata completeness
    let hasCompleteMetadata = false;
    let missingMetadataPlatforms: MetaPlatform[] = [];
    const allPlatforms: MetaPlatform[] = ['youtube', 'instagram', 'tiktok'];
    for (const platform of allPlatforms) {
      const meta = row.meta?.byPlatform?.[platform];
      if (meta) {
        const hasTitle = Boolean(meta.title?.trim());
        const hasDescription = Boolean(meta.description?.trim());
        const hasHashtags = Boolean(
          (Array.isArray(meta.hashtags) && meta.hashtags.length > 0) ||
          (typeof meta.hashtags === 'string' && meta.hashtags.trim())
        );
        if (hasTitle && hasDescription && hasHashtags) {
          hasCompleteMetadata = true;
        } else {
          missingMetadataPlatforms.push(platform);
        }
      } else {
        missingMetadataPlatforms.push(platform);
      }
    }
    
    switch (status) {
      case 'failed':
        if (row.status === 'Error') {
          return t('pipelineFailedCheckLogs');
        }
        const failedPlatforms: MetaPlatform[] = [];
        if (platformSet.has('youtube')) {
          const ytStatus = getPlatformStatus(row, 'youtube');
          if (ytStatus.status === 'failed') failedPlatforms.push('youtube');
        }
        if (platformSet.has('instagram')) {
          const igStatus = getPlatformStatus(row, 'instagram');
          if (igStatus.status === 'failed') failedPlatforms.push('instagram');
        }
        if (platformSet.has('tiktok')) {
          const ttStatus = getPlatformStatus(row, 'tiktok');
          if (ttStatus.status === 'failed') failedPlatforms.push('tiktok');
        }
        return failedPlatforms.length > 0 
          ? t('uploadFailedFor', { platforms: failedPlatforms.map((p) => platformLabels[p]).join(', ') })
          : t('uploadFailedCheckLogs');
      
      case 'processing':
        if (row.status === 'Processing') {
          return t('pipelineRunning');
        }
        const processingPlatforms: MetaPlatform[] = [];
        if (platformSet.has('youtube')) {
          const ytStatus = getPlatformStatus(row, 'youtube');
          if (ytStatus.status === 'processing') processingPlatforms.push('youtube');
        }
        if (platformSet.has('instagram')) {
          const igStatus = getPlatformStatus(row, 'instagram');
          if (igStatus.status === 'processing') processingPlatforms.push('instagram');
        }
        if (platformSet.has('tiktok')) {
          const ttStatus = getPlatformStatus(row, 'tiktok');
          if (ttStatus.status === 'processing') processingPlatforms.push('tiktok');
        }
        return processingPlatforms.length > 0
          ? t('uploadInProgressFor', { platforms: processingPlatforms.map((p) => platformLabels[p]).join(', ') })
          : t('processingInProgress');
      
      case 'done':
        const donePlatforms: MetaPlatform[] = [];
        if (platformSet.has('youtube')) donePlatforms.push('youtube');
        if (platformSet.has('instagram')) donePlatforms.push('instagram');
        if (platformSet.has('tiktok')) donePlatforms.push('tiktok');
        return donePlatforms.length > 0
          ? t('postedOnPlatforms', { platforms: donePlatforms.map((p) => platformLabels[p]).join(', ') })
          : t('allTasksCompleted');
      
      case 'scheduled':
        {
          const jobsForRow = getJobsForRow(row);
          const publishTimes = jobsForRow
            .map((j) => j.publishAtUtcMs)
            .filter((t): t is number => typeof t === 'number' && t > 0);
          const publishTime = publishTimes.length > 0 ? Math.min(...publishTimes) : null;
          if (publishTime) {
            const date = new Date(publishTime);
            return t('scheduledForWithWait', { date: date.toLocaleString(i18n.language) });
          }
        }
        return t('scheduledForPublication');
      
      case 'ready':
        const messages: string[] = [];
        // Check which platforms have targets but missing metadata
        const platformsWithTargetButNoMetadata: MetaPlatform[] = [];
        if (platformSet.has('youtube')) {
          const ytMeta = row.meta?.byPlatform?.youtube;
          const hasYtTitle = Boolean(ytMeta?.title?.trim());
          const hasYtDesc = Boolean(ytMeta?.description?.trim());
          const hasYtTags = Boolean(
            (Array.isArray(ytMeta?.hashtags) && ytMeta.hashtags.length > 0) ||
            (typeof ytMeta?.hashtags === 'string' && ytMeta.hashtags.trim())
          );
          if (!hasYtTitle || !hasYtDesc || !hasYtTags) {
            platformsWithTargetButNoMetadata.push('youtube');
          }
        }
        if (platformSet.has('instagram')) {
          const igMeta = row.meta?.byPlatform?.instagram;
          const hasIgTitle = Boolean(igMeta?.title?.trim());
          const hasIgDesc = Boolean(igMeta?.description?.trim());
          const hasIgTags = Boolean(
            (Array.isArray(igMeta?.hashtags) && igMeta.hashtags.length > 0) ||
            (typeof igMeta?.hashtags === 'string' && igMeta.hashtags.trim())
          );
          if (!hasIgTitle || !hasIgDesc || !hasIgTags) {
            platformsWithTargetButNoMetadata.push('instagram');
          }
        }
        if (platformSet.has('tiktok')) {
          const ttMeta = row.meta?.byPlatform?.tiktok;
          const hasTtTitle = Boolean(ttMeta?.title?.trim());
          const hasTtDesc = Boolean(ttMeta?.description?.trim());
          const hasTtTags = Boolean(
            (Array.isArray(ttMeta?.hashtags) && ttMeta.hashtags.length > 0) ||
            (typeof ttMeta?.hashtags === 'string' && ttMeta.hashtags.trim())
          );
          if (!hasTtTitle || !hasTtDesc || !hasTtTags) {
            platformsWithTargetButNoMetadata.push('tiktok');
          }
        }
        
        if (hasCompleteMetadata) {
          messages.push(t('metadataCompleteReady'));
        }
        if (platformsWithTargetButNoMetadata.length > 0) {
          messages.push(t('missingMetadata', { platforms: platformsWithTargetButNoMetadata.map((p) => platformLabels[p]).join(', ') }));
        }
        if (!hasTargets) {
          messages.push(t('setTargetsToEnableUpload', { platforms: [platformLabels.youtube, platformLabels.instagram, platformLabels.tiktok].join('/') }));
        }
        return messages.length > 0 
          ? messages.join(' ')
          : t('readyForSchedulingOrUpload');
      
      case 'needsAction':
        const actionMessages: string[] = [];
        if (!hasCompleteMetadata) {
          if (missingMetadataPlatforms.length === 3) {
            actionMessages.push(t('missingMetadataGenerateFirst'));
          } else {
            actionMessages.push(t('missingMetadataFor', { platforms: missingMetadataPlatforms.map((p) => platformLabels[p]).join(', ') }));
          }
        }
        if (row.status === 'Error') {
          actionMessages.push(t('pipelineErrorCheckLogs'));
        }
        if (actionMessages.length === 0) {
          actionMessages.push(t('actionRequiredCheckFile'));
        }
        return actionMessages.join(' ');
      
      default:
        return t('unknownStatus');
    }
  }, [getRowStatus, getPlatformStatus, getJobsForRow, i18n.language, platformLabels, t]);

  // Helper function to highlight search text (highlights all occurrences)
  const highlightText = React.useCallback((text: string, query: string): React.ReactNode => {
    if (!query || !query.trim()) {
      return text;
    }
    
    const queryLower = query.toLowerCase().trim();
    const textLower = text.toLowerCase();
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let index = textLower.indexOf(queryLower, lastIndex);
    
    while (index !== -1) {
      // Add text before match
      if (index > lastIndex) {
        parts.push(text.substring(lastIndex, index));
      }
      
      // Add highlighted match
      parts.push(
        <span
          key={index}
          style={{
            backgroundColor: dark ? 'rgba(99, 102, 241, 0.4)' : 'rgba(79, 70, 229, 0.3)',
            fontWeight: 600,
            padding: '0 2px',
            borderRadius: '2px',
          }}
        >
          {text.substring(index, index + query.length)}
        </span>
      );
      
      lastIndex = index + query.length;
      index = textLower.indexOf(queryLower, lastIndex);
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    
    return parts.length > 0 ? <span>{parts}</span> : text;
  }, [dark]);

  // Helper function to remove posted status for a platform
  const removePostedStatusForPlatform = React.useCallback(async (row: JobRow, platform: 'youtube' | 'instagram' | 'tiktok') => {
    try {
      // Save to history before action
      await saveToHistory();
      
      // Load jobs and find the job for this file
      const current = await window.api?.jobsLoad?.();
      const jobs = Array.isArray(current) ? current : [];
      const rowKey = normalizeRowPrefsKey(row.filePath);
      const nameKey = normalizeFileNameKey(row.filePath);
      const jobsForRow = jobs.filter((j) => {
        if (normalizeRowPrefsKey(j.filePath) === rowKey) return true;
        return normalizeFileNameKey(j.filePath) === nameKey;
      });
      
      if (jobsForRow.length > 0) {
        let changed = false;
        for (const job of jobsForRow) {
          if (job.targets?.[platform]) {
            job.targets = { ...(job.targets || { youtube: false, instagram: false, tiktok: false }) };
            job.targets[platform] = false;
            if ('publishAtUtcMs' in job) {
              delete (job as any).publishAtUtcMs;
              changed = true;
            }
            changed = true;
          }
          if (!job.run || !job.run[platform]) continue;
          const platformRun = { ...job.run[platform] };
          delete platformRun.done;
          delete platformRun.at;
          delete platformRun.ok;
          delete platformRun.videoId;
          delete platformRun.error;
          if (Object.keys(platformRun).length === 0) {
            delete job.run[platform];
          } else {
            job.run[platform] = platformRun as any;
          }
          if (job.run && Object.keys(job.run).length === 0) {
            delete job.run;
          }
          changed = true;
        }

        if (changed) {
          await window.api?.jobsSave?.(jobs);
          setScheduledJobs(jobs);
        }

        // Clear upload status in UI for this platform optimistically
        updateRow(row.id, (r) => {
          const updatedUpload = { ...r.upload };
          if (updatedUpload[platform]) {
            const platformData = { ...updatedUpload[platform] };
            delete platformData.status;
            delete platformData.message;
            delete platformData.updatedAt;
            if (Object.keys(platformData).length === 0) {
              delete updatedUpload[platform];
            } else {
              updatedUpload[platform] = platformData;
            }
          }
          // Also disable target for this platform
          const updatedTargets = {
            ...(r.targets || { youtube: false, instagram: false, tiktok: false }),
            [platform]: false,
          };
          return {
            ...r,
            upload: updatedUpload,
            targets: updatedTargets,
          };
        });

        // Reload jobs to sync and wait for it to complete
        await loadJobs();

        setSnack(t('removedPostedStatusForPlatform', { platform: platformLabels[platform] }));
      } else {
        setSnack(t('jobNotFound'));
      }
    } catch (e) {
      console.error('Failed to remove posted plan:', e);
      setSnack(t('failedToRemovePostedPlan'));
    }
  }, [updateRow, setScheduledJobs, loadJobs, setSnack, saveToHistory, normalizeRowPrefsKey, normalizeFileNameKey, platformLabels, t]);

  const getPlatformStatusRef = React.useRef(getPlatformStatus);
  const getRowStatusRef = React.useRef(getRowStatus);

  React.useEffect(() => {
    getPlatformStatusRef.current = getPlatformStatus;
    getRowStatusRef.current = getRowStatus;
  }, [getPlatformStatus, getRowStatus]);

  // IMPORTANT: Use the live getPlatformStatus (not the ref) so DetailsPanel updates
  // in the same render when scheduledJobs changes (otherwise it's "one step behind").
  const selectedRowPlatformStatus = React.useMemo(() => {
    if (!selectedRow) return null;
    return {
      youtube: getPlatformStatus(selectedRow, 'youtube'),
      instagram: getPlatformStatus(selectedRow, 'instagram'),
      tiktok: getPlatformStatus(selectedRow, 'tiktok'),
    };
  }, [selectedRow, getPlatformStatus]);

  const colsPrevRef = React.useRef<GridColDef<JobRow>[] | null>(null);
  const cols = React.useMemo<GridColDef<JobRow>[]>(
    () => {
      // Apply saved column widths to column definitions
      // For platform columns (youtube, instagram, tiktok), use larger default width
      // to accommodate scheduled time display (e.g., "⏰ 15/12/2024, 14:30")
      const applyWidth = (field: string, defaultWidth: number): number => {
        // If there's a saved width, use it (user has manually resized)
        if (columnWidths[field] != null) {
          return columnWidths[field];
        }
        // Otherwise use the default width
        return defaultWidth;
      };
      
      return [
      {
        field: 'filename',
        headerName: t('filename'),
        flex: 1,
        minWidth: 260,
        renderHeader: () => {
          // Use a closure to capture current sortOrder value
          const currentSortOrder = sortOrder;
          return (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ width: '100%' }}>
              <Typography variant="subtitle2">{t('file')}</Typography>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  setSortOrder((prev) => prev === 'asc' ? 'desc' : 'asc');
                }}
                sx={{ p: 0.25, ml: 0.5, minWidth: 24, width: 24, height: 24 }}
                title={currentSortOrder === 'asc' ? t('sortAscending') : t('sortDescending')}
                data-testid="sort-creation-date"
              >
                <Typography variant="body2" sx={{ fontSize: 14, lineHeight: 1 }}>
                  {currentSortOrder === 'asc' ? '↑' : '↓'}
                </Typography>
              </IconButton>
              <Tooltip title={t('tooltipSort')}>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSortMenuAnchor(e.currentTarget);
                  }}
                  sx={{ ml: 'auto', p: 0.5 }}
                >
                  <Typography>⋯</Typography>
                </IconButton>
              </Tooltip>
            </Stack>
          );
        },
        renderCell: (params) => {
          return (
            <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {highlightText(params.row.filename, searchQuery)}
            </Typography>
          );
        },
      },
      {
        field: 'stage',
        headerName: t('stage'),
        width: applyWidth('stage', 180),
        minWidth: 120,
        maxWidth: 300,
        flex: 0,
        headerAlign: 'center',
        align: 'center',
        valueGetter: (_value, row) => {
          // Force recalculation by returning a value that changes when metadata changes
          const metaHash = JSON.stringify(row.meta?.byPlatform);
          const targetsHash = JSON.stringify(row.targets);
          return `${row.id}-${metaHash}-${targetsHash}`;
        },
        renderCell: (p) => {
          const row = p.row as JobRow;
          const rowStatus = getRowStatusRef.current(row);
          
          let stageLabel = t('imported');
          let stageColor: 'default' | 'info' | 'error' | 'success' | 'warning' = 'default';
          
          switch (rowStatus) {
            case 'failed':
              stageLabel = t('failed');
              stageColor = 'error';
              break;
            case 'processing':
              stageLabel = t('processing');
              stageColor = 'info';
              break;
            case 'done':
              stageLabel = t('done');
              stageColor = 'success';
              break;
            case 'scheduled':
              stageLabel = t('scheduled');
              stageColor = 'success';
              break;
            case 'ready':
              stageLabel = t('ready');
              stageColor = 'success';
              break;
            case 'needsAction':
              stageLabel = t('needsAction');
              stageColor = 'warning';
              break;
            default:
              stageLabel = t('imported');
              stageColor = 'default';
          }
          
          // Helper function to check if platform metadata is complete
          const hasPlatformMeta = (meta: any): boolean => {
            if (!meta) return false;
            const hasTitle = Boolean(meta.title?.trim());
            const hasDescription = Boolean(meta.description?.trim());
            const hasHashtags = Boolean(
              (Array.isArray(meta.hashtags) && meta.hashtags.length > 0) ||
              (typeof meta.hashtags === 'string' && meta.hashtags.trim())
            );
            return hasTitle && hasDescription && hasHashtags;
          };
          
          // Calculate indicator INDEPENDENT of status (but exclude "done" - already posted)
          // Rule: if metadata is missing/invalid → show 💡 (regardless of target)
          // Exception: Don't show indicator for "done" status (file is already posted)
          const targets = row.targets || { youtube: false, instagram: false, tiktok: false };
          let showIndicator = false;
          const platformsWithTargetButNoMetadata: string[] = [];
          const platformsWithoutMetadata: string[] = [];
          
          // Only check for indicator if status is NOT "done" (done means already posted)
          if (rowStatus !== 'done') {
            // Check YouTube - show indicator if metadata is missing, regardless of target
            const ytMeta = row.meta?.byPlatform?.youtube;
            if (!hasPlatformMeta(ytMeta)) {
              showIndicator = true;
              platformsWithoutMetadata.push(platformLabels.youtube);
              if (targets.youtube) {
                platformsWithTargetButNoMetadata.push(platformLabels.youtube);
              }
            }
            // Check Instagram
            const igMeta = row.meta?.byPlatform?.instagram;
            if (!hasPlatformMeta(igMeta)) {
              showIndicator = true;
              platformsWithoutMetadata.push(platformLabels.instagram);
              if (targets.instagram) {
                platformsWithTargetButNoMetadata.push(platformLabels.instagram);
              }
            }
            // Check TikTok
            const ttMeta = row.meta?.byPlatform?.tiktok;
            if (!hasPlatformMeta(ttMeta)) {
              showIndicator = true;
              platformsWithoutMetadata.push(platformLabels.tiktok);
              if (targets.tiktok) {
                platformsWithTargetButNoMetadata.push(platformLabels.tiktok);
              }
            }
          }
          
          // Build status message with indicator info
          let statusMessage = getRowStatusMessage(row);
          // Add indicator info to message if any platforms are missing metadata
          if (platformsWithoutMetadata.length > 0) {
            const messages: string[] = [];
            // Add base status message
            messages.push(statusMessage);
            // Add indicator info - show all platforms without metadata
            if (platformsWithTargetButNoMetadata.length > 0) {
              // If some platforms have targets but no metadata, highlight those
              messages.push(t('missingMetadataTargetSet', { platforms: platformsWithTargetButNoMetadata.join(', ') }));
              const withoutTargets = platformsWithoutMetadata.filter(p => !platformsWithTargetButNoMetadata.includes(p));
              if (withoutTargets.length > 0) {
                messages.push(t('missingMetadata', { platforms: withoutTargets.join(', ') }));
              }
            } else {
              // All platforms without metadata don't have targets set
              messages.push(t('missingMetadata', { platforms: platformsWithoutMetadata.join(', ') }));
            }
            statusMessage = messages.join(' ');
          }
          
          // Create a unique key based on metadata and targets to force re-render
          const chipKey = `stage-${row.id}-${JSON.stringify(row.meta?.byPlatform)}-${targets.youtube}-${targets.instagram}-${targets.tiktok}-${rowStatus}`;
          const indicatorKey = `indicator-${chipKey}`;
          
          // ELIMINAT: Debug logging care genera spam în consolă
          // Nu mai logăm informații despre indicator pentru fiecare rând
          // Codul de logging a fost eliminat complet pentru a reduce spam-ul în consolă
          
          return (
            <Tooltip key={`tooltip-${chipKey}`} title={statusMessage}>
              <Stack 
                direction="row" 
                spacing={0.5} 
                alignItems="center"
                key={`stack-${chipKey}`}
                sx={{ display: 'inline-flex' }}
              >
                <Chip 
                  key={chipKey}
                  size="small" 
                  label={stageLabel} 
                  color={stageColor} 
                />
                {showIndicator && (
                  <Typography 
                    key={indicatorKey}
                    component="span"
                    sx={{ 
                      fontSize: '16px',
                      lineHeight: 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                    }}
                    title={t('missingMetadataFor', {
                      platforms: (platformsWithTargetButNoMetadata.length > 0 ? platformsWithTargetButNoMetadata : platformsWithoutMetadata).join(', '),
                    })}
                  >
                    💡
                  </Typography>
                )}
              </Stack>
            </Tooltip>
          );
        },
      },
      {
        field: 'visibility',
        headerName: t('visibility'),
        width: applyWidth('visibility', 120),
        minWidth: 100,
        maxWidth: 200,
        flex: 0,
        sortable: false,
        headerAlign: 'center',
        align: 'center',
        renderCell: (p) => {
          const row = p.row as JobRow;
          return (
            <VisibilityCell
              value={row.visibility}
              onChange={(next) => {
                void updateVisibilityForRow(row, next);
              }}
            />
          );
        },
      },
      {
        field: 'selfDeclaredMadeForKids',
        headerName: t('mfk'),
        width: applyWidth('selfDeclaredMadeForKids', 80),
        minWidth: 70,
        maxWidth: 100,
        flex: 0,
        sortable: false,
        headerAlign: 'center',
        align: 'center',
        renderHeader: () => (
          <Tooltip title={t('madeForKids')}>
            <Box component="span">{t('mfk')}</Box>
          </Tooltip>
        ),
        renderCell: (p) => {
          const row = p.row as JobRow;
          return (
            <MadeForKidsCell
              value={Boolean(row.selfDeclaredMadeForKids)}
              labels={{ yes: t('yes'), no: t('no') }}
              tooltipLabel={t('madeForKids')}
              onChange={(next) => {
                void updateSelfDeclaredMadeForKidsForRow(row, next);
              }}
            />
          );
        },
      },
      {
        field: 'youtube',
        headerName: platformLabels.youtube,
        width: applyWidth('youtube', 170),
        minWidth: 170,
        maxWidth: 300,
        flex: 0,
        sortable: false,
        headerAlign: 'center',
        align: 'center',
        renderCell: (params) => {
          const row = params.row;
          const platformStatus = getPlatformStatusRef.current(row, 'youtube');
          
          if (platformStatus.status === 'none') {
            return (
              <Button
                size="small"
                variant="outlined"
                disabled={!planAccess.isActive}
                onClick={(e) => {
                  e.stopPropagation();
                  openScheduleDialog(params.row, 'youtube');
                }}
                onContextMenu={(e) => {
                  e.stopPropagation();
                  handleContextMenu(e, params.row.id, 'youtube');
                }}
                sx={{ width: 'fit-content', minWidth: 170 }}
              >
                {t('schedule')}
              </Button>
            );
          }
          
          const getButtonLabel = () => {
            if (platformStatus.status === 'done') return `✓ ${t('posted')}`;
            if (platformStatus.status === 'failed') return `✗ ${t('failed')}`;
            if (platformStatus.status === 'processing') return `⏳ ${t('uploading')}`;
            if (platformStatus.status === 'scheduled') {
              const time = platformStatus.scheduledTime ? formatForGrid(platformStatus.scheduledTime, 'schedule', getIanaTimeZone(timeZoneId)) : '';
              return `⏰ ${time}`;
            }
            // Due = past scheduled time; show time so grid matches Row Details / Assist Center
            if (platformStatus.status === 'ready' && platformStatus.scheduledTime != null) {
              const time = formatForGrid(platformStatus.scheduledTime, 'schedule', getIanaTimeZone(timeZoneId));
              return `⏰ ${time}`;
            }
            return t('schedule');
          };

          const getButtonColor = () => {
            if (platformStatus.status === 'done') return 'success';
            if (platformStatus.status === 'failed') return 'error';
            if (platformStatus.status === 'processing') return 'warning';
            if (platformStatus.status === 'scheduled' || (platformStatus.status === 'ready' && platformStatus.scheduledTime != null)) return 'info';
            return 'primary';
          };

          return (
            <Box
              sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Button
                size="small"
                variant="outlined"
                color={getButtonColor() as any}
                disabled={platformStatus.status === 'processing' || (!planAccess.isActive && platformStatus.status !== 'done')}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (platformStatus.status === 'done') {
                    // Reset posted status
                    await removePostedStatusForPlatform(params.row, 'youtube');
                  } else {
                    openScheduleDialog(params.row, 'youtube');
                  }
                }}
                onContextMenu={(e) => {
                  e.stopPropagation();
                  handleContextMenu(e, params.row.id, 'youtube');
                }}
                sx={{ width: 'fit-content', minWidth: 170 }}
              >
                {getButtonLabel()}
              </Button>
            </Box>
          );
        },
      },
      {
        field: 'instagram',
        headerName: platformLabels.instagram,
        width: applyWidth('instagram', 170),
        minWidth: 170,
        maxWidth: 300,
        flex: 0,
        sortable: false,
        headerAlign: 'center',
        align: 'center',
        renderCell: (params) => {
          const row = params.row;
          const platformStatus = getPlatformStatusRef.current(row, 'instagram');
          
          if (platformStatus.status === 'none') {
            return (
              <Button
                size="small"
                variant="outlined"
                disabled={!planAccess.isActive}
                onClick={(e) => {
                  e.stopPropagation();
                  openScheduleDialog(params.row, 'instagram');
                }}
                onContextMenu={(e) => {
                  e.stopPropagation();
                  handleContextMenu(e, params.row.id, 'instagram');
                }}
                sx={{ width: 'fit-content', minWidth: 170 }}
              >
                {t('schedule')}
              </Button>
            );
          }
          
          const getButtonLabel = () => {
            if (platformStatus.status === 'done') return `✓ ${t('posted')}`;
            if (platformStatus.status === 'failed') return `✗ ${t('failed')}`;
            if (platformStatus.status === 'processing') return `⏳ ${t('processing')}`;
            if (platformStatus.status === 'scheduled') {
              const time = platformStatus.scheduledTime ? formatForGrid(platformStatus.scheduledTime, 'schedule', getIanaTimeZone(timeZoneId)) : '';
              return `⏰ ${time}`;
            }
            if (platformStatus.status === 'ready' && platformStatus.scheduledTime != null) {
              const time = formatForGrid(platformStatus.scheduledTime, 'schedule', getIanaTimeZone(timeZoneId));
              return `⏰ ${time}`;
            }
            return t('schedule');
          };

          const getButtonColor = () => {
            if (platformStatus.status === 'done') return 'success';
            if (platformStatus.status === 'failed') return 'error';
            if (platformStatus.status === 'processing') return 'warning';
            if (platformStatus.status === 'scheduled' || (platformStatus.status === 'ready' && platformStatus.scheduledTime != null)) return 'info';
            return 'primary';
          };

          return (
            <Box
              sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Button
                size="small"
                variant="outlined"
                color={getButtonColor() as any}
                disabled={platformStatus.status === 'processing' || (!planAccess.isActive && platformStatus.status !== 'done')}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (platformStatus.status === 'done') {
                    // Reset posted status
                    await removePostedStatusForPlatform(params.row, 'instagram');
                  } else {
                    openScheduleDialog(params.row, 'instagram');
                  }
                }}
                onContextMenu={(e) => {
                  e.stopPropagation();
                  handleContextMenu(e, params.row.id, 'instagram');
                }}
                sx={{ width: 'fit-content', minWidth: 170 }}
              >
                {getButtonLabel()}
              </Button>
            </Box>
          );
        },
      },
      {
        field: 'tiktok',
        headerName: platformLabels.tiktok,
        width: applyWidth('tiktok', 170),
        minWidth: 170,
        maxWidth: 300,
        flex: 0,
        sortable: false,
        headerAlign: 'center',
        align: 'center',
        renderCell: (params) => {
          const row = params.row;
          const platformStatus = getPlatformStatusRef.current(row, 'tiktok');
          
          if (platformStatus.status === 'none') {
            return (
              <Button
                size="small"
                variant="outlined"
                disabled={!planAccess.isActive}
                onClick={(e) => {
                  e.stopPropagation();
                  openScheduleDialog(params.row, 'tiktok');
                }}
                onContextMenu={(e) => {
                  e.stopPropagation();
                  handleContextMenu(e, params.row.id, 'tiktok');
                }}
                sx={{ width: 'fit-content', minWidth: 170 }}
              >
                {t('schedule')}
              </Button>
            );
          }
          
          const getButtonLabel = () => {
            if (platformStatus.status === 'done') return `✓ ${t('posted')}`;
            if (platformStatus.status === 'failed') return `✗ ${t('failed')}`;
            if (platformStatus.status === 'processing') return `⏳ ${t('processing')}`;
            if (platformStatus.status === 'scheduled') {
              const time = platformStatus.scheduledTime ? formatForGrid(platformStatus.scheduledTime, 'schedule', getIanaTimeZone(timeZoneId)) : '';
              return `⏰ ${time}`;
            }
            if (platformStatus.status === 'ready' && platformStatus.scheduledTime != null) {
              const time = formatForGrid(platformStatus.scheduledTime, 'schedule', getIanaTimeZone(timeZoneId));
              return `⏰ ${time}`;
            }
            return t('schedule');
          };

          const getButtonColor = () => {
            if (platformStatus.status === 'done') return 'success';
            if (platformStatus.status === 'failed') return 'error';
            if (platformStatus.status === 'processing') return 'warning';
            if (platformStatus.status === 'scheduled' || (platformStatus.status === 'ready' && platformStatus.scheduledTime != null)) return 'info';
            return 'primary';
          };

          return (
            <Box
              sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Button
                size="small"
                variant="outlined"
                color={getButtonColor() as any}
                disabled={platformStatus.status === 'processing' || (!planAccess.isActive && platformStatus.status !== 'done')}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (platformStatus.status === 'done') {
                    // Reset posted status
                    await removePostedStatusForPlatform(params.row, 'tiktok');
                  } else {
                    openScheduleDialog(params.row, 'tiktok');
                  }
                }}
                onContextMenu={(e) => {
                  e.stopPropagation();
                  handleContextMenu(e, params.row.id, 'tiktok');
                }}
                sx={{ width: 'fit-content', minWidth: 170 }}
              >
                {getButtonLabel()}
              </Button>
            </Box>
          );
        },
      },
    ];
    },
    // Minimize dependencies to prevent column recreation which resets column widths
    // Functions (getPlatformStatus, getRowStatus, etc.) are used in callbacks that receive params at runtime
    // They don't need to be in dependencies - React will use the latest version via closure
    // Only include values that affect column structure (not content rendering)
    // Include columnWidths to apply saved widths
    // Include jobsLoadedVersion so grid re-renders when jobs are (re)loaded (e.g. after reopen from tray)
    [timeZoneId, systemTz, t, sortOrder, searchQuery, dark, columnWidths, jobsLoadedVersion, planAccess.isActive],
  );
  
  // Track columns reference to detect recreation (for debugging if needed)
  React.useEffect(() => {
    colsPrevRef.current = cols;
  }, [cols]);

  function applyAutoSchedule(toAssign: JobRow[], existing: JobRow[]) {
    // Assign publish slots sequentially, WITHOUT touching manual rows.
    // Keeps scheduling strictly in the selected time zone (YouTube-like).
    const requestedPerDay = Math.max(1, Number.isFinite(videosPerDay) ? videosPerDay : 1);
    const perDay = Math.max(1, Math.min(requestedPerDay, slotsMinutes.length || 1));
    const daySlots = slotsMinutes.slice(0, perDay);

    if (requestedPerDay > daySlots.length) {
      // Non-blocking hint for users: they asked for more videos/day than there are time slots.
      // We schedule up to the number of slots provided.
      console.warn(`[schedule] videos/day (${requestedPerDay}) > provided times (${daySlots.length}); using ${daySlots.length}/day`);
    }

    // Collision-free scheduling:
    // - We do NOT jump to the latest existing item (which could be a far-future manual date).
    // - Instead, we find the earliest available future slots starting from "now",
    //   and skip any slots already occupied by manual/previous schedules.
    const minuteKey = (ms: number) => Math.floor(ms / 60_000);

    const occupied = new Set<number>();
    for (const r of existing) {
      if (r.publishMode !== 'schedule') continue;
      if (typeof r.publishAt !== 'number') continue;
      occupied.add(minuteKey(r.publishAt));
    }

    // Use schedule start date if provided, otherwise use current time
    let cursor = Date.now();
    if (scheduleStartDate) {
      // Parse the date string (YYYY-MM-DD) and set time to first slot time in the selected timezone
      const dateParts = scheduleStartDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateParts) {
        const year = Number(dateParts[1]);
        const month = Number(dateParts[2]);
        const day = Number(dateParts[3]);
        // Get the first slot time for the start date
        const firstSlot = daySlots[0] ?? 9 * 60; // Default to 09:00 if no slots
        const hour = Math.floor(firstSlot / 60);
        const minute = firstSlot % 60;
        // Convert to UTC epoch using the timezone
        const startEpoch = zonedComponentsToUtcEpoch({ year, month, day, hour, minute }, getIanaTimeZone(timeZoneId));
        if (startEpoch != null) {
          // Use start date even if it's in the past (user might want to schedule from a specific date)
          cursor = startEpoch;
        }
      }
    }
    const assigned: JobRow[] = [];

    for (const r of toAssign) {
      // Find next slot that is not occupied.
      let guard = 0;
      let next = nextSlotAfter(cursor - 1, getIanaTimeZone(timeZoneId), daySlots);
      while (next != null && occupied.has(minuteKey(next))) {
        // Move cursor just after the occupied slot and try again.
        cursor = next + 60_000;
        next = nextSlotAfter(cursor - 1, getIanaTimeZone(timeZoneId), daySlots);
        guard += 1;
        if (guard > 10_000) {
          console.warn('[schedule] too many occupied slots; aborting search');
          next = null;
          break;
        }
      }

      if (next != null) {
        occupied.add(minuteKey(next));
        cursor = next + 60_000;
        
        // Only add job if we found a valid slot
        assigned.push({
          ...r,
          publishMode: 'schedule',
          publishAt: next,
          publishSource: 'auto',
        });
      } else {
        // If no slot found (e.g., too many occupied slots), skip this job
        console.warn(`[schedule] Could not find available slot for ${r.filename || r.filePath}`);
      }
    }

    return assigned;
  }

  const addFilePaths = async (files: string[]) => {
    let cleaned = (files ?? []).filter(Boolean);
    if (!cleaned.length) return;
    
    // Save to history before adding files (including rows since we're adding new rows)
    await saveToHistory(true);

    // Get file stats (creation dates) for all files
    const fileStats = await Promise.all(
      cleaned.map(async (fp) => {
        try {
          const stats = await window.api?.getFileStats?.(fp);
          const birth = stats?.ok && typeof stats.birthtimeMs === 'number' && Number.isFinite(stats.birthtimeMs) ? stats.birthtimeMs : null;
          const mtime =
            stats?.ok && typeof (stats as any).mtimeMs === 'number' && Number.isFinite((stats as any).mtimeMs) ? (stats as any).mtimeMs : null;

          // If the FS doesn't provide a real birth time, we still keep createdAt usable by falling back to mtime.
          const createdAt = birth ?? mtime ?? Date.now();
          const modifiedAt = mtime ?? createdAt;
          return { path: fp, createdAt, modifiedAt };
        } catch (e) {
          // If getFileStats fails, try to use file system directly or fallback to current time
          console.warn(`Failed to get stats for ${fp}:`, e);
          const now = Date.now();
          return { path: fp, createdAt: now, modifiedAt: now };
        }
      }),
    );
    
    // Debug: verify all files got stats
    if (fileStats.length !== cleaned.length) {
      console.warn(`[addFilePaths] Mismatch: ${cleaned.length} files but ${fileStats.length} stats`);
    }

    // Normalize incoming order for multi-file imports based on the existing File sort menu
    // (the ⋯ menu next to the File column): Added order / Name / Creation date.
    if (cleaned.length > 1) {
      const statsByLower = new Map<string, { createdAt: number; modifiedAt: number }>();
      for (const s of fileStats) statsByLower.set(String(s.path).toLowerCase(), { createdAt: s.createdAt, modifiedAt: s.modifiedAt });

      const entries = cleaned.map((p, idx) => {
        const st = statsByLower.get(String(p).toLowerCase());
        return {
          p,
          idx,
          createdAt: st?.createdAt ?? 0,
          modifiedAt: st?.modifiedAt ?? 0,
          name: baseName(p).toLowerCase(),
        };
      });

      const nameCmp = (a: typeof entries[number], b: typeof entries[number]) => {
        const primary = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        if (primary !== 0) return primary;
        return a.p.toLowerCase().localeCompare(b.p.toLowerCase());
      };

      if (sortBy === 'name') {
        entries.sort((a, b) => nameCmp(a, b) || a.idx - b.idx);
      } else if (sortBy === 'date') {
        entries.sort((a, b) => (a.createdAt - b.createdAt) || nameCmp(a, b) || a.idx - b.idx);
      } else {
        // sortBy === 'added' => keep incoming order
      }

      cleaned = entries.map((e) => e.p);
    }

    const statsByPath = new Map<string, { createdAt: number; modifiedAt: number }>();
    for (const s of fileStats) statsByPath.set(String(s.path), { createdAt: s.createdAt, modifiedAt: s.modifiedAt });

    // Process files in order and prepare new rows
    const newRows: JobRow[] = [];
    const seen = new Set<string>();
    
    // Add new files - use updateRows to maintain referential stability
    updateRows((prev) => {
      const existingSeen = new Set(Array.from(prev.values()).map((r) => r.filePath.toLowerCase()));
      
      // Also check scheduledJobs to avoid adding files that have jobs but no rows
      // (e.g., after row disappeared due to target deselection but job still exists)
      const jobsFilePaths = new Set(scheduledJobs.map((j: any) => (j.filePath || '').toLowerCase()));
      const allExistingPaths = new Set([...existingSeen, ...jobsFilePaths]);
      
      const next = new Map(prev);

      // Get the latest addedAt to ensure new files are added after existing ones
      const baseTime = Date.now();
      const existingMaxAddedAt = prev.size > 0 
        ? Math.max(...Array.from(prev.values()).map((r) => r.addedAt || 0))
        : 0;
      const startAddedAt = Math.max(baseTime, existingMaxAddedAt) + 1;

      // Determine which files are actually new (preserve incoming order).
      let skippedCount = 0;
      const toAdd: string[] = [];
      for (const fp of cleaned) {
        const key = fp.toLowerCase();
        if (allExistingPaths.has(key) || seen.has(key)) {
          skippedCount++;
          continue;
        }
        seen.add(key);
        toAdd.push(fp);
      }

      // Preserve "added order" even when user has sortOrder === 'desc'.
      // - For asc: earliest addedAt first (normal incremental).
      // - For desc: earliest file in the batch should still appear first within that batch,
      //   so we assign addedAt in descending order inside the batch.
      const step = 100; // keep gaps to avoid ties/collisions
      const batchBase = startAddedAt + Math.max(0, toAdd.length - 1) * step;

      let index = 0;
      for (const fp of toAdd) {
        const stats = statsByPath.get(fp);
        const addedAt = sortOrder === 'desc' ? batchBase - index * step : startAddedAt + index * step;
        // Generate id with timestamp prefix to help with sorting if addedAt is missing
        const idWithTimestamp = `${addedAt}-${newId()}`;
        // Set default targets: YouTube=true if autoEnabled is true
        // autoEnabled = auto-schedule (planning) - controls both scheduling and default targets
        // autoUploadEnabled = auto-upload (processing) - controls backend processing
        // Using autoEnabled for targets ensures consistency: if video is auto-scheduled, it should have targets
        // User can still manually change targets later if needed
        const defaultTargets = (() => {
          if (!autoEnabled) return { youtube: false, instagram: false, tiktok: false };
          // When Auto Plan is ON, use the last Plan "Apply to" scope as the default target.
          if (autoPlanApplyTo === 'youtube') return { youtube: true, instagram: false, tiktok: false };
          if (autoPlanApplyTo === 'instagram') return { youtube: false, instagram: true, tiktok: false };
          if (autoPlanApplyTo === 'tiktok') return { youtube: false, instagram: false, tiktok: true };
          // 'all' = safe default: YouTube only (doesn't unexpectedly enable all platforms).
          return { youtube: true, instagram: false, tiktok: false };
        })();

        const prefKey = normalizeRowPrefsKey(fp);
        const pref = rowPrefsRef.current[prefKey];
        // When auto-plan is OFF, don't auto-apply stored target prefs on import.
        // This prevents new imports from unexpectedly enabling platforms.
        const initialTargets = autoEnabled ? (pref?.targets ?? defaultTargets) : defaultTargets;
        const initialVisibility = pref?.visibility ?? 'private';
        const initialMadeForKids = pref?.selfDeclaredMadeForKids ?? false;
        
        const newRow: JobRow = {
          id: idWithTimestamp,
          filePath: fp,
          filename: baseName(fp),
          status: 'Ready',
          visibility: initialVisibility,
          selfDeclaredMadeForKids: initialMadeForKids,
          publishMode: autoEnabled ? 'schedule' : 'now',
          publishAt: null,
          publishSource: autoEnabled ? 'auto' : 'manual',
          log: '',
          createdAt: stats?.createdAt || Date.now(),
          addedAt: addedAt, // Timestamp when added to list (incremental to preserve order)
          targets: initialTargets,
        };
        newRows.push(newRow);
        next.set(newRow.id, newRow);
        index++;
      }
      
      // Initialize logs for new rows (if any)
      if (newRows.length > 0) {
        setLogsById((prevLogs) => {
          const nextLogs = new Map(prevLogs);
          for (const row of newRows) {
            if (row.log) {
              nextLogs.set(row.id, row.log);
            }
          }
          return nextLogs.size > 0 ? nextLogs : prevLogs;
        });
      }
      
      // Debug: log how many rows were added
      if (newRows.length !== cleaned.length - skippedCount) {
        console.warn(`[addFilePaths] Expected ${cleaned.length - skippedCount} new rows but got ${newRows.length}`);
      }

      // Auto-apply schedule for new videos if autoEnabled is true
      // This ensures new videos get scheduled immediately when added
      if (autoEnabled && newRows.length > 0) {
        const existingScheduled = Array.from(next.values()).filter((r) => r.publishMode === 'schedule' && typeof r.publishAt === 'number');
        const toAssign = newRows.filter((r) => r.publishSource === 'auto' && (r.publishMode !== 'schedule' || !r.publishAt));
        if (toAssign.length > 0) {
          const assigned = applyAutoSchedule(toAssign, existingScheduled);
          const byId = new Map(assigned.map((a) => [a.id, a]));
          // Update rows with assigned schedule
          for (const [id, assignedRow] of byId.entries()) {
            next.set(id, assignedRow);
          }
        }
      }

      return next;
    });
    
    // Force autosize after files are added by incrementing datasetRevision
    // This ensures columns autosize immediately when new files are imported
    // Use multiple timeouts to ensure rows are fully rendered and measured
    if (newRows.length > 0) {
      // First increment immediately to trigger the effect
      setDatasetRevision((prev) => prev + 1);
      
      // Also trigger again after a delay to ensure DOM is fully ready
      setTimeout(() => {
        setDatasetRevision((prev) => prev + 1);
      }, 800);
    }

    // After adding files, check if there are jobs without rows and create rows for them
    // This handles the case where a row disappeared (e.g., after target deselection) but job still exists
    if (scheduledJobs.length > 0) {
      // Add rows from jobs without rows - use updateRows to maintain referential stability
      updateRows((prev) => {
        const existingFilePaths = new Set(Array.from(prev.values()).map(r => r.filePath.toLowerCase()));
        const jobsWithoutRows: ScheduledJob[] = [];
        
        for (const job of scheduledJobs) {
          const filePathLower = (job.filePath || '').toLowerCase();
          if (filePathLower && !existingFilePaths.has(filePathLower)) {
            jobsWithoutRows.push(job);
          }
        }
        
        if (jobsWithoutRows.length === 0) return prev;
        
        // Group jobs by filePath
        const byFile = new Map<string, ScheduledJob[]>();
        for (const job of jobsWithoutRows) {
          const k = String(job.filePath || '').toLowerCase();
          if (!k) continue;
          const arr = byFile.get(k) ?? [];
          arr.push(job);
          byFile.set(k, arr);
        }
        
        const newRowsFromJobs: JobRow[] = [];
        for (const [, jobsForFile] of byFile.entries()) {
          const filePath = jobsForFile[0]?.filePath;
          if (!filePath) continue;
          
          const mergedTargets = { youtube: false, instagram: false, tiktok: false };
          let mergedMadeForKids = false;
          let earliestPublishAt: number | null = null;
          let visibility: any = 'private';
          let createdAt = Date.now();
          for (const j of jobsForFile) {
            if (j.targets?.youtube) mergedTargets.youtube = true;
            if (j.targets?.instagram) mergedTargets.instagram = true;
            if (j.targets?.tiktok) mergedTargets.tiktok = true;
            if (j.selfDeclaredMadeForKids === true) mergedMadeForKids = true;
            const ms = Number(j.publishAtUtcMs);
            if (Number.isFinite(ms)) {
              earliestPublishAt = earliestPublishAt == null ? ms : Math.min(earliestPublishAt, ms);
            }
            if (j.visibility) visibility = j.visibility;
            if (j.createdAt) createdAt = Math.min(createdAt, j.createdAt);
          }
          
          const newRow: JobRow = {
            id: jobsForFile[0]?.id || newId(),
            filePath,
            filename: baseName(filePath),
            status: 'Ready',
            visibility,
            selfDeclaredMadeForKids: mergedMadeForKids,
            publishMode: earliestPublishAt ? 'schedule' as const : 'now' as const,
            publishAt: earliestPublishAt,
            publishSource: 'manual',
            log: '',
            createdAt,
            addedAt: createdAt,
            targets: mergedTargets,
          };
          newRowsFromJobs.push(newRow);
        }
        
        if (newRowsFromJobs.length > 0) {
          const next = new Map(prev);
          for (const row of newRowsFromJobs) {
            next.set(row.id, row);
          }
          return next;
        }
        return prev;
      });
    }

    // If Auto Plan is ON, new rows are auto-scheduled. Make sure they also create scheduledJobs
    // (source-of-truth for persistence + auto-upload) for their active target platforms.
    if (autoEnabled && newRows.length > 0) {
      const addedPaths = new Set(newRows.map((r) => r.filePath.toLowerCase()));

      // Poll briefly until rowsRef sees the updated publishAt values (setRows is async).
      setTimeout(() => {
        (async () => {
          const deadline = Date.now() + 2_000;
          let latest: JobRow[] = [];

          while (Date.now() < deadline) {
            latest = rowsRef.current.filter((r) => addedPaths.has(r.filePath.toLowerCase()));
            // Wait until we see at least the rows we added and their schedule has been assigned.
            if (
              latest.length >= newRows.length &&
              latest.every((r) => r.publishMode === 'schedule' && typeof r.publishAt === 'number' && r.publishAt > 0)
            ) {
              break;
            }
            await new Promise((res) => setTimeout(res, 50));
          }

          if (latest.length === 0) return;

          const platforms: MetaPlatform[] = ['youtube', 'instagram', 'tiktok'];
          const now = Date.now();

          const jobsToAdd: ScheduledJob[] = [];
          for (const row of latest) {
            if (row.publishMode !== 'schedule') continue;
            if (typeof row.publishAt !== 'number' || row.publishAt <= 0) continue;
            if (!row.targets) continue;

            for (const platform of platforms) {
              if (!row.targets[platform]) continue;
              jobsToAdd.push({
                id: newId(),
                filePath: row.filePath,
                publishAtUtcMs: row.publishAt,
                // Per-platform job: only one target true.
                targets: {
                  youtube: platform === 'youtube',
                  instagram: platform === 'instagram',
                  tiktok: platform === 'tiktok',
                },
                visibility: row.visibility,
                selfDeclaredMadeForKids: row.selfDeclaredMadeForKids ?? false,
                createdAt: now,
              });
            }
          }

          if (jobsToAdd.length === 0) return;

          setScheduledJobs((prev) => {
            const existingKeys = new Set(
              prev.map((j) => {
                const p: MetaPlatform | 'unknown' =
                  j.targets?.youtube ? 'youtube' : j.targets?.instagram ? 'instagram' : j.targets?.tiktok ? 'tiktok' : 'unknown';
                return `${j.filePath.toLowerCase()}|${p}|${j.publishAtUtcMs}`;
              }),
            );

            const next = [...prev];
            for (const j of jobsToAdd) {
              const p: MetaPlatform | 'unknown' =
                j.targets.youtube ? 'youtube' : j.targets.instagram ? 'instagram' : j.targets.tiktok ? 'tiktok' : 'unknown';
              const key = `${j.filePath.toLowerCase()}|${p}|${j.publishAtUtcMs}`;
              if (existingKeys.has(key)) continue;
              existingKeys.add(key);
              next.push(j);
            }
            return next;
          });
        })().catch(() => {});
      }, 150);
    }
    
    // Reset filter to 'all' when new files are added to ensure they are visible
    if (newRows.length > 0 && filter !== 'all') {
      setFilter('all');
    }

    // Check for existing metadata for newly added files and update their status
    // Do this after state update to avoid race conditions
    // Note: setTimeout runs quickly (100ms), so cleanup is not critical, but in production
    // you might want to use a ref to track and cleanup on unmount
    setTimeout(async () => {
      for (const newRow of newRows) {
        try {
          const res = await window.api?.readOutputsForPath?.(newRow.filePath);
          if (res?.ok) {
            const metaPlatforms = (res?.metadata?.platforms ?? {}) as any;
            const hasMetadata = Boolean(
              metaPlatforms?.youtube?.title ||
              metaPlatforms?.instagram?.title ||
              metaPlatforms?.tiktok?.title ||
              (res as any)?.exports?.youtube?.title ||
              (res as any)?.exports?.instagram?.title ||
              (res as any)?.exports?.tiktok?.title
            );

            if (hasMetadata) {
              // Build metadata structure same as refreshOutputsForPath
              const build = (p: MetaPlatform) => {
                const exp = (res as any)?.exports?.[p];
                const mp = metaPlatforms?.[p];
                const pickString = (...args: (string | undefined | null)[]): string | undefined => {
                  for (const arg of args) {
                    if (arg && typeof arg === 'string' && arg.trim()) return arg.trim();
                  }
                  return undefined;
                };
                const title = pickString(exp?.title, mp?.title);
                const description = pickString(exp?.description, mp?.description);
                const hashtags = pickString(
                  normalizeHashtagsValue(exp?.hashtags),
                  normalizeHashtagsValue(mp?.hashtags),
                );
                const hasExports = !!pickString(exp?.title, exp?.description, exp?.hashtags);
                const hasMeta = !!pickString(mp?.title, mp?.description, normalizeHashtagsValue(mp?.hashtags));
                const source: MetaSource = hasExports ? 'exports' : hasMeta ? 'metadata' : 'none';
                return { title, description, hashtags, source, dir: exp?.dir } as const;
              };

              const byPlatform: Partial<Record<MetaPlatform, any>> = {
                youtube: build('youtube'),
                instagram: build('instagram'),
                tiktok: build('tiktok'),
              };

              // File already has metadata - set status to Done, load metadata, and mark as planned
              // Update row with metadata - use updateRow to maintain referential stability
              updateRow(newRow.id, (r) => ({
                ...r,
                status: 'Done' as const,
                publishMode: 'schedule' as const,
                publishSource: 'auto' as const,
                meta: {
                  byPlatform,
                  raw: res?.metadata ?? null,
                },
              }));
            }
          }
        } catch (e) {
          // Ignore errors when checking for metadata
          console.warn('Failed to check metadata for', newRow.filePath, e);
        }
      }
    }, 100);
  };

const addByFiles = async () => {
  try {
    if (!window.api?.openFiles) return;
    const files = await window.api.openFiles();
    console.log(`[addByFiles] Received ${files?.length || 0} files from openFiles()`);
    await addFilePaths(files || []);
  } catch (e) {
    console.error('[addByFiles] Error:', e);
  } finally {
    setAddDialogOpen(false);
  }
};

const addByFolder = async () => {
  try {
    if (!window.api?.openFolder) return;
    const folder = await window.api.openFolder();
    if (!folder) return;

    // Scan folder in main process (fast + avoids renderer fs perms)
    const files =
      window.api?.scanVideos ? await window.api.scanVideos(folder) : [];

    await addFilePaths(files || []);
  } catch (e) {
    console.error(e);
  } finally {
    setAddDialogOpen(false);
  }
};

  // Drag & Drop handlers
  const handleDragEnter = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only hide if we're leaving the main container
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = React.useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      // Internal row reorder drag: do not treat as file drop.
      try {
        const types = Array.from(e.dataTransfer.types || []);
        if (types.includes('application/x-cu-row-reorder')) return;
      } catch {
        // ignore
      }

      const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v'];
      const hasVideoExt = (p: string) => {
        const dot = p.lastIndexOf('.');
        const ext = dot >= 0 ? p.slice(dot).toLowerCase() : '';
        return videoExtensions.includes(ext);
      };

      // Best-effort: Windows Explorer often exposes an ordered list of file URIs/paths via
      // text payloads. This tends to preserve the user’s selection order better than FileList.
      const tryGetOrderedPathsFromText = (): string[] => {
        const out: string[] = [];

        const pushPath = (p: string) => {
          if (!p) return;
          if (!hasVideoExt(p)) return;
          if (!out.includes(p)) out.push(p);
        };

        const parseFileUrl = (maybeUrl: string) => {
          if (!maybeUrl.startsWith('file://')) return;
          try {
            const u = new URL(maybeUrl);
            const decoded = decodeURIComponent(u.pathname || '');
            const asWin = decoded.replace(/\//g, '\\').replace(/^\\+/, '');
            pushPath(asWin);
          } catch {
            // ignore
          }
        };

        const read = (type: string) => {
          try {
            return e.dataTransfer.getData(type) || '';
          } catch {
            return '';
          }
        };

        // 1) RFC uri-list (often best)
        {
          const uriList = read('text/uri-list');
          const lines = uriList
            .split(/\r?\n/g)
            .map((s) => s.trim())
            .filter(Boolean)
            .filter((s) => !s.startsWith('#'));
          for (const line of lines) parseFileUrl(line);
          if (out.length) return out;
        }

        // 2) Firefox-ish format "url\nlabel"
        {
          const moz = read('text/x-moz-url');
          const firstLine = moz.split(/\r?\n/g)[0]?.trim() || '';
          if (firstLine.startsWith('file://')) parseFileUrl(firstLine);
          if (out.length) return out;
        }

        // 3) Windows can provide plain text with one path per line
        {
          const text = read('text/plain');
          const lines = text
            .split(/\r?\n/g)
            .map((s) => s.trim())
            .filter(Boolean);
          for (const line of lines) {
            if (line.startsWith('file://')) parseFileUrl(line);
            else pushPath(line);
          }
          if (out.length) return out;
        }

        // 4) DownloadURL: "mime:filename:url"
        {
          const dl = read('DownloadURL');
          const parts = dl.split(':');
          const last = parts[parts.length - 1]?.trim() || '';
          if (last.startsWith('file://')) parseFileUrl(last);
          if (out.length) return out;
        }

        // 5) text/html can contain file:// links
        {
          const html = read('text/html');
          const matches = html.match(/file:\/\/[^"'\s<>]+/gi) || [];
          for (const m of matches) parseFileUrl(m);
          if (out.length) return out;
        }

        return out;
      };

      const orderedTextPaths = tryGetOrderedPathsFromText();

      // Fallback: use File objects from items/files.
      const files: File[] = (() => {
        // Prefer `dataTransfer.items` because on Windows the `files` list can come in a weird
        // internal order. `items` tends to be more stable, but still not guaranteed.
        const fromItems = Array.from(e.dataTransfer.items || [])
          .filter((it) => it.kind === 'file')
          .map((it) => it.getAsFile())
          .filter(Boolean) as File[];

        const list = fromItems.length ? fromItems : Array.from(e.dataTransfer.files);
        return list;
      })();

      const videoFiles = files.filter((file) => {
        const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
        return videoExtensions.includes(ext);
      });

      if (!orderedTextPaths.length && !videoFiles.length) {
        setSnack(t('noVideoFiles'));
        return;
      }

      const filePaths: string[] = [];

      // Prefer ordered text paths if we got them.
      for (const p of orderedTextPaths) {
        if (p && !filePaths.includes(p)) filePaths.push(p);
      }

      // Then append any remaining paths from File objects (dedup).
      for (const file of videoFiles) {
        const p = (file as any).path || (file as any).webkitRelativePath || file.name;
        if (p && !filePaths.includes(p)) {
          filePaths.push(p);
        }
      }

      if (filePaths.length) {
        // If we didn't get an ordered text payload, normalize to deterministic order
        // to avoid Windows randomization.
        const finalPaths =
          orderedTextPaths.length || filePaths.length <= 1
            ? filePaths
            : [...filePaths].sort((a, b) => {
                const aName = baseName(a).toLowerCase();
                const bName = baseName(b).toLowerCase();
                const primary = aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
                if (primary !== 0) return primary;
                return a.toLowerCase().localeCompare(b.toLowerCase());
              });

        await addFilePaths(finalPaths);
        setSnack(t('filesAddedCount', { count: finalPaths.length }));
      } else {
        setSnack(t('noVideoFiles'));
      }
    },
    [addFilePaths, t],
  );

  // Create a hash key for DataGrid that changes when metadata changes
  // Keep DataGrid key constant to prevent remounts that reset column widths
  // Remounting DataGrid resets internal column state (widths), causing autosize to revert
  // Instead of remounting, we rely on React's reconciliation and autosize on datasetRevision
  // Force remount after removing 'targets' column to clear internal cache
  const dataGridKey = React.useMemo(() => 'data-grid-stable-v2', []);

  // Filter and sort rows function
  const sortedRows = React.useMemo(() => {
    // Derive rows array from rowsById for filtering/sorting
    const rowsArray = Array.from(rowsById.values());
    if (!rowsArray.length) return [];

    // First, filter by archived: default view = active only; "Show archived" = archived only
    let filtered = showArchived
      ? rowsArray.filter((row) => row.archivedAt != null)
      : rowsArray.filter((row) => row.archivedAt == null);

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((row) => {
        const filename = (row.filename || '').toLowerCase();
        const title = row.meta?.byPlatform?.youtube?.title?.toLowerCase() || '';
        return filename.includes(query) || title.includes(query);
      });
    }
    
    // Apply status filter using new status system
    if (filter !== 'all') {
      filtered = filtered.filter((row) => {
        const rowStatus = getRowStatus(row);
        return rowStatus === filter;
      });
    }

    const sorted = [...filtered];
    const orderMultiplier = sortOrder === 'asc' ? 1 : -1; // 1 for ascending, -1 for descending
    
    if (sortBy === 'name') {
      // Sort alphabetically by filename
      sorted.sort((a, b) => {
        const nameA = (a.filename || '').toLowerCase().trim();
        const nameB = (b.filename || '').toLowerCase().trim();
        const result = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
        return result * orderMultiplier;
      });
    } else if (sortBy === 'date') {
      // Sort by file creation date
      sorted.sort((a, b) => {
        const dateA = a.createdAt || 0;
        const dateB = b.createdAt || 0;
        // If both have dates, sort by date
        if (dateA > 0 && dateB > 0) {
          return (dateA - dateB) * orderMultiplier; // asc: oldest first, desc: newest first
        }
        // If one has date and other doesn't, prioritize the one with date
        if (dateA > 0) return -1 * orderMultiplier;
        if (dateB > 0) return 1 * orderMultiplier;
        // If neither has date, use addedAt as fallback
        const addedA = a.addedAt || 0;
        const addedB = b.addedAt || 0;
        if (addedA > 0 && addedB > 0) {
          return (addedA - addedB) * orderMultiplier;
        }
        // Last resort: use id as fallback
        return a.id.localeCompare(b.id) * orderMultiplier;
      });
    } else if (sortBy === 'added') {
      // Sort by addedAt (order of addition)
      sorted.sort((a, b) => {
        // First, try to get addedAt directly
        let addedA = a.addedAt || 0;
        let addedB = b.addedAt || 0;
        
        // If addedAt is missing, try to extract from id (format: timestamp-random)
        if (addedA === 0) {
          const idA = a.id || '';
          const idPartsA = idA.split('-');
          if (idPartsA.length > 0) {
            const timestampA = Number(idPartsA[0]);
            if (Number.isFinite(timestampA) && timestampA > 0) {
              addedA = timestampA;
            }
          }
        }
        
        if (addedB === 0) {
          const idB = b.id || '';
          const idPartsB = idB.split('-');
          if (idPartsB.length > 0) {
            const timestampB = Number(idPartsB[0]);
            if (Number.isFinite(timestampB) && timestampB > 0) {
              addedB = timestampB;
            }
          }
        }
        
        // If both have addedAt, sort by it
        if (addedA > 0 && addedB > 0) {
          return (addedA - addedB) * orderMultiplier; // asc: oldest first, desc: newest first
        }
        // If one has addedAt and other doesn't, prioritize the one with addedAt
        if (addedA > 0) return -1 * orderMultiplier;
        if (addedB > 0) return 1 * orderMultiplier;
        // Last resort: use id as fallback (but this should rarely happen)
        return (a.id || '').localeCompare(b.id || '') * orderMultiplier;
      });
    }
    
    return sorted;
  }, [rowsById, sortBy, sortOrder, filter, searchQuery, showArchived, getPlatformStatus, getRowStatus]);

  // Calculate status counts for tabs (respects showArchived: count only visible rows)
  const statusCounts = React.useMemo(() => {
    const counts = {
      all: 0,
      needsAction: 0,
      ready: 0,
      scheduled: 0,
      processing: 0,
      done: 0,
      failed: 0,
    };
    const rowsArray = Array.from(rowsById.values());
    const visible = showArchived
      ? rowsArray.filter((r) => r.archivedAt != null)
      : rowsArray.filter((r) => r.archivedAt == null);
    for (const row of visible) {
      const status = getRowStatus(row);
      counts[status]++;
    }
    counts.all = visible.length;
    return counts;
  }, [rowsById, showArchived, getRowStatus]);

  // Auto-size columns based on rendered cell content.
  // Unified autosize logic: triggers only on datasetRevision changes (import/add/remove rows),
  // not on every status/log update. This prevents flicker and ensures stable column widths.
  // Remounting DataGrid resets internal column state (widths), so we keep it mounted and autosize only on datasetRevision.
  React.useEffect(() => {
    if (userResizedColumnsRef.current) {
      return;
    }
    
    // Don't autosize if there are no rows
    if (rowsById.size === 0) {
      return;
    }
    
    const api = gridApiRef.current as any;
    if (!api?.autosizeColumns) {
      return;
    }

    // Clear any pending autosize timer
    if (autosizeTimerRef.current != null) {
      window.clearTimeout(autosizeTimerRef.current);
    }

    // Use a longer delay to ensure rows are fully rendered
    autosizeTimerRef.current = window.setTimeout(() => {
      const run = () => {
        try {
          // Wait until DataGrid is ready and has non-zero width
          const gridElement = document.querySelector('.MuiDataGrid-root');
          const virtualScroller = gridElement?.querySelector('.MuiDataGrid-virtualScroller') as HTMLElement | null;
          
          if (!virtualScroller || virtualScroller.clientWidth === 0) {
            // Retry after a short delay if grid is not ready
            autosizeTimerRef.current = window.setTimeout(run, 100);
            return;
          }

          // Mark autosize as programmatic to prevent onColumnResize from blocking future autosize
          isProgrammaticAutosizeRef.current = true;
          
          const columnsToAutosize = ['stage', 'visibility', 'selfDeclaredMadeForKids', 'youtube', 'instagram', 'tiktok'];
          
          // Use ReactDOM.flushSync as recommended by MUI docs for async autosize
          // This ensures DOM is fully updated before autosize calculation
          ReactDOM.flushSync(() => {
            api.autosizeColumns({
              columns: columnsToAutosize,
              includeHeaders: true,
              includeOutliers: true,
              outliersFactor: 1.5,
              expand: false,
              disableColumnVirtualization: true,
            });
          });
          
          // Clear programmatic flag after autosize completes
          setTimeout(() => {
            isProgrammaticAutosizeRef.current = false;
          }, 100);
        } catch (error) {
          // ignore
        } finally {
          isProgrammaticAutosizeRef.current = false;
        }
      };

      // Use multiple requestAnimationFrames to ensure layout is fully stable
      // This is especially important when rows are added asynchronously
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(run);
        });
      });
    }, 300);

    return () => {
      if (autosizeTimerRef.current != null) {
        window.clearTimeout(autosizeTimerRef.current);
        autosizeTimerRef.current = null;
      }
    };
  }, [gridApiRef, datasetRevision]);

  // Track dataset size changes and increment datasetRevision when rows are added/removed
  // This triggers autosize only on actual data changes, not on status/log updates
  React.useEffect(() => {
    const currentSize = rowsById.size;
    if (currentSize !== previousRowsSizeRef.current) {
      previousRowsSizeRef.current = currentSize;
      
      // Increment datasetRevision to trigger autosize
      setDatasetRevision((prev) => prev + 1);
    }
  }, [rowsById.size]);

  // Load createdAt and set addedAt for rows that don't have them
  React.useEffect(() => {
    // First, ensure all rows have addedAt (synchronous update)
    const rowsArray = Array.from(rowsById.values());
    const rowsWithoutAddedAt = rowsArray.filter((r) => !r.addedAt || r.addedAt === 0);
    if (rowsWithoutAddedAt.length > 0) {
      // Update addedAt for rows missing it - use updateRows to maintain referential stability
      updateRows((prev) => {
        // Find max addedAt from existing rows
        let maxAddedAt = 0;
        for (const r of prev.values()) {
          if (r.addedAt && r.addedAt > maxAddedAt) {
            maxAddedAt = r.addedAt;
          }
        }
        const baseTime = maxAddedAt > 0 ? maxAddedAt : Date.now();
        let counter = 0;
        let hasChanges = false;
        const next = new Map(prev);
        
        for (const row of prev.values()) {
          if (!row.addedAt || row.addedAt === 0) {
            // Try to extract timestamp from id if it's in format "timestamp-random"
            const idParts = row.id.split('-');
            const idTimestampStr = idParts.length > 0 ? idParts[0] : null;
            const idTimestamp = idTimestampStr ? Number(idTimestampStr) : null;
            // Use id timestamp if valid, otherwise use baseTime + counter
            const addedAt = (idTimestamp != null && Number.isFinite(idTimestamp) && idTimestamp > 0) 
              ? idTimestamp 
              : baseTime + (counter++ * 100);
            next.set(row.id, { ...row, addedAt });
            hasChanges = true;
          }
        }
        
        return hasChanges ? next : prev;
      });
      return; // Exit early, will re-run after state update
    }

    const rowsNeedingUpdate = rows.filter((r) => !r.createdAt);
    if (rowsNeedingUpdate.length === 0) return;

    const loadDates = async () => {
      const updates: Array<{ id: string; createdAt?: number; addedAt?: number }> = [];
      for (const row of rowsNeedingUpdate) {
        const update: { id: string; createdAt?: number; addedAt?: number } = { id: row.id };
        
        // Load createdAt if missing
        if (!row.createdAt) {
          try {
            const stats = await window.api?.getFileStats?.(row.filePath);
            if (stats?.ok && typeof stats.birthtimeMs === 'number' && Number.isFinite(stats.birthtimeMs)) {
              update.createdAt = stats.birthtimeMs;
            }
          } catch {
            // ignore
          }
        }
        
        // Set addedAt if missing (use current time or id timestamp)
        if (!row.addedAt) {
          // Try to extract timestamp from id if it's in format "timestamp-random"
          const idParts = row.id.split('-');
          const idTimestampStr = idParts.length > 0 ? idParts[0] : null;
          const idTimestamp = idTimestampStr ? Number(idTimestampStr) : null;
          update.addedAt = (idTimestamp != null && Number.isFinite(idTimestamp) && idTimestamp > 0) ? idTimestamp : Date.now();
        }
        
        if (update.createdAt || update.addedAt) {
          updates.push(update);
        }
      }

      if (updates.length > 0) {
        // Update rows with loaded dates - use updateRows to maintain referential stability
        updateRows((prev) => {
          let hasChanges = false;
          const next = new Map(prev);
          const updatesMap = new Map(updates.map(u => [u.id, u]));
          
          for (const row of prev.values()) {
            const update = updatesMap.get(row.id);
            if (!update) {
              // Ensure addedAt exists even if no update
              if (!row.addedAt) {
                const idParts = row.id.split('-');
                const idTimestampStr = idParts.length > 0 ? idParts[0] : null;
                const idTimestamp = idTimestampStr ? Number(idTimestampStr) : null;
                next.set(row.id, {
                  ...row,
                  addedAt: (idTimestamp != null && Number.isFinite(idTimestamp) && idTimestamp > 0) ? idTimestamp : Date.now(),
                });
                hasChanges = true;
              }
              continue;
            }
            
            const updatedRow = {
              ...row,
              createdAt: update.createdAt ?? row.createdAt,
              addedAt: update.addedAt ?? row.addedAt ?? Date.now(),
            };
            
            if (updatedRow.createdAt !== row.createdAt || updatedRow.addedAt !== row.addedAt) {
              next.set(row.id, updatedRow);
              hasChanges = true;
            }
          }
          
          return hasChanges ? next : prev;
        });
      } else {
        // Even if no updates, ensure all rows have addedAt
        const rowsArray = Array.from(rowsById.values());
        const needsAddedAt = rowsArray.filter((r) => !r.addedAt);
        if (needsAddedAt.length > 0) {
          updateRows((prev) => {
            let hasChanges = false;
            const next = new Map(prev);
            
            for (const row of prev.values()) {
              if (!row.addedAt) {
                const idParts = row.id.split('-');
                const idTimestampStr = idParts.length > 0 ? idParts[0] : null;
                const idTimestamp = idTimestampStr ? Number(idTimestampStr) : null;
                next.set(row.id, {
                  ...row,
                  addedAt: (idTimestamp != null && Number.isFinite(idTimestamp) && idTimestamp > 0) ? idTimestamp : Date.now(),
                });
                hasChanges = true;
              }
            }
            
            return hasChanges ? next : prev;
          });
        }
      }
    };

    void loadDates();
  }, [rows]);

const add = async () => {
  // We can't pick files + folders in a single native dialog reliably.
  // So we show a small in-app dialog with two options.
  setAddDialogOpen(true);
};


  const rescheduleAll = async (targetIds?: string[]) => {
    // Save to history before rescheduling
    await saveToHistory(true);
    
    // Reschedule all - use updateRows to maintain referential stability
    updateRows((prev) => {
      // If targetIds is provided, only reschedule those rows
      // Otherwise, reschedule all auto rows
      const allRows = Array.from(prev.values());
      const manual = allRows.filter((r) => r.publishSource === 'manual');
      const auto = targetIds
        ? allRows.filter((r) => targetIds.includes(r.id) && r.publishSource !== 'manual')
        : allRows.filter((r) => r.publishSource !== 'manual');

      const existingScheduled = manual.filter((r) => r.publishMode === 'schedule' && typeof r.publishAt === 'number');

      // Apply the same sorting logic as in sortedRows to respect current grid sort order
      const sortedAuto = [...auto];
      const orderMultiplier = sortOrder === 'asc' ? 1 : -1;

      if (sortBy === 'name') {
        sortedAuto.sort((a, b) => {
          const nameA = (a.filename || '').toLowerCase().trim();
          const nameB = (b.filename || '').toLowerCase().trim();
          const result = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
          return result * orderMultiplier;
        });
      } else if (sortBy === 'date') {
        // Sort by file creation date
        sortedAuto.sort((a, b) => {
          const dateA = a.createdAt || 0;
          const dateB = b.createdAt || 0;
          if (dateA > 0 && dateB > 0) {
            return (dateA - dateB) * orderMultiplier;
          }
          if (dateA > 0) return -1 * orderMultiplier;
          if (dateB > 0) return 1 * orderMultiplier;
          // Fallback to addedAt
          const addedA = a.addedAt || 0;
          const addedB = b.addedAt || 0;
          if (addedA > 0 && addedB > 0) {
            return (addedA - addedB) * orderMultiplier;
          }
          // Last resort: use id
          return a.id.localeCompare(b.id) * orderMultiplier;
        });
      } else if (sortBy === 'added') {
        // Sort by addedAt (order of addition)
        sortedAuto.sort((a, b) => {
          let addedA = a.addedAt || 0;
          let addedB = b.addedAt || 0;
          
          // If addedAt is missing, try to extract from id (format: timestamp-random)
          if (addedA === 0) {
            const idA = a.id || '';
            const idPartsA = idA.split('-');
            if (idPartsA.length > 0) {
              const timestampA = Number(idPartsA[0]);
              if (Number.isFinite(timestampA) && timestampA > 0) {
                addedA = timestampA;
              }
            }
          }
          
          if (addedB === 0) {
            const idB = b.id || '';
            const idPartsB = idB.split('-');
            if (idPartsB.length > 0) {
              const timestampB = Number(idPartsB[0]);
              if (Number.isFinite(timestampB) && timestampB > 0) {
                addedB = timestampB;
              }
            }
          }
          
          if (addedA > 0 && addedB > 0) {
            return (addedA - addedB) * orderMultiplier;
          }
          if (addedA > 0) return -1 * orderMultiplier;
          if (addedB > 0) return 1 * orderMultiplier;
          return (a.id || '').localeCompare(b.id || '') * orderMultiplier;
        });
      }

      const toAssign = sortedAuto.map((r) => ({
        ...r,
        publishMode: 'schedule' as const,
        publishAt: null,
        publishSource: 'auto' as const,
      }));

      const assigned = applyAutoSchedule(toAssign, existingScheduled);
      const byId = new Map(assigned.map((a) => [a.id, a]));

      // Update only auto rows with their assigned publishAt - maintain referential stability for unchanged rows
      let hasChanges = false;
      const next = new Map(prev);
      for (const [id, assignedRow] of byId.entries()) {
        const currentRow = prev.get(id);
        if (currentRow && (
          currentRow.publishAt !== assignedRow.publishAt ||
          currentRow.publishMode !== assignedRow.publishMode ||
          currentRow.publishSource !== assignedRow.publishSource
        )) {
          next.set(id, assignedRow);
          hasChanges = true;
        }
      }
      return hasChanges ? next : prev;
    });
  };

  const generateMetadata = async (
    specificRows?: JobRow[],
    platformsToGenerate?: ('youtube' | 'instagram' | 'tiktok')[],
    options?: { skipQueue?: boolean; allowBusyPaths?: Set<string>; jobId?: string },
  ) => {
    if (!window.api?.runPipeline) return;
    if (!requireOnline()) return;
    if (!ensureSignedIn()) return;
    if (limitedMode) {
      setBillingGateReason('reconnect_required');
      return;
    }
    const rowsArray = Array.from(rowsById.values());
    if (rowsArray.length === 0) return;

    // Use provided rows or selected rows, but never all rows if nothing is selected
    const target = specificRows || (selectedIds.length > 0 ? rowsArray.filter((r) => selectedIds.includes(r.id)) : []);
    if (target.length === 0) return;
    
    // Check metadata directly from disk for accurate verification
    // This is more reliable than checking UI state which might be stale
    const checkMetadataOnDisk = async (filePath: string): Promise<boolean> => {
      try {
        const res = await window.api?.readOutputsForPath?.(filePath);
        if (!res?.ok) {
          console.log(`[checkMetadataOnDisk] readOutputsForPath failed for ${filePath}`);
          return false;
        }
        
        // Check both metadata.platforms and exports
        // Note: After deletion, metadata.platforms might exist but be empty {} or contain empty objects
        const metadataPlatforms = res?.metadata?.platforms || {};
        const exports = res?.exports || {};
        
        // If metadata.platforms is empty object, treat as no metadata
        // But still check exports in case files exist there
        const hasEmptyPlatforms = Object.keys(metadataPlatforms).length === 0;
        if (hasEmptyPlatforms) {
          console.log(`[checkMetadataOnDisk] metadata.platforms is empty {} for ${filePath}`);
        }
        
        // Helper to check if a platform has actual content (non-empty)
        const hasPlatformContent = (platform: string): boolean => {
          // Check in metadata.platforms - must have actual non-empty content
          const metaPlatform = metadataPlatforms[platform];
          let hasMetaContent = false;
          if (metaPlatform && typeof metaPlatform === 'object') {
            const title = metaPlatform.title ? String(metaPlatform.title).trim() : '';
            const desc = metaPlatform.description ? String(metaPlatform.description).trim() : '';
            let tags = false;
            if (metaPlatform.hashtags) {
              if (Array.isArray(metaPlatform.hashtags)) {
                tags = metaPlatform.hashtags.length > 0 && metaPlatform.hashtags.some((t: unknown) => String(t).trim());
              } else if (typeof metaPlatform.hashtags === 'string') {
                tags = Boolean(metaPlatform.hashtags.trim());
              }
            }
            hasMetaContent = Boolean(title || desc || tags);
            if (hasMetaContent) {
              console.log(`[checkMetadataOnDisk] Platform ${platform} has metadata content: title="${title}", desc="${desc}", tags=${tags}`);
            } else {
              console.log(`[checkMetadataOnDisk] Platform ${platform} metadata object exists but is EMPTY: title="${title}", desc="${desc}", tags=${tags}`);
            }
          } else {
            console.log(`[checkMetadataOnDisk] Platform ${platform} has NO metadata object in metadata.platforms`);
          }
          
          // Also check exports (these are the actual files on disk)
          const exp = exports[platform];
          let hasExportContent = false;
          if (exp && typeof exp === 'object') {
            const title = exp.title ? String(exp.title).trim() : '';
            const desc = exp.description ? String(exp.description).trim() : '';
            const tags = exp.hashtags ? String(exp.hashtags).trim() : '';
            hasExportContent = Boolean(title || desc || tags);
            if (hasExportContent) {
              console.log(`[checkMetadataOnDisk] Platform ${platform} has export content: title="${title}", desc="${desc}", tags="${tags}"`);
            } else {
              console.log(`[checkMetadataOnDisk] Platform ${platform} export object exists but is EMPTY: title="${title}", desc="${desc}", tags="${tags}"`);
            }
          } else {
            console.log(`[checkMetadataOnDisk] Platform ${platform} has NO export object`);
          }
          
          const result = hasMetaContent || hasExportContent;
          if (!result) {
            console.log(`[checkMetadataOnDisk] Platform ${platform} has NO content (neither metadata nor exports have content)`);
          }
          return result;
        };
        
        if (platformsToGenerate && platformsToGenerate.length > 0) {
          // Check if all requested platforms have metadata
          // Return true only if ALL platforms have content
          // If platforms object is empty, definitely no metadata
          if (hasEmptyPlatforms) {
            console.log(`[checkMetadataOnDisk] metadata.platforms is empty {}, so NO platforms have content. Returning false for ${platformsToGenerate.join(', ')}`);
            return false; // If platforms is empty, definitely no metadata
          }
          const allHaveContent = platformsToGenerate.every(platform => hasPlatformContent(platform));
          console.log(`[checkMetadataOnDisk] Platforms to generate: ${platformsToGenerate.join(', ')}, All have content: ${allHaveContent}`);
          return allHaveContent;
        } else {
          // Check if ALL platforms have metadata (when no specific platforms requested)
          // If platforms object is empty, definitely no metadata for all platforms
          if (hasEmptyPlatforms) {
            console.log(`[checkMetadataOnDisk] metadata.platforms is empty {}, so NO platforms have content. Returning false (need to generate for all platforms)`);
            return false; // If platforms is empty, need to generate for all platforms
          }
          // Check if ALL platforms (YouTube, Instagram, TikTok) have metadata
          const allHaveContent = hasPlatformContent('youtube') && hasPlatformContent('instagram') && hasPlatformContent('tiktok');
          console.log(`[checkMetadataOnDisk] Checking all platforms, All have content: ${allHaveContent}`);
          if (!allHaveContent) {
            const missing = [];
            if (!hasPlatformContent('youtube')) missing.push('youtube');
            if (!hasPlatformContent('instagram')) missing.push('instagram');
            if (!hasPlatformContent('tiktok')) missing.push('tiktok');
            console.log(`[checkMetadataOnDisk] Missing metadata for platforms: ${missing.join(', ')}`);
          }
          return allHaveContent;
        }
      } catch (e) {
        console.error('Failed to check metadata on disk:', e);
        return false; // Assume no metadata if check fails
      }
    };
    
    // Check each target file directly on disk
    const metadataChecks = await Promise.all(
      target.map(async (row) => {
        const hasMetadata = await checkMetadataOnDisk(row.filePath);
        // Debug logging
        if (hasMetadata) {
          console.log(`[generateMetadata] File ${row.filePath} already has metadata for platforms: ${platformsToGenerate?.join(', ') || 'all'}`);
        } else {
          console.log(`[generateMetadata] File ${row.filePath} needs metadata for platforms: ${platformsToGenerate?.join(', ') || 'all'}`);
        }
        return { row, hasMetadata };
      })
    );
    
    // Filter rows that need metadata (hasMetadata === false means needs metadata)
    const needsMetadata = metadataChecks
      .filter(({ hasMetadata }) => !hasMetadata)
      .map(({ row }) => row);
    
    console.log(`[generateMetadata] Target: ${target.length}, Needs metadata: ${needsMetadata.length}, Platforms: ${platformsToGenerate?.join(', ') || 'all'}`);
    
    if (needsMetadata.length === 0 && target.length > 0) {
      console.log(`[generateMetadata] WARNING: All files appear to have metadata, but this might be incorrect. Checking details...`);
      // Double-check by reading the actual metadata
      for (const row of target) {
        const res = await window.api?.readOutputsForPath?.(row.filePath);
        console.log(`[generateMetadata] Double-check for ${row.filePath}:`, {
          hasMetadata: !!res?.metadata,
          platformsKeys: res?.metadata?.platforms ? Object.keys(res.metadata.platforms) : [],
          platforms: res?.metadata?.platforms,
        });
      }
    }

    if (needsMetadata.length === 0) {
      if (platformsToGenerate && platformsToGenerate.length > 0) {
        setSnack(t('allSelectedFilesHaveMetadataForPlatforms', { platforms: platformsToGenerate.map((p) => platformLabels[p]).join(', ') }));
      } else {
        setSnack(t('allSelectedFilesHaveMetadata'));
      }
      return;
    }

    const allowBusyPaths = options?.allowBusyPaths;
    const busyPaths = metadataBusyPathsRef.current;
    // Single-flight: skip files already running or queued for metadata generation (unless explicitly allowed)
    const toProcess = needsMetadata.filter((row) => {
      const isBusy = busyPaths.has(row.filePath);
      return !isBusy || (allowBusyPaths && allowBusyPaths.has(row.filePath));
    });
    if (toProcess.length === 0) {
      setSnack(t('metadataAlreadyProcessingOrQueued'));
      return;
    }
    const paths = toProcess.map((t) => t.filePath);
    const willQueue = !options?.skipQueue && Boolean(metadataActiveRef.current);

    if (willQueue) {
      setSnack(t('metadataQueued', { count: toProcess.length }));
    } else if (toProcess.length < needsMetadata.length) {
      setSnack(t('metadataSkippingBusy', { skipped: needsMetadata.length - toProcess.length, processing: toProcess.length }));
    } else if (toProcess.length < target.length) {
      setSnack(t('skippingExistingMetadata', { skipped: target.length - toProcess.length, processing: toProcess.length }));
    } else {
      if (platformsToGenerate && platformsToGenerate.length > 0) {
        setSnack(
          t('generatingMetadataForFilesWithPlatforms', {
            count: toProcess.length,
            platforms: platformsToGenerate.map((p) => platformLabels[p]).join(', '),
          }),
        );
      } else {
        setSnack(t('generatingMetadataForFiles', { count: toProcess.length }));
      }
    }

    const job: MetadataQueueItem = {
      id: options?.jobId || newId(),
      filePaths: paths,
      platforms: platformsToGenerate,
      queuedAt: Date.now(),
    };

    if (willQueue) {
      addMetadataBusyPaths(paths);
      metadataQueueRef.current.push(job);
      refreshMetadataQueueCounts();
      return;
    }

    addMetadataBusyPaths(paths);
    if (metadataActiveRef.current && metadataActiveRef.current.id !== job.id) {
      removeMetadataBusyPaths(paths);
      setSnack(t('metadataAlreadyProcessingOrQueued'));
      return;
    }
    metadataActiveRef.current = job;
    metadataCancelRef.current = null;
    refreshMetadataQueueCounts();

    let metadataReservations: Map<string, string> | null = null;
    try {
      metadataReservations = await reserveQuotaForRows(toProcess, 'metadata');
      setSnack(t('metadataCreditsReserved', { count: metadataReservations.size }));
    } catch (err) {
      handleBillingError(err, 'metadata');
      removeMetadataBusyPaths(paths);
      if (metadataActiveRef.current?.id === job.id) {
        metadataActiveRef.current = null;
        metadataCancelRef.current = null;
      }
      refreshMetadataQueueCounts();
      return;
    }

    try {
      // Set "Processing" status ONLY for files we are actually processing
      for (const row of toProcess) {
        updateRow(row.id, (r) => ({ ...r, status: 'Processing' as const }));
        setLogsById((prev) => {
          const next = new Map(prev);
          next.set(row.id, '');
          return next;
        });
      }

      const payload: any = { mode: 'files' as const, paths };
      if (platformsToGenerate && platformsToGenerate.length > 0) {
        payload.platforms = platformsToGenerate;
      }
      console.log(`[generateMetadata] Calling runPipeline with payload:`, {
        mode: payload.mode,
        paths: payload.paths,
        platforms: payload.platforms,
      });
      // Start periodic check for incremental status updates
      const stillProcessing = new Set(toProcess.map((t) => t.filePath));
      const checkInterval = setInterval(async () => {
        if (stillProcessing.size === 0) {
          clearInterval(checkInterval);
          return;
        }
        for (const filePath of Array.from(stillProcessing)) {
          try {
            const hasMetadata = await checkMetadataOnDisk(filePath);
            if (hasMetadata) {
              const row = toProcess.find((t) => t.filePath === filePath);
              if (row) {
                console.log(`[generateMetadata] File ${filePath} finished, updating status to Done`);
                updateRow(row.id, (r) => ({ ...r, status: 'Done' }));
                stillProcessing.delete(filePath);
                
                // Refresh metadata for this file immediately
                refreshOutputsForPath(filePath, true);
                
                // Unmark deleted metadata from tombstone for this file
                if (platformsToGenerate && platformsToGenerate.length > 0) {
                  for (const platform of platformsToGenerate) {
                    try {
                      await window.api?.unmarkDeletedMetadata?.({ filePath, platform });
                    } catch (e) {
                      console.error(`[generateMetadata] Failed to unmark deleted metadata for ${platform} on ${filePath}:`, e);
                    }
                  }
                } else {
                  for (const platform of ['youtube', 'instagram', 'tiktok'] as const) {
                    try {
                      await window.api?.unmarkDeletedMetadata?.({ filePath, platform });
                    } catch (e) {
                      console.error(`[generateMetadata] Failed to unmark deleted metadata for ${platform} on ${filePath}:`, e);
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.error(`[generateMetadata] Error checking metadata for ${filePath}:`, e);
          }
        }
      }, 2000); // Check every 2 seconds
      
      await syncSupabaseToken();
      const supabase = getSupabase();
      let accessToken = '';
      if (supabase) {
        try {
          const { data } = await supabase.auth.getSession();
          accessToken = data?.session?.access_token ?? '';
        } catch {
          accessToken = '';
        }
      }
      const baseUrl = (import.meta as any)?.env?.VITE_SUPABASE_URL as string | undefined;
      const functionsUrl = baseUrl ? `${String(baseUrl).replace(/\/+$/, '')}/functions/v1` : '';
      const runPayload = {
        ...payload,
        auth: {
          accessToken,
          functionsUrl,
        },
      };
      const res = await window.api.runPipeline(runPayload);
      console.log(`[generateMetadata] runPipeline returned:`, {
        code: res?.code,
        runId: res?.runId,
      });

      // Clear the interval when pipeline completes
      clearInterval(checkInterval);

      const canceled = metadataCancelRef.current?.id === job.id || Boolean(res?.canceled);
      if (canceled) {
        const results = await Promise.all(
          toProcess.map(async (row) => ({
            row,
            filePath: row.filePath,
            hasMetadata: await checkMetadataOnDisk(row.filePath),
          })),
        );
        let releasedCount = 0;
        if (metadataReservations) {
          for (const result of results) {
            const reservationId = metadataReservations.get(result.filePath);
            if (!reservationId) continue;
            if (result.hasMetadata) {
              try {
                await finalizeQuota(reservationId);
              } catch (err) {
                console.error('Failed to finalize metadata quota after cancel:', err);
              }
            } else {
              try {
                await releaseQuota(reservationId);
                releasedCount += 1;
              } catch (err) {
                console.error('Failed to release metadata quota after cancel:', err);
              }
            }
          }
        }

        const cancelLogLine = t('metadataCancelledLog');
        setLogsById((prev) => {
          const next = new Map(prev);
          for (const result of results) {
            if (result.hasMetadata) continue;
            const currentLog = next.get(result.row.id) || '';
            const appended = currentLog ? `${currentLog}\n${cancelLogLine}` : cancelLogLine;
            next.set(result.row.id, appended);
          }
          return next;
        });

        for (const result of results) {
          if (result.hasMetadata) {
            updateRow(result.row.id, (r) => ({ ...r, status: 'Done' as const }));
          } else {
            updateRow(result.row.id, (r) => ({ ...r, status: 'Ready' as const }));
          }
        }

        const releasedNote = releasedCount > 0 ? ` ${t('metadataCreditsReleased', { count: releasedCount })}` : '';
        const cancelReason = metadataCancelRef.current?.id === job.id ? metadataCancelRef.current?.reason : null;
        if (cancelReason !== 'user' && cancelReason !== 'shortcut') {
          setSnack(`${t('metadataRunCancelled')}${releasedNote}`);
        }
        return;
      }
      
      // Final check and update for any remaining files
      for (const filePath of Array.from(stillProcessing)) {
        try {
          const hasMetadata = await checkMetadataOnDisk(filePath);
          const row = toProcess.find((t) => t.filePath === filePath);
          if (row) {
            updateRow(row.id, (r) => ({ ...r, status: hasMetadata ? 'Done' : (res.code === 0 ? 'Done' : 'Error') }));
          }
        } catch (e) {
          console.error(`[generateMetadata] Error in final check for ${filePath}:`, e);
        }
      }

      try {
        const applyPayload: { paths: string[]; platforms?: ('youtube' | 'instagram' | 'tiktok')[] } = { paths };
        if (platformsToGenerate && platformsToGenerate.length > 0) {
          applyPayload.platforms = platformsToGenerate;
        }
        if (window.api?.presetsApplyToOutputs) {
          const applyRes = await window.api.presetsApplyToOutputs(applyPayload);
          console.log('[generateMetadata] Apply active Custom AI formatting:', applyRes);
        } else {
          console.warn('[generateMetadata] presetsApplyToOutputs not available on window.api');
        }
      } catch (e) {
        console.error('[generateMetadata] Failed to apply preset formatting:', e);
      }

      let metadataSuccessCount = 0;
      let metadataReleasedCount = 0;
      if (metadataReservations) {
        const results = await Promise.all(
          toProcess.map(async (row) => ({
            filePath: row.filePath,
            hasMetadata: await checkMetadataOnDisk(row.filePath),
          })),
        );
        metadataSuccessCount = results.filter((result) => result.hasMetadata).length;
        let latestSnapshot: UsageSnapshot | null = null;
        for (const result of results) {
          const reservationId = metadataReservations.get(result.filePath);
          if (!reservationId) continue;
          if (result.hasMetadata) {
            try {
              latestSnapshot = await finalizeQuota(reservationId);
            } catch (err) {
              console.error('Failed to finalize metadata quota:', err);
            }
          } else {
            try {
              await releaseQuota(reservationId);
              metadataReleasedCount += 1;
            } catch (err) {
              console.error('Failed to release metadata quota:', err);
            }
          }
        }
        if (latestSnapshot) setUsageSnapshot(latestSnapshot);
      }

      // Pull generated metadata from outputs (so Details can show it immediately)
      if (res?.code === 0 && metadataSuccessCount > 0) {
        console.log(`[generateMetadata] Pipeline completed successfully (code: ${res.code}), refreshing metadata...`);
        
        // Unmark deleted metadata from tombstone for regenerated platforms (for any files that weren't already processed incrementally)
        const remainingFiles = Array.from(stillProcessing);
        if (remainingFiles.length > 0) {
          if (platformsToGenerate && platformsToGenerate.length > 0) {
            for (const fp of remainingFiles) {
              for (const platform of platformsToGenerate) {
                try {
                  await window.api?.unmarkDeletedMetadata?.({ filePath: fp, platform });
                  console.log(`[generateMetadata] Unmarked ${platform} as deleted for ${fp}`);
                } catch (e) {
                  console.error(`[generateMetadata] Failed to unmark deleted metadata for ${platform} on ${fp}:`, e);
                }
              }
            }
          } else {
            // If no specific platforms, unmark all platforms
            for (const fp of remainingFiles) {
              for (const platform of ['youtube', 'instagram', 'tiktok'] as const) {
                try {
                  await window.api?.unmarkDeletedMetadata?.({ filePath: fp, platform });
                  console.log(`[generateMetadata] Unmarked ${platform} as deleted for ${fp}`);
                } catch (e) {
                  console.error(`[generateMetadata] Failed to unmark deleted metadata for ${platform} on ${fp}:`, e);
                }
              }
            }
          }
        }
        
        // Clear rowsRef cache for these files to force fresh read
        for (const fp of paths) {
          const row = rowsRef.current.find((r) => r.filePath === fp);
          if (row) {
            // Invalidate metadata cache by clearing it temporarily
            rowsRef.current = rowsRef.current.map((r) => 
              r.filePath === fp ? { ...r, meta: undefined } : r
            );
            console.log(`[generateMetadata] Cleared metadata cache for ${fp}`);
          }
        }
        
        // Show success message
        const successCount = metadataSuccessCount || toProcess.length;
        const releasedNote = metadataReleasedCount > 0
          ? ` ${t('metadataCreditsReleased', { count: metadataReleasedCount })}`
          : '';
        if (platformsToGenerate && platformsToGenerate.length > 0) {
          setSnack(
            `${t('metadataGeneratedSuccessWithPlatforms', {
              count: successCount,
              platforms: platformsToGenerate.map((p) => platformLabels[p]).join(', '),
            })}${releasedNote}`,
          );
        } else {
          setSnack(`${t('metadataGeneratedSuccess', { count: successCount })}${releasedNote}`);
        }
        
        // Final refresh for any remaining files with increasing delays to ensure files are fully written
        if (remainingFiles.length > 0) {
          setTimeout(() => {
            console.log(`[generateMetadata] Final refresh (500ms delay) for remaining files...`);
            for (const fp of remainingFiles) {
              refreshOutputsForPath(fp, true); // Force refresh to ensure UI updates
            }
          }, 500);
          
          setTimeout(() => {
            console.log(`[generateMetadata] Final refresh (2000ms delay) for remaining files...`);
            for (const fp of remainingFiles) {
              refreshOutputsForPath(fp, true); // Force refresh again to catch delayed writes
            }
          }, 2000);
        }
      } else {
        console.error(`[generateMetadata] Pipeline failed with code: ${res?.code}`);
        for (const filePath of Array.from(stillProcessing)) {
          const row = toProcess.find((t) => t.filePath === filePath);
          if (row) {
            updateRow(row.id, (r) => ({ ...r, status: 'Error' }));
          }
        }
        const failureMsg = t('metadataGenerationFailedWithCode', { code: res?.code });
        const releasedNote = metadataReleasedCount > 0
          ? ` ${t('metadataCreditsReleased', { count: metadataReleasedCount })}`
          : '';
        setSnack(metadataSuccessCount > 0 ? `${failureMsg}${releasedNote}` : `${failureMsg}${releasedNote}`);
      }
    } catch (e) {
      handleNetworkError(e);
      let releasedCount = 0;
      if (metadataReservations) {
        const reservationIds = Array.from(metadataReservations.values());
        releasedCount = reservationIds.length;
        await Promise.all(
          reservationIds.map((reservationId) => releaseQuota(reservationId).catch(() => null)),
        );
      }
      for (const row of toProcess) {
        updateRow(row.id, (r) => ({ ...r, status: 'Error' }));
      }
      const releasedNote = releasedCount > 0 ? ` ${t('metadataCreditsReleased', { count: releasedCount })}` : '';
      setSnack(`${t('metadataGenerationError')}${releasedNote}`);
    } finally {
      removeMetadataBusyPaths(paths);
      if (metadataActiveRef.current?.id === job.id) {
        metadataActiveRef.current = null;
        metadataCancelRef.current = null;
      }
      refreshMetadataQueueCounts();

      let nextJob: MetadataQueueItem | undefined;
      while (!metadataActiveRef.current && metadataQueueRef.current.length > 0) {
        nextJob = metadataQueueRef.current.shift();
        refreshMetadataQueueCounts();
        if (!nextJob) break;
        const allowBusy = new Set(nextJob.filePaths);
        const nextRows = rowsRef.current.filter((r) => allowBusy.has(r.filePath));
        if (nextRows.length === 0) {
          removeMetadataBusyPaths(nextJob.filePaths);
          continue;
        }
        void generateMetadata(nextRows, nextJob.platforms, {
          skipQueue: true,
          allowBusyPaths: allowBusy,
          jobId: nextJob.id,
        });
        break;
      }
    }
  };

  // Execute "Publish" operations for a set of rows (used by presets and custom).
  const runPublishActions = React.useCallback(async (
    target: JobRow[],
    opts: { generateMetadata: boolean; youtube: boolean; instagram: boolean; tiktok: boolean },
  ) => {
    const needsNetwork = opts.generateMetadata || opts.youtube || opts.instagram || opts.tiktok;
    if (needsNetwork && !requireOnline()) return;
    if (!guardUploadAndScheduleAccess()) return;
    if (!target.length) {
      setSnack(t('selectAtLeastOneVideoFile'));
      return;
    }

    const current = await window.api?.jobsLoad?.();
    const jobsFromDisk: ScheduledJob[] = Array.isArray(current) ? current : [];

    const isDoneOnPlatform = (row: JobRow, platform: 'youtube' | 'instagram' | 'tiktok') => {
      const jobsForRow = getJobsForRow(row, jobsFromDisk);
      return jobsForRow.some((j) => Boolean(j.run?.[platform]?.done));
    };

    let hasError = false;
    let ytSkippedDone = 0;
    
    // 1. Generate Metadata
    if (opts.generateMetadata) {
      try {
        setSnack(t('generatingMetadataForVideos', { count: target.length }));
        await generateMetadata(target);
        setSnack(t('metadataGeneratedForVideos', { count: target.length }));
      } catch (e) {
        setSnack(t('metadataGenerationError'));
        hasError = true;
      }
    }

    // 2. Upload to YouTube
    const anyYouTubeToDo = opts.youtube && target.some((r) => !isDoneOnPlatform(r, 'youtube'));
    if (anyYouTubeToDo && !hasError) {
      let uploadReservations: Map<string, string> | null = null;
      let successCount = 0;
      let failCount = 0;
      let sawLimitError = false;
      let latestSnapshot: UsageSnapshot | null = null;
      let uploadReleasedCount = 0;
      try {
        const uploadTargets = target.filter((r) => !isDoneOnPlatform(r, 'youtube'));
        ytSkippedDone += Math.max(0, target.length - uploadTargets.length);
        // Check if YouTube is connected
        const connected = await window.api?.youtubeIsConnected?.();
        if (!connected?.connected) {
          setSnack(t('youtubeNotConnectedPrompt'));
          hasError = true;
        } else {
          // Upload each selected video
          try {
            uploadReservations = await reserveQuotaForRows(uploadTargets, 'upload');
            setSnack(t('uploadCreditsReserved', { count: uploadTargets.length }));
          } catch (err) {
            handleBillingError(err, 'upload');
            return;
          }
          
          for (let uploadIdx = 0; uploadIdx < uploadTargets.length; uploadIdx++) {
            const row = uploadTargets[uploadIdx];
            const reservationId = uploadReservations?.get(row.filePath);
            try {
              if (isDoneOnPlatform(row, 'youtube')) {
                ytSkippedDone += 1;
                if (reservationId) {
                  try {
                    await releaseQuota(reservationId);
                    uploadReleasedCount += 1;
                  } catch (err) {
                    console.error('Failed to release upload quota:', err);
                  }
                }
                continue;
              }

              // Get YouTube metadata from row; fallback to exports/metadata from disk for fresh hashtags
              const ym = row.meta?.byPlatform?.youtube;
              let title = String(ym?.title || row.filename || '').trim();
              let desc = String(ym?.description || '').trim();
              let tagsRaw = ym?.hashtags || '';
              if (!tagsRaw?.trim()) {
                const outputs = await window.api?.readOutputsForPath?.(row.filePath);
                const exp = outputs?.exports?.youtube || {};
                const meta = outputs?.meta?.platforms?.youtube || {};
                if (!title?.trim()) title = (exp?.title || meta?.title || row.filename || '').trim();
                if (!desc?.trim()) desc = (exp?.description || meta?.description || '').trim();
                tagsRaw = (exp?.hashtags || meta?.hashtags || '').trim();
              }
              // Parse tags (strip # for API)
              const tags = (tagsRaw || '')
                .split(/[,\n]/)
                .map((x: string) => x.trim())
                .filter(Boolean)
                .map((x: string) => (x.startsWith('#') ? x.slice(1) : x))
                .join(' ');
              // Append hashtags to description so they appear in video description on YouTube
              const hashtagsForDesc = tags ? tags.split(/\s+/).filter(Boolean).map((t) => (t.startsWith('#') ? t.replace(/^#+/, '#') : `#${t}`)).join(' ') : '';
              const description = hashtagsForDesc ? (desc ? `${desc}\n\n${hashtagsForDesc}` : hashtagsForDesc) : desc;

              // Use YouTube-specific scheduled time (from YouTube column/job), otherwise null (immediate upload).
              // IMPORTANT: Do not inherit publish time from other platforms (IG/TT).
              const jobsForRow = getJobsForRow(row);
              const ytJob = jobsForRow.find((j) => Boolean(j.targets?.youtube));
              const publishAtMs = typeof ytJob?.publishAtUtcMs === 'number' ? ytJob.publishAtUtcMs : null;
              
              // Log for debugging
              if (publishAtMs) {
                const publishAtDate = new Date(publishAtMs);
                console.log(`[YouTube Upload] Scheduling:`, {
                  source: 'cell',
                  timestamp: publishAtMs,
                  iso: publishAtDate.toISOString(),
                  local: publishAtDate.toLocaleString(),
                });
              }

              const payload = {
                filePath: row.filePath,
                title,
                description,
                tags,
                publishAt: publishAtMs,
                privacyStatus: row.visibility || 'private',
                selfDeclaredMadeForKids: row.selfDeclaredMadeForKids ?? false,
              };

              // Set status to Processing before upload starts
              updateRow(row.id, (r) => ({
                ...r,
                upload: {
                  ...r.upload,
                  youtube: {
                    status: 'Processing' as const,
                    message: t('uploadingToPlatform', { platform: platformLabels.youtube }),
                    updatedAt: Date.now(),
                  },
                },
              }));

              setSnack(t('uploadingFileToPlatform', { file: row.filename, platform: platformLabels.youtube }));
              const res: any = await window.api?.youtubeUpload?.(payload);
              
              if (res?.ok && res?.videoId) {
                successCount++;
                if (reservationId) {
                  try {
                    latestSnapshot = await finalizeQuota(reservationId);
                  } catch (err) {
                    console.error('Failed to finalize upload quota:', err);
                  }
                }
                await upsertJobRunForPlatform({
                  row,
                  platform: 'youtube',
                  ok: true,
                  videoId: res.videoId,
                  publishAtUtcMs: payload.publishAt ?? null,
                });
              } else {
                failCount++;
                if (res?.error) {
                  handleNetworkError(res.error);
                }
                if (reservationId) {
                  try {
                    await releaseQuota(reservationId);
                    uploadReleasedCount += 1;
                  } catch (err) {
                    console.error('Failed to release upload quota:', err);
                  }
                }
                const isDailyLimit = isYoutubeDailyLimitError(res);
                if (isDailyLimit) {
                  setYoutubeLimitWarning(t('youtubeUploadLimitReached'));
                  sawLimitError = true;
                  setYoutubeDailyLimitModalOpen(true);
                  await upsertJobRunForPlatform({
                    row,
                    platform: 'youtube',
                    ok: false,
                    error: t('youtubeDailyLimitBlockedStatus'),
                    publishAtUtcMs: payload.publishAt ?? null,
                  });
                  updateRow(row.id, (r) => {
                    const upload = { ...(r.upload || {}) };
                    if (upload.youtube) {
                      delete upload.youtube;
                    }
                    return { ...r, upload };
                  });
                  // Release reservations for remaining rows (do not charge)
                  for (let j = uploadIdx + 1; j < uploadTargets.length; j++) {
                    const rid = uploadReservations?.get(uploadTargets[j].filePath);
                    if (rid) {
                      try {
                        await releaseQuota(rid);
                        uploadReleasedCount += 1;
                      } catch (err) {
                        console.error('Failed to release upload quota:', err);
                      }
                    }
                  }
                  break;
                }
                await upsertJobRunForPlatform({
                  row,
                  platform: 'youtube',
                  ok: false,
                  error: res?.error || t('uploadFailed'),
                  publishAtUtcMs: payload.publishAt ?? null,
                });
              }
              updateRow(row.id, (r) => {
                const upload = { ...(r.upload || {}) };
                if (upload.youtube) {
                  delete upload.youtube;
                }
                return { ...r, upload };
              });
            } catch (e) {
              failCount++;
              handleNetworkError(e);
              console.error(`Failed to upload ${row.filename}:`, e);
              if (reservationId) {
                try {
                  await releaseQuota(reservationId);
                  uploadReleasedCount += 1;
                } catch (err) {
                  console.error('Failed to release upload quota:', err);
                }
              }
              const errText = String(e);
              const isDailyLimit = /daily upload limit|upload limit|verify your account|phone verification|youtube verification|exceeded the number of videos|verification required|channel verification/i.test(errText);
              if (isDailyLimit) {
                setYoutubeLimitWarning(t('youtubeUploadLimitReached'));
                sawLimitError = true;
                setYoutubeDailyLimitModalOpen(true);
                const jobsForRowNow = getJobsForRow(row);
                const ytJobNow = jobsForRowNow.find((j) => Boolean(j.targets?.youtube));
                const publishAtMsNow = typeof ytJobNow?.publishAtUtcMs === 'number' ? ytJobNow.publishAtUtcMs : null;
                await upsertJobRunForPlatform({
                  row,
                  platform: 'youtube',
                  ok: false,
                  error: t('youtubeDailyLimitBlockedStatus'),
                  publishAtUtcMs: publishAtMsNow ?? null,
                });
                updateRow(row.id, (r) => {
                  const upload = { ...(r.upload || {}) };
                  if (upload.youtube) {
                    delete upload.youtube;
                  }
                  return { ...r, upload };
                });
                for (let j = uploadIdx + 1; j < uploadTargets.length; j++) {
                  const rid = uploadReservations?.get(uploadTargets[j].filePath);
                  if (rid) {
                    try {
                      await releaseQuota(rid);
                      uploadReleasedCount += 1;
                    } catch (err) {
                      console.error('Failed to release upload quota:', err);
                    }
                  }
                }
                break;
              }
              const jobsForRowNow = getJobsForRow(row);
              const ytJobNow = jobsForRowNow.find((j) => Boolean(j.targets?.youtube));
              const publishAtMsNow = typeof ytJobNow?.publishAtUtcMs === 'number' ? ytJobNow.publishAtUtcMs : null;
              await upsertJobRunForPlatform({
                row,
                platform: 'youtube',
                ok: false,
                error: String(e),
                publishAtUtcMs: publishAtMsNow ?? null,
              });
              updateRow(row.id, (r) => {
                const upload = { ...(r.upload || {}) };
                if (upload.youtube) {
                  delete upload.youtube;
                }
                return { ...r, upload };
              });
            }
          }
          
          if (latestSnapshot) {
            setUsageSnapshot(latestSnapshot);
          }

          const releasedNote = uploadReleasedCount > 0
            ? ` ${t('uploadCreditsReleased', { count: uploadReleasedCount })}`
            : '';
          if (successCount > 0 && failCount === 0) {
            setSnack(t('uploadedSuccessCountToPlatform', { count: successCount, platform: platformLabels.youtube }));
          } else if (successCount > 0 && failCount > 0) {
            setSnack(`${t('uploadedWithFailures', { successCount, failCount })}${releasedNote}`);
            hasError = true;
          } else {
            if (sawLimitError) {
              const msg = t('youtubeDailyLimitUploadsPaused');
              setSnack(`${msg}${releasedNote || ` ${t('uploadCreditsReleased', { count: uploadTargets.length })}`}`);
              setYoutubeLimitWarning(t('youtubeUploadLimitReachedAll'));
            } else {
              const baseMsg = t('failedToUploadCountToPlatform', { count: failCount, platform: platformLabels.youtube });
              const fallbackRelease = uploadReservations ? ` ${t('uploadCreditsReleased', { count: uploadReservations.size })}` : '';
              setSnack(`${baseMsg}${releasedNote || fallbackRelease}`);
            }
            hasError = true;
          }
        }
      } catch (e: any) {
        handleNetworkError(e);
        console.error('YouTube upload error:', e);
        let releasedCount = 0;
        if (uploadReservations) {
          const reservationIds = Array.from(uploadReservations.values());
          releasedCount = reservationIds.length;
          await Promise.all(
            reservationIds.map((reservationId) => releaseQuota(reservationId).catch(() => null)),
          );
        }
        // Extract error message from YouTube API or IPC error
        // IPC errors may have the message nested: "Error invoking remote method 'youtube:upload': Error: ..."
        let errorMsg = e?.message || String(e);
        // Extract the actual error message if it's wrapped in IPC error
        if (errorMsg.includes('Error invoking remote method')) {
          const match = errorMsg.match(/Error: (.+)$/);
          if (match && match[1]) {
            errorMsg = match[1];
          }
        }
        
        let userFriendlyMsg = t('uploadFailedToPlatform', { platform: platformLabels.youtube });
        const isDailyLimit = /daily upload limit|upload limit|verify your account|phone verification|youtube verification|exceeded the number of videos|verification required|channel verification/i.test(errorMsg);
        if (isDailyLimit) {
          userFriendlyMsg = t('youtubeUploadLimitReached');
          setYoutubeLimitWarning(userFriendlyMsg);
          setYoutubeDailyLimitModalOpen(true);
        } else if (errorMsg.includes('quota')) {
          userFriendlyMsg = t('youtubeQuotaExceeded');
        } else if (errorMsg.includes('Not connected')) {
          userFriendlyMsg = t('youtubeNotConnectedPrompt');
        }
        
        const suffix = releasedCount > 0 ? ` ${t('uploadCreditsReleased', { count: releasedCount })}` : '';
        setSnack(`${userFriendlyMsg}${suffix}`);
        hasError = true;
      }
    }

    // NOTE: IG/TT publish/reminder creation has been removed from Publish flow.

    if (!hasError) {
      const skippedParts: string[] = [];
      if (ytSkippedDone > 0) {
        skippedParts.push(t('publishSkippedAlreadyPosted', { platform: platformLabels.youtube, count: ytSkippedDone }));
      }
      const base = t('operationsCompleted');
      setSnack(skippedParts.length ? `${base}. ${skippedParts.join(' • ')}` : base);
    }
  }, [
    generateMetadata,
    getJobsForRow,
    guardUploadAndScheduleAccess,
    handleBillingError,
    handleNetworkError,
    loadJobs,
    requireOnline,
    reserveQuotaForRows,
    setScheduledJobs,
    t,
    updateRow,
    upsertJobRunForPlatform,
  ]);

  const resolveAutoScheduleCollisions = (allRows: JobRow[]) => {
    // If a user manually occupies a slot that an AUTO row used,
    // push the AUTO row(s) forward to the next free slot (never pull earlier).
    // This keeps the schedule stable and avoids duplicate publish times.
    if (!autoEnabled) return allRows;

    const requestedPerDay = Math.max(1, Number.isFinite(videosPerDay) ? videosPerDay : 1);
    const perDay = Math.max(1, Math.min(requestedPerDay, slotsMinutes.length || 1));
    const daySlots = slotsMinutes.slice(0, perDay);
    if (!daySlots.length) return allRows;

    const minuteKey = (ms: number) => Math.floor(ms / 60_000);

    // manual (and any non-auto) rows are "fixed" and reserve their slots
    const occupied = new Set<number>();
    for (const r of allRows) {
      if (r.publishMode !== 'schedule') continue;
      if (typeof r.publishAt !== 'number') continue;
      if (r.publishSource === 'auto') continue;
      occupied.add(minuteKey(r.publishAt));
    }

    // Keep ordering stable: sort autos by their current publishAt, then by original list order.
    const indexById = new Map<string, number>();
    allRows.forEach((r, i) => indexById.set(r.id, i));

    const autos = allRows
      .filter((r) => r.publishMode === 'schedule' && r.publishSource === 'auto')
      .slice()
      .sort((a, b) => {
        const ta = typeof a.publishAt === 'number' ? a.publishAt : Number.POSITIVE_INFINITY;
        const tb = typeof b.publishAt === 'number' ? b.publishAt : Number.POSITIVE_INFINITY;
        if (ta !== tb) return ta - tb;
        return (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0);
      });

    const updates = new Map<string, number | null>();

    for (const r of autos) {
      const cur = typeof r.publishAt === 'number' ? r.publishAt : null;

      // If the current slot isn't occupied by a manual/non-auto row (or a previously assigned auto), keep it.
      if (cur != null && !occupied.has(minuteKey(cur))) {
        occupied.add(minuteKey(cur));
        continue;
      }

      // Otherwise, find the next free slot strictly AFTER the current time (or schedule start date for null).
      let cursor = (cur ?? Date.now()) - 1;
      // If no current publishAt, use schedule start date if set
      if (cur == null && scheduleStartDate) {
        const dateParts = scheduleStartDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dateParts) {
          const year = Number(dateParts[1]);
          const month = Number(dateParts[2]);
          const day = Number(dateParts[3]);
          const firstSlot = daySlots[0] ?? 9 * 60;
          const hour = Math.floor(firstSlot / 60);
          const minute = firstSlot % 60;
          const startEpoch = zonedComponentsToUtcEpoch({ year, month, day, hour, minute }, getIanaTimeZone(timeZoneId));
          if (startEpoch != null && startEpoch > Date.now()) {
            cursor = startEpoch - 1;
          }
        }
      }
      let next = nextSlotAfter(cursor, getIanaTimeZone(timeZoneId), daySlots);
      let guard = 0;
      while (next != null && occupied.has(minuteKey(next))) {
        cursor = next + 60_000 - 1;
        next = nextSlotAfter(cursor, getIanaTimeZone(timeZoneId), daySlots);
        guard += 1;
        if (guard > 10_000) {
          console.warn('[schedule] collision resolver: too many occupied slots; aborting');
          next = null;
          break;
        }
      }

      updates.set(r.id, next);
      if (next != null) occupied.add(minuteKey(next));
    }

    if (!updates.size) return allRows;

    return allRows.map((r) => (updates.has(r.id) ? { ...r, publishAt: updates.get(r.id)! } : r));
  };

  // Keep schedule collision-free even when rows are loaded/modified in bulk
  // (e.g., future import/restore features) or when user changes schedule settings.
  React.useEffect(() => {
    if (!autoEnabled) return;
    // Resolve auto-schedule collisions - use updateRows to maintain referential stability
    updateRows((prev) => {
      const allRows = Array.from(prev.values());
      const resolved = resolveAutoScheduleCollisions(allRows);
      const resolvedMap = new Map(resolved.map(r => [r.id, r]));
      
      // Only update if there are actual changes
      let hasChanges = false;
      for (const [id, resolvedRow] of resolvedMap.entries()) {
        const currentRow = prev.get(id);
        if (currentRow && (
          currentRow.publishAt !== resolvedRow.publishAt ||
          currentRow.publishMode !== resolvedRow.publishMode ||
          currentRow.publishSource !== resolvedRow.publishSource
        )) {
          hasChanges = true;
          break;
        }
      }
      
      return hasChanges ? resolvedMap : prev;
    });
  }, [autoEnabled, timeZoneId, videosPerDay, slotsMinutes, scheduleSig]);

  const setSelectedPatch = (patch: Partial<JobRow>) => {
    if (!selectedRow) return;
    
    // Update selected row - use updateRow to maintain referential stability
    updateRow(selectedRow.id, (r) => ({ ...r, ...patch }));
    
    // If the user changed scheduling-related fields, auto rows may need to shift
    // to avoid collisions with the new manual slot.
    const touchesSchedule =
      Object.prototype.hasOwnProperty.call(patch, 'publishAt') ||
      Object.prototype.hasOwnProperty.call(patch, 'publishMode') ||
      Object.prototype.hasOwnProperty.call(patch, 'publishSource');

    if (touchesSchedule) {
      // Resolve collisions for all rows - use updateRows to maintain referential stability
      updateRows((prev) => {
        const allRows = Array.from(prev.values());
        const resolved = resolveAutoScheduleCollisions(allRows);
        const resolvedMap = new Map(resolved.map(r => [r.id, r]));
        
        // Only update if there are actual changes
        let hasChanges = false;
        for (const [id, resolvedRow] of resolvedMap.entries()) {
          const currentRow = prev.get(id);
          if (currentRow && (
            currentRow.publishAt !== resolvedRow.publishAt ||
            currentRow.publishMode !== resolvedRow.publishMode ||
            currentRow.publishSource !== resolvedRow.publishSource
          )) {
            hasChanges = true;
            break;
          }
        }
        
        return hasChanges ? resolvedMap : prev;
      });
    }
  };

  // Hash-based routing for Assist Center / Overlay (supports both "#foo" and "#/foo")
  const normalizeHash = React.useCallback((raw: string): string => {
    if (!raw) return '';
    const cleaned = raw.replace(/^#\/?/, '');
    if (!cleaned) return '';
    return `#/${cleaned}`;
  }, []);

  const [hash, setHash] = React.useState(() => normalizeHash(window.location.hash));
  React.useEffect(() => {
    const handleHashChange = () => setHash((prev) => normalizeHash(window.location.hash || prev));
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [normalizeHash]);

  // Show Assist Center if hash matches
  if (hash === '#/assist-overlay') {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AssistOverlay />
      </ThemeProvider>
    );
  }

  if (hash === '#/assist-center') {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AssistCenter />
      </ThemeProvider>
    );
  }

  const showSignInBanner = !entitlementLoading && !planAccess.isSignedIn;
  const showUpgradeBanner = !entitlementLoading && planAccess.isSignedIn && !planAccess.isActive;
  const canManageBilling = Boolean(subscriptionInfo?.customer_id || subscriptionInfo?.id);
  const limitSnapshot = limitDialog.snapshot ?? usageSnapshot;
  const limitUsed = limitDialog.kind === 'metadata'
    ? (limitSnapshot?.metadata_used ?? 0)
    : (limitSnapshot?.uploads_used ?? 0);
  const limitCap = limitDialog.kind === 'metadata'
    ? (limitSnapshot?.metadata_limit ?? null)
    : (limitSnapshot?.uploads_limit ?? null);
  const limitCapLabel = limitCap == null ? 'Unlimited' : String(limitCap);
  const limitTitle = limitDialog.kind === 'metadata' ? 'Metadata limit reached' : 'Upload limit reached';
  const billingGateTitle = billingGateReason === 'sign_in'
    ? 'Sign in required'
    : billingGateReason === 'not_subscribed'
    ? 'No active plan'
    : billingGateReason === 'limit_exceeded'
    ? 'Limit reached'
    : billingGateReason === 'reconnect_required'
    ? t('reconnectRequiredTitle')
    : '';
  const billingGateBody = billingGateReason === 'sign_in'
    ? 'Please sign in to continue.'
    : billingGateReason === 'not_subscribed'
    ? 'No active plan. Please subscribe or upgrade to continue.'
    : billingGateReason === 'limit_exceeded'
    ? 'Limit reached for this billing period. Upgrade to continue.'
    : billingGateReason === 'reconnect_required'
    ? t('reconnectRequiredBody')
    : '';
  const billingGateActionLabel = billingGateReason === 'sign_in' ? 'Sign in' : 'Upgrade';
  const billingGateShowActionButton = billingGateReason !== 'reconnect_required';

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <UpdateBanner />
      {networkStatus === 'offline' && (
        <Box
          sx={{
            position: 'fixed',
            top: 12,
            left: 12,
            right: 12,
            zIndex: 9998,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          <Alert
            severity="warning"
            action={
              <Button color="inherit" size="small" onClick={handleOfflineRetry}>
                Retry
              </Button>
            }
          >
            <AlertTitle>You're offline</AlertTitle>
            Internet connection is required for sign-in, metadata, billing checks, and uploads.
          </Alert>
          {limitedMode && (
            <Alert severity="info">
              {t('reconnectRequiredBody')}
            </Alert>
          )}
        </Box>
      )}
      {showSignInBanner && (
        <Box
          sx={{
            position: 'fixed',
            bottom: authDeepLinkUrl ? 56 : 12,
            left: 12,
            right: 12,
            zIndex: 9997,
          }}
        >
          <Alert
            severity="info"
            action={
              <Button color="inherit" size="small" onClick={() => setAccountDialogOpen(true)}>
                {t('signInWithGoogle')}
              </Button>
            }
          >
            {t('signInToEnableUploadSchedule')}
          </Alert>
        </Box>
      )}
      {showUpgradeBanner && (
        <Box
          sx={{
            position: 'fixed',
            bottom: authDeepLinkUrl ? 56 : showSignInBanner ? 72 : 12,
            left: 12,
            right: 12,
            zIndex: 9997,
          }}
        >
          <Alert
            severity="info"
            action={
              <Button color="inherit" size="small" onClick={handleUpgrade}>
                {t('upgrade')}
              </Button>
            }
          >
            {t('upgradeRequiredForUploadScheduleBanner', {
              plan: planAccess.planName,
              renewsOn: planAccess.renewsOn ?? '—',
            })}
          </Alert>
        </Box>
      )}
      <Box
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={dark ? 'dark' : ''}
        sx={{
          px: 3,
          pt: interfaceSettings.commandBarPosition === 'top' ? 0 : 1.5,
          pb: interfaceSettings.commandBarPosition === 'bottom' ? 0 : 1.5,
          zoom: uiScale,
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          // Fixed height so flex:1 content fills to bottom with same gap as sides (p:3),
          // compensating for any scale < 1 so tabs always reach the bottom.
          height: uiScale < 1 ? `calc(100vh / ${uiScale})` : '100vh',
          minHeight: uiScale < 1 ? `calc(100vh / ${uiScale})` : '100vh',
          width: '100%',
          maxWidth: '100%',
          // Enhanced animated gradient background with project colors
          background: dark
            ? 'linear-gradient(135deg, #0f172a 0%, #1e293b 25%, #312e81 50%, #1e293b 75%, #0f172a 100%)'
            : 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 25%, #c7d2fe 50%, #e2e8f0 75%, #f8fafc 100%)',
          backgroundSize: '200% 200%',
          animation: 'gradientShift 15s ease infinite',
          position: 'relative',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: dark
              ? 'radial-gradient(circle at 20% 50%, rgba(99, 102, 241, 0.1) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(139, 92, 246, 0.08) 0%, transparent 50%)'
              : 'radial-gradient(circle at 20% 50%, rgba(79, 70, 229, 0.05) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(124, 58, 237, 0.04) 0%, transparent 50%)',
            pointerEvents: 'none',
            zIndex: 0,
          },
          '& > *': {
            position: 'relative',
            zIndex: 1,
          },
        }}
      >
        {isDragging && (
          <Box
            sx={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 9999,
              background: dark
                ? 'rgba(99, 102, 241, 0.2)'
                : 'rgba(79, 70, 229, 0.15)',
              border: `4px dashed ${dark ? '#6366f1' : '#4f46e5'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <Paper
              className="gradient-animated"
              sx={{
                p: 4,
                textAlign: 'center',
                background: dark
                  ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.95) 0%, rgba(139, 92, 246, 0.95) 50%, rgba(167, 139, 250, 0.95) 100%)'
                  : 'linear-gradient(135deg, rgba(79, 70, 229, 0.95) 0%, rgba(124, 58, 237, 0.95) 50%, rgba(139, 92, 246, 0.95) 100%)',
                borderRadius: 3,
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                animation: 'subtlePulse 3s ease-in-out infinite',
              }}
            >
              <Typography variant="h4" sx={{ mb: 2, color: 'white', fontWeight: 700 }}>
                📥 {t('dragDropFiles')}
                  </Typography>
              <Typography variant="body1" sx={{ color: 'white', opacity: 0.9 }}>
                {t('dragDropFormats')}
              </Typography>
            </Paper>
          </Box>
        )}
        {/* Command Bar - conditionally rendered at top or bottom */}
        {interfaceSettings.commandBarPosition === 'top' && (
          <CommandBar
            position="top"
            onAddClick={() => setAddDialogOpen(true)}
            onPlanClick={() => {
              if (!guardUploadAndScheduleAccess()) return;
              setPlannerOpen(true);
            }}
            onPublishClick={() => {
              if (!guardUploadAndScheduleAccess()) return;
              setPublishDialogOpen(true);
            }}
            disablePlanAndPublish={!planAccess.isActive}
            youtubeConnected={ytConnected}
            metadataQueueCounts={metadataQueueCounts}
            onStopCurrentMetadata={handleStopCurrentMetadata}
            onCancelQueuedMetadata={handleCancelQueuedMetadata}
            onStopAllMetadata={() => void stopAllMetadataJobs('user')}
            onInterfaceClick={() => setInterfaceDialogOpen(true)}
            onAccountClick={() => setAccountDialogOpen(true)}
            onCustomAIClick={() => setCustomAIDialogOpen(true)}
            onDiagnosticsClick={() => setDiagnosticsDialogOpen(true)}
            onDeveloperModeClick={() => setDeveloperModeDialogOpen(true)}
          onTestConnection={async () => {
            try {
              const validation: any = await window.api?.youtubeValidateCredentials?.();
              if (validation?.ok) {
                setSnack(t('credentialsOk', { clientId: validation.clientIdPrefix, file: validation.filePath }));
              } else {
                const message = validation?.message || t('credentialsNotFound');
                setSnack(t('credentialsValidationFailedWithMessage', { message }));
              }
            } catch (e) {
              console.error(e);
              setSnack(t('failedToCheckCredentials'));
            }
          }}
          onReconnect={async () => {
            try {
              const msg = await window.api?.youtubeConnect?.();
              if (msg?.ok) {
                setSnack(t('reconnectedToPlatform', { platform: platformLabels.youtube }));
              } else {
                setSnack(t('reconnectFailed', { message: msg?.message || t('unknownError') }));
              }
              void refreshYtConnected();
            } catch (e) {
              console.error(e);
              setSnack(t('failedToReconnect'));
            }
          }}
          onDisconnect={disconnectYouTube}
          dark={dark}
          />
        )}

        <AddDialog
          open={addDialogOpen}
          onClose={() => setAddDialogOpen(false)}
          onAddFiles={addByFiles}
          onAddFolder={addByFolder}
        />

        {/* New Planner Dialog */}
        <PlannerDialog
          open={plannerOpen}
          onClose={() => setPlannerOpen(false)}
          autoPlanEnabled={autoEnabled}
          onAutoPlanEnabledChange={setAutoEnabled}
          onSaveDefaults={(d) => {
            // Keep Auto Plan defaults in sync with what user edits in the Plan dialog.
            // d.timeZoneId is a label, keep it as label in state
            setAutoPlanApplyTo(d.applyTo === 'all' ? 'all' : d.applyTo);
            setTimesCsv(d.times.join(' '));
            setVideosPerDay(Math.max(1, d.videosPerDay));
            const y = d.startDate.getFullYear();
            const m = String(d.startDate.getMonth() + 1).padStart(2, '0');
            const dd = String(d.startDate.getDate()).padStart(2, '0');
            setScheduleStartDate(`${y}-${m}-${dd}`);
            if (d.timeZoneId !== timeZoneId) setTimeZoneId(d.timeZoneId);
            // Persist plan settings to localStorage (save as label)
            try {
              localStorage.setItem('planSettings_times', JSON.stringify(d.times));
              localStorage.setItem('planSettings_timeZoneId', d.timeZoneId);
              localStorage.setItem('planSettings_startDate', `${y}-${m}-${dd}`);
              localStorage.setItem('planSettings_applyTo', d.applyTo);
            } catch {
              // ignore
            }
          }}
          onApply={async (plan) => {
            if (!guardUploadAndScheduleAccess()) return;
            // Check if videos are selected (like PublishDialog)
            if (selectedIds.length === 0) {
              setSnack(t('selectAtLeastOneVideo'));
              return;
            }

            // Save to history before applying plan
            await saveToHistory(true);

            // Apply plan to selected items only
            if (plan.times && plan.times.length > 0) {
              // IMPORTANT: Apply must use the plan values immediately.
              // Using setState + rescheduleAll() causes scheduling to run with stale settings.

              // plan.timeZoneId is a label, convert to IANA for functionality
              const planTzLabel = plan.timeZoneId;
              const planTzIana = getIanaTimeZone(planTzLabel);
              const planSlots = parseTimesCsv(plan.times.join(' '));
              const requestedPerDay = Math.max(1, Number.isFinite(plan.videosPerDay) ? (plan.videosPerDay as number) : planSlots.length || 1);
              const perDay = Math.max(1, Math.min(requestedPerDay, planSlots.length || 1));
              const daySlots = planSlots.slice(0, perDay);
              const applyTo = (plan as any).applyTo as ('all' | 'youtube' | 'instagram' | 'tiktok' | undefined);
              const scope: 'all' | MetaPlatform = applyTo === 'instagram' || applyTo === 'tiktok' || applyTo === 'youtube' ? applyTo : 'all';

              const ymd = (d: Date) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${dd}`;
              };

              // Update global schedule settings (UI), but scheduling uses plan variables below.
              setTimesCsv(plan.times.join(' '));
              setVideosPerDay(perDay);
              if (plan.startDate) {
                setScheduleStartDate(ymd(plan.startDate));
              }
              if (planTzLabel !== timeZoneId) {
                setTimeZoneId(planTzLabel);
              }

              // Apply plan to selected rows, using current grid order (sortedRows). Exclude archived rows.
              const indexById = new Map(sortedRows.map((r, i) => [r.id, i]));
              const targetSet = new Set(selectedIds);
              const selectedInOrder = rows
                .filter((r) => targetSet.has(r.id) && r.archivedAt == null)
                .slice()
                .sort((a, b) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0));

              // Decide which platforms will be scheduled per row, and which targets should be auto-enabled (2A).
              const desiredPlatformsByFile = new Map<string, MetaPlatform[]>();
              const nextTargetsByRowId = new Map<string, { youtube: boolean; instagram: boolean; tiktok: boolean }>();
              const allPlatformsSet = new Set<MetaPlatform>();

              for (const r of selectedInOrder) {
                const curTargets = r.targets ?? { youtube: false, instagram: false, tiktok: false };
                if (scope === 'all') {
                  // "All" means ALWAYS all 3 platforms (YouTube, Instagram, TikTok)
                  const platforms: MetaPlatform[] = ['youtube', 'instagram', 'tiktok'];
                  desiredPlatformsByFile.set(r.filePath, platforms);
                  platforms.forEach((p) => allPlatformsSet.add(p));
                  // Enable all 3 targets when "All" is selected
                  nextTargetsByRowId.set(r.id, { youtube: true, instagram: true, tiktok: true });
                } else {
                  desiredPlatformsByFile.set(r.filePath, [scope]);
                  allPlatformsSet.add(scope);
                  // auto-enable selected platform
                  nextTargetsByRowId.set(r.id, { ...curTargets, [scope]: true } as any);
                }
              }

              const selectedFilePaths = new Set(selectedInOrder.map((r) => r.filePath));

              // Slots occupied by scheduled jobs for the relevant platforms (keep other items stable)
              const minuteKey = (ms: number) => Math.floor(ms / 60_000);
              const occupied = new Set<number>();
              for (const j of scheduledJobs) {
                if (!j || !j.filePath) continue;
                const inSelection = selectedFilePaths.has(j.filePath);
                if (scope === 'all') {
                  // We overwrite all jobs for selected files
                  if (inSelection) continue;
                  const hits = (['youtube', 'instagram', 'tiktok'] as MetaPlatform[]).some((p) => allPlatformsSet.has(p) && (j.targets?.[p] ?? false));
                  if (!hits) continue;
                } else {
                  // We overwrite only this platform for selected files
                  if (inSelection && (j.targets?.[scope] ?? false)) continue;
                  if (!(j.targets?.[scope] ?? false)) continue;
                }
                const ms = Number(j.publishAtUtcMs);
                if (!Number.isFinite(ms)) continue;
                occupied.add(minuteKey(ms));
              }

              // Build cursor start from plan.startDate (first slot)
              let cursor = Date.now();
              if (plan.startDate) {
                const year = plan.startDate.getFullYear();
                const month = plan.startDate.getMonth() + 1;
                const day = plan.startDate.getDate();
                const firstSlot = daySlots[0] ?? 9 * 60;
                const hour = Math.floor(firstSlot / 60);
                const minute = firstSlot % 60;
                const startEpoch = zonedComponentsToUtcEpoch({ year, month, day, hour, minute }, planTzIana);
                if (startEpoch != null) {
                  cursor = Math.max(cursor, startEpoch);
                }
              }

              const updates = new Map<string, number>();
              for (const r of selectedInOrder) {
                let guard = 0;
                let next = nextSlotAfter(cursor - 1, planTzIana, daySlots);
                while (next != null && occupied.has(minuteKey(next))) {
                  cursor = next + 60_000;
                  next = nextSlotAfter(cursor - 1, planTzIana, daySlots);
                  guard += 1;
                  if (guard > 10_000) {
                    next = null;
                    break;
                  }
                }
                if (next == null) break;
                updates.set(r.id, next);
                occupied.add(minuteKey(next));
                cursor = next + 60_000;
              }

              // Build next scheduledJobs (overwrite per scope, 2B)
              let nextJobs = scheduledJobs.slice();
              if (scope === 'all') {
                nextJobs = nextJobs.filter((j) => !selectedFilePaths.has(j.filePath));
              } else {
                nextJobs = nextJobs.filter((j) => !(selectedFilePaths.has(j.filePath) && (j.targets?.[scope] ?? false)));
              }

              for (const r of selectedInOrder) {
                const ms = updates.get(r.id);
                if (!ms) continue;
                const platforms = desiredPlatformsByFile.get(r.filePath) ?? (scope === 'all' ? [] : [scope]);
                for (const p of platforms) {
                  const tForJob = { youtube: false, instagram: false, tiktok: false, [p]: true } as any;
                  nextJobs.push({
                    id: newId(),
                    filePath: r.filePath,
                    publishAtUtcMs: ms,
                    targets: tForJob,
                    visibility: r.visibility || 'private',
                    selfDeclaredMadeForKids: r.selfDeclaredMadeForKids ?? false,
                    createdAt: Date.now(),
                  } as ScheduledJob);
                }
              }

              setScheduledJobs(nextJobs);

              // Update rows to reflect: (a) enabled targets (2A), (b) plan time, (c) "plan" column shows earliest job time.
              const earliestByFile = new Map<string, number>();
              for (const j of nextJobs) {
                const ms = Number(j.publishAtUtcMs);
                if (!Number.isFinite(ms)) continue;
                const cur = earliestByFile.get(j.filePath);
                earliestByFile.set(j.filePath, cur == null ? ms : Math.min(cur, ms));
              }

              // Update rows with plan - use updateRows to maintain referential stability
              updateRows((prev) => {
                let hasChanges = false;
                const next = new Map(prev);
                
                for (const row of prev.values()) {
                  if (!targetSet.has(row.id)) continue;
                  const enabledTargets = nextTargetsByRowId.get(row.id) ?? row.targets;
                  const earliest = earliestByFile.get(row.filePath) ?? updates.get(row.id);
                  
                  const targetsChanged = JSON.stringify(row.targets) !== JSON.stringify(enabledTargets);
                  const publishAtChanged = row.publishAt !== earliest;
                  const publishModeChanged = row.publishMode !== 'schedule';
                  
                  if (targetsChanged || publishAtChanged || publishModeChanged) {
                    next.set(row.id, {
                      ...row,
                      targets: enabledTargets,
                      publishMode: 'schedule' as const,
                      publishAt: earliest ?? row.publishAt,
                      publishSource: 'manual' as const,
                    });
                    hasChanges = true;
                  }
                }
                
                return hasChanges ? next : prev;
              });

              setSnack(t('planAppliedWithCount', { count: selectedIds.length }));
            } else {
              setSnack(t('noTimesInPlan'));
            }
          }}
          timeZoneId={timeZoneId}
          timeZoneOptions={tzOptions}
          systemTimeZone={systemTz}
          onTimeZoneChange={setTimeZoneId}
          unscheduledCount={Array.from(rowsById.values()).filter(r => r.archivedAt == null && (!r.publishAt || r.publishMode !== 'schedule')).length}
          selectedCount={selectedIds.length}
        />

        {/* Interface Dialog */}
        <SettingsDialog
          open={interfaceDialogOpen}
          onClose={() => setInterfaceDialogOpen(false)}
          interfaceSettings={interfaceSettings}
          onChangeInterfaceSettings={updateInterfaceSettings}
          dark={dark}
          onDarkChange={(v) => {
            setDark(v);
            localStorage.setItem('theme', v ? 'dark' : 'light');
          }}
          uiScale={uiScale}
          onUiScaleChange={setUiScale}
          lang={uiLanguage}
          onLangChange={async (v) => {
            setUiLanguage(v);
            await i18n.changeLanguage(v);
            try {
              const languageOption = UI_LANGUAGE_OPTIONS.find((option) => option.code === v);
              const uiLanguageLabel = languageOption?.label || v;
              await window.api?.settingsSet?.({ uiLanguage: v, uiLanguageLabel });
            } catch (e) {
              console.error('Failed to persist UI language:', e);
            }
          }}
        />

        {/* Account Dialog */}
        <AccountDialog
          open={accountDialogOpen}
          onClose={() => setAccountDialogOpen(false)}
          onSnack={setSnack}
          onRequireOnline={() => requireOnline()}
          onNetworkError={handleNetworkError}
          supabaseUser={supabaseUser}
          networkStatus={networkStatus}
          entitlement={entitlement ?? (supabaseUser ? { plan: 'try_free', status: 'inactive' } : null)}
          subscription={subscriptionInfo}
          usageSnapshot={usageSnapshot}
          usageLoading={usageLoading}
          onSignOut={() => {
            setAuthEntitlement({
              ...INITIAL_AUTH_ENTITLEMENT,
              authState: 'signedOut',
            });
            setSupabaseUser(null);
            setEntitlement(null);
            setSubscriptionInfo(null);
            setUsageSnapshot(null);
            setUsageLoading(false);
            void window.api?.authSetSupabaseAccessToken?.('');
          }}
        />

        <Dialog
          open={offlineDialogOpen}
          onClose={closeOfflineDialog}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>Internet connection required</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Reconnect to the internet and try again.
            </Typography>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={closeOfflineDialog} variant="outlined">
              Close
            </Button>
            <Button onClick={handleOfflineRetry} variant="contained">
              Retry
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={Boolean(billingGateReason)}
          onClose={() => setBillingGateReason(null)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>{billingGateTitle}</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {billingGateBody}
            </Typography>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setBillingGateReason(null)} variant="outlined">
              Close
            </Button>
            {billingGateReason && billingGateShowActionButton && (
              <Button
                variant="contained"
                onClick={() => {
                  setBillingGateReason(null);
                  if (billingGateReason === 'sign_in') {
                    setAccountDialogOpen(true);
                  } else {
                    handleUpgrade();
                  }
                }}
              >
                {billingGateActionLabel}
              </Button>
            )}
          </DialogActions>
        </Dialog>

        <Dialog
          open={limitDialog.open}
          onClose={() => setLimitDialog((prev) => ({ ...prev, open: false }))}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>{limitTitle}</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              You have used {limitUsed} of {limitCapLabel} this period.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Upgrade to continue.
            </Typography>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            {canManageBilling && (
              <Button variant="outlined" onClick={handleManageBilling}>
                Manage billing
              </Button>
            )}
            <Button onClick={() => setLimitDialog((prev) => ({ ...prev, open: false }))}>
              Close
            </Button>
            <Button variant="contained" onClick={handleUpgrade}>
              Upgrade
            </Button>
          </DialogActions>
        </Dialog>

        {/* Diagnostics Dialog */}
        <DiagnosticsDialog
          open={diagnosticsDialogOpen}
          onClose={() => setDiagnosticsDialogOpen(false)}
          youtubeConnected={ytConnected}
          autoUploadEnabled={autoEnabled}
          silentMode={silentMode}
          jobsCount={rowsById.size}
          processingCount={Array.from(rowsById.values()).filter((r) => r.status === 'Processing').length}
          signedIn={Boolean(supabaseUser)}
          userEmail={supabaseUser?.email ?? null}
          plan={entitlement?.plan ?? null}
          subscriptionStatus={entitlement?.status ?? null}
          usageSnapshot={usageSnapshot}
          onSnack={setSnack}
        />

        {/* Developer Mode Dialog */}
        <CustomAIDialog
          open={customAIDialogOpen}
          onClose={() => setCustomAIDialogOpen(false)}
          customInstructions={customInstructions}
          onCustomInstructionsChange={async (instructions) => {
            setCustomInstructions(instructions);
            try {
              if (window.api?.metadataGetCustomAiSettings && window.api?.metadataSetCustomAiSettings) {
                const current = await window.api.metadataGetCustomAiSettings();
                const nextInstructions = typeof instructions === 'string'
                  ? { all: instructions, youtube: '', instagram: '', tiktok: '' }
                  : instructions;
                await window.api.metadataSetCustomAiSettings({
                  ...current,
                  customInstructions: nextInstructions,
                });
              } else {
                await window.api?.metadataSetCustomInstructions?.(instructions);
              }
            } catch (e) {
              console.error('Failed to save custom instructions:', e);
            }
          }}
          onSnack={setSnack}
        />
        <DeveloperModeDialog
          open={developerModeDialogOpen}
          onClose={() => {
            setDeveloperModeDialogOpen(false);
            window.api?.getDeveloperOptions?.().then((opts) => {
              if (opts && typeof opts === 'object') {
                const on = Boolean(opts.autoArchivePosted);
                setAutoArchiveEnabledFromSettings(on);
                if (!on) setShowArchived(false);
              }
            }).catch(() => {});
          }}
          onSnack={setSnack}
          onOpenUserData={async () => {
            try {
              await window.api?.youtubeOpenUserData?.();
              setSnack(t('openedUserDataFolder'));
            } catch (e) {
              console.error(e);
              setSnack(t('failedToOpenUserDataFolder'));
            }
          }}
          onOpenOutputs={async () => {
            try {
              await window.api?.openOutputsRoot?.();
              setSnack(t('openedOutputsFolder'));
            } catch (e) {
              console.error(e);
              setSnack(t('failedToOpenOutputsFolder'));
            }
          }}
        />

        {/* Open Editor (All platforms) Dialog */}
        <OpenEditorAllDialog
          open={openEditorAllDialogOpen}
          onClose={() => setOpenEditorAllDialogOpen(false)}
          selectedRow={selectedRow}
          onSnack={setSnack}
        />

        {/* Set Targets Dialog */}
        <TemplateDialog
          open={templateDialogOpen}
          onClose={() => setTemplateDialogOpen(false)}
          onApply={async (template) => {
            try {
              // Determine target rows: selectedRow if in DetailsPanel, or selectedIds if in Bulk Actions
              const targetRows = selectedRow 
                ? [selectedRow]
                : Array.from(rowsById.values()).filter((r) => selectedIds.includes(r.id));
              
              if (targetRows.length === 0) {
                setSnack(t('noItemsSelected'));
                return;
              }

              // Apply template metadata to each row - use updateRow to maintain referential stability
              for (const targetRow of targetRows) {
                updateRow(targetRow.id, (r) => {
                  // Merge template metadata with existing metadata
                  const existingMeta = r.meta?.byPlatform || {};
                  const templateMeta = template.platforms || {};
                  
                  // Merge: template overwrites existing
                  const merged: Partial<Record<MetaPlatform, any>> = {};
                  for (const platform of ['youtube', 'instagram', 'tiktok'] as MetaPlatform[]) {
                    const existing = existingMeta[platform] || {};
                    const fromTemplate = templateMeta[platform] || {};
                    merged[platform] = {
                      ...existing,
                      ...fromTemplate,
                      source: (existing.source || 'metadata') as MetaSource,
                    };
                  }
                  
                  return {
                    ...r,
                    meta: {
                      ...r.meta,
                      byPlatform: merged,
                    },
                  };
                });
              }
              
              // Reload outputs to refresh metadata display
              for (const row of targetRows) {
                try {
                  const res = await window.api?.readOutputsForPath?.(row.filePath);
                  if (res?.ok && res.metadata) {
                    // Metadata is already updated in state above
                  }
                } catch (e) {
                  console.error('Failed to reload outputs for', row.filePath, e);
                }
              }
              
              setSnack(t('templateApplied'));
            } catch (e: any) {
              console.error('Failed to apply template:', e);
              setSnack(t('failedToApplyTemplate', { message: e?.message || String(e) }));
            }
          }}
          onSave={async (name, platforms) => {
            try {
              const template: MetadataTemplate = {
                id: '',
                name,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                platforms,
              };
              
              const result = await window.api?.templatesSave?.(template);
              if (result?.ok) {
                // Reload templates
                const loaded = await window.api?.templatesLoad?.();
                if (Array.isArray(loaded)) {
                  setTemplates(loaded);
                }
                setSnack(t('templateSaved'));
              } else {
                throw new Error(result?.error || t('templateSaveFailed'));
              }
            } catch (e: any) {
              console.error('Failed to save template:', e);
              throw e;
            }
          }}
          onDelete={async (templateId) => {
            try {
              const result = await window.api?.templatesDelete?.(templateId);
              if (result?.ok) {
                // Reload templates
                const loaded = await window.api?.templatesLoad?.();
                if (Array.isArray(loaded)) {
                  setTemplates(loaded);
                }
                setSnack(t('templateDeleted'));
              } else {
                throw new Error(result?.error || t('templateDeleteFailed'));
              }
            } catch (e: any) {
              console.error('Failed to delete template:', e);
              throw e;
            }
          }}
          templates={templates}
          currentMetadata={selectedRow?.meta?.byPlatform}
        />


        {/* New Publish Dialog */}
        <PublishDialog
          open={publishDialogOpen}
          onClose={() => setPublishDialogOpen(false)}
          autoUploadEnabled={autoUploadEnabled}
          onAutoUploadEnabledChange={setAutoUploadEnabled}
          silentMode={silentMode}
          onSilentModeChange={setSilentMode}
          onPublish={async (options: PublishOptions) => {
            if (selectedIds.length === 0) {
              setSnack(t('selectAtLeastOneVideo'));
              return;
            }
            
            const target = Array.from(rowsById.values()).filter((r) => selectedIds.includes(r.id));

            if (options.preset === 'metadata-only') {
              await generateMetadata(target);
              return;
            }

            // youtube-only
            setSnack(t('publishStarted'));
            await runPublishActions(target, { generateMetadata: false, youtube: true, instagram: false, tiktok: false });
          }}
          selectedCount={selectedIds.length}
        />

        {/* Bulk Edit (Visibility + MFK) */}
        <Dialog
          open={bulkEditOpen}
          onClose={() => {
            setBulkEditOpen(false);
            setBulkEditVisibilityChoice('');
            setBulkEditMfkChoice('');
          }}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>{t('bulkEdit')}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2">
                {t('selectedCount', { count: selectedRows.length, item: selectedRows.length === 1 ? t('item') : t('items') })}
              </Typography>
              {bulkSelectedNames.length > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {bulkSelectedNames.join(', ')}
                  {selectedRows.length > bulkSelectedNames.length ? '…' : ''}
                </Typography>
              )}

              <Divider />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t('setVisibility')}
                </Typography>
                <RadioGroup
                  value={bulkEditVisibilityChoice}
                  onChange={(e) => setBulkEditVisibilityChoice(e.target.value as Visibility)}
                >
                  <FormControlLabel value="private" control={<Radio />} label={t('visibilityPrivate')} />
                  <FormControlLabel value="unlisted" control={<Radio />} label={t('visibilityUnlisted')} />
                  <FormControlLabel value="public" control={<Radio />} label={t('visibilityPublic')} />
                </RadioGroup>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t('setMadeForKids')}
                </Typography>
                <RadioGroup
                  value={bulkEditMfkChoice}
                  onChange={(e) => setBulkEditMfkChoice(e.target.value as 'true' | 'false')}
                >
                  <FormControlLabel value="true" control={<Radio />} label={t('madeForKidsYes')} />
                  <FormControlLabel value="false" control={<Radio />} label={t('madeForKidsNo')} />
                </RadioGroup>
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setBulkEditOpen(false);
                setBulkEditVisibilityChoice('');
                setBulkEditMfkChoice('');
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="contained"
              disabled={!bulkEditVisibilityChoice && !bulkEditMfkChoice}
              onClick={async () => {
                const doVisibility = Boolean(bulkEditVisibilityChoice);
                const doMfk = Boolean(bulkEditMfkChoice);
                if (!doVisibility && !doMfk) return;
                if (selectedRows.length < 2) return;

                if (doVisibility) {
                  await bulkUpdateVisibility(selectedRows, bulkEditVisibilityChoice as Visibility);
                }
                if (doMfk) {
                  await bulkUpdateMadeForKids(selectedRows, bulkEditMfkChoice === 'true');
                }

                setBulkEditOpen(false);
                setBulkEditVisibilityChoice('');
                setBulkEditMfkChoice('');
              }}
            >
              {t('apply')}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Schedule Dialog */}
        <Dialog
          open={scheduleDialogOpen}
          onClose={() => {
            setScheduleDialogOpen(false);
            setScheduleDialogRow(null);
            setScheduleDialogPlatform(null);
          }}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            {t('scheduleForPlatform', { platform: scheduleDialogPlatform ? platformLabels[scheduleDialogPlatform] : '' })}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={3} sx={{ mt: 1 }}>
              <FormControl>
                <RadioGroup
                  value={scheduleDialogMode}
                  onChange={(e) => {
                    const newMode = e.target.value as 'now' | 'assist' | 'later';
                    setScheduleDialogMode(newMode);
                    
                    // When switching to "now" for YouTube, ensure date/time is set
                    if (newMode === 'now' && scheduleDialogPlatform === 'youtube' && scheduleDialogRow) {
                      // Use publishAt from cell if available, otherwise use current time
                      const cellPublishAt = scheduleDialogRow.publishAt && typeof scheduleDialogRow.publishAt === 'number'
                        ? scheduleDialogRow.publishAt
                        : null;
                      
                      if (cellPublishAt) {
                        // Use time from cell
                        setScheduleDialogDateTime(toDateTimeLocalValue(cellPublishAt, getIanaTimeZone(timeZoneId)));
                      } else if (!scheduleDialogDateTime) {
                        // Set to current time if no time in cell and no time in dialog
                        const now = Date.now();
                        setScheduleDialogDateTime(toDateTimeLocalValue(now, getIanaTimeZone(timeZoneId)));
                      }
                    }
                  }}
                >
                  {scheduleDialogPlatform === 'youtube' && (
                    <>
                      <FormControlLabel
                        value="now"
                        control={<Radio />}
                        label={t('uploadToPlatformNow', { platform: platformLabels.youtube })}
                      />
                      <FormControlLabel
                        value="assist"
                        control={<Radio />}
                        label={t('assistToPlatformNowManual', { platform: platformLabels.youtube })}
                      />
                    </>
                  )}
                  {scheduleDialogPlatform !== 'youtube' && (
                    <FormControlLabel
                      value="now"
                      control={<Radio />}
                      label={t('openPlatformNowManual', { platform: scheduleDialogPlatform ? platformLabels[scheduleDialogPlatform] : '' })}
                    />
                  )}
                  <FormControlLabel
                    value="later"
                    control={<Radio />}
                    label={t('scheduleForLater')}
                  />
                </RadioGroup>
                </FormControl>

              {(scheduleDialogMode === 'later' || (scheduleDialogMode === 'now' && scheduleDialogPlatform === 'youtube')) && (
                <DateTimeLocalPicker
                  label={t('dateTime')}
                  value={scheduleDialogDateTime}
                  onChange={setScheduleDialogDateTime}
                  helperText={t('timeZoneWithValue', { timeZone: timeZoneId === 'SYSTEM' ? systemTzOffset : timeZoneId })}
                />
              )}

              {scheduleDialogMode === 'now' && scheduleDialogPlatform !== 'youtube' && (
                <Alert severity="info">
                  {t('scheduleManualAssistInfo', { platform: scheduleDialogPlatform ? platformLabels[scheduleDialogPlatform] : '' })}
                </Alert>
              )}
              {scheduleDialogMode === 'assist' && scheduleDialogPlatform === 'youtube' && (
                <Alert severity="info">
                  {t('scheduleManualAssistYouTubeInfo')}
                </Alert>
              )}
            </Stack>
  </DialogContent>
  <DialogActions>
            <Button
              onClick={() => {
                setScheduleDialogOpen(false);
                setScheduleDialogRow(null);
                setScheduleDialogPlatform(null);
              }}
            >
              {t('cancel')}
    </Button>
            <Button
              variant="contained"
              onClick={handleScheduleDialogSubmit}
              disabled={(scheduleDialogMode === 'later' || (scheduleDialogMode === 'now' && scheduleDialogPlatform === 'youtube')) && !scheduleDialogDateTime}
            >
              {scheduleDialogMode === 'now'
                ? scheduleDialogPlatform === 'youtube'
                  ? t('uploadNow')
                  : t('openNow')
                : scheduleDialogMode === 'assist'
                ? t('assistNow')
                : t('schedule')}
            </Button>
  </DialogActions>
</Dialog>


        {/* Legacy secondary bar - hidden, moved to Advanced */}
        <Box sx={{ display: 'none' }}>
          <Paper
            elevation={0}
            sx={{
              p: 2.5,
              mb: 3,
              borderRadius: 3,
              background: dark
                ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)'
                : 'linear-gradient(135deg, rgba(79, 70, 229, 0.05) 0%, rgba(124, 58, 237, 0.05) 100%)',
              border: `1px solid ${dark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(79, 70, 229, 0.1)'}`,
            }}
          >
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <Tooltip title={t('tooltipAdd')}>
                <span>
                  <Button
                    variant="contained"
                    onClick={add}
                    disabled={!apiOk}
                    startIcon={<Typography>📁</Typography>}
                    sx={{ minWidth: 140 }}
                  >
                    {t('add')}
                  </Button>
                </span>
              </Tooltip>
              {/* Legacy Upload button removed (Publish dialog replaces it). */}

              <Paper
                elevation={0}
                sx={{
                  px: 2,
                  py: 1,
                  borderRadius: 2,
                  bgcolor: dark ? 'rgba(99, 102, 241, 0.1)' : 'rgba(79, 70, 229, 0.08)',
                  border: `1px solid ${dark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(79, 70, 229, 0.15)'}`,
                }}
              >
              <Stack direction="row" spacing={2} alignItems="center">
                <FormControlLabel
                  control={
                    <Switch
                      checked={autoEnabled}
                      onChange={(e) => setAutoEnabled(e.target.checked)}
                      color="primary"
                    />
                  }
                  label={
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Typography>⏰</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {t('autoPlan')}
                      </Typography>
                    </Stack>
                  }
                />

          <FormControlLabel
                  control={
                    <Switch
                      checked={autoUploadEnabled}
                      onChange={(e) => setAutoUploadEnabled(e.target.checked)}
                      color="secondary"
                    />
                  }
                  label={
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Typography>🚀</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {t('autoUpload')}
                      </Typography>
                    </Stack>
                  }
                />

                {autoUploadEnabled && (
                  <FormControlLabel
                    control={
                      <Switch
                        checked={silentMode}
                        onChange={(e) => setSilentMode(e.target.checked)}
                        color="default"
                        sx={{
                          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                            backgroundColor: 'rgba(96, 165, 250, 0.9)',
                            opacity: 1,
                          },
                        }}
                      />
                    }
                    label={
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography>{silentMode ? '🔇' : '🔈'}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {t('silent')}
                        </Typography>
                      </Stack>
                    }
                  />
                )}

          <Button
            variant="outlined"
            size="small"
                  onClick={async () => {
                    try {
                      // First validate credentials
                      const validation: any = await window.api?.youtubeValidateCredentials?.();
                      if (!validation?.ok) {
                        setSnack(
                          t('credentialsValidationFailedWithMessage', {
                            message: validation?.message || t('credentialsValidationFailed'),
                          }),
                        );
                        return;
                      }
                      if (!validation?.clientIdValid) {
                        setSnack(t('invalidClientIdFormat'));
                        return;
                      }
                      
                      await window.api?.youtubeConnect?.();
                      setSnack(t('youtubeConnectedSuccess'));
                    } catch (e: any) {
                      console.error(e);
                      const msg = String(e?.message || e || t('youtubeConnectFailedDefault'));
                      if (msg.includes('OAUTH_CLIENT_MISSING')) {
                        setSnack(t('oauthCredentialsMissing'));
                      } else if (msg.includes('invalid_client') || msg.includes('401')) {
                        setSnack(t('oauthInvalidClientHelp'));
                      } else {
                        setSnack(
                          t('youtubeConnectFailedWithMessage', {
                            message: `${msg.slice(0, 100)}${msg.length > 100 ? '...' : ''}`,
                          }),
                        );
                      }
                    } finally {
                      void refreshYtConnected();
                    }
                  }}
            disabled={!autoUploadEnabled}
                  startIcon={<Typography>{ytConnected ? '✅' : '🔗'}</Typography>}
                  sx={{
                    textTransform: 'none',
                    px: 2,
                    borderColor: ytConnected ? 'success.main' : undefined,
                    color: ytConnected ? 'success.main' : undefined,
                  }}
                >
                  {ytConnected ? t('connected') : t('connectYouTube')}
          </Button>
                <Button
                  variant="text"
                  size="small"
                  onClick={async () => {
                    try {
                      const validation: any = await window.api?.youtubeValidateCredentials?.();
                      if (validation?.ok) {
                        setSnack(t('credentialsOk', { clientId: validation.clientIdPrefix, file: validation.filePath }));
                      } else {
                        const message = validation?.message || t('credentialsNotFound');
                        setSnack(t('credentialsValidationFailedWithMessage', { message }));
                      }
                    } catch (e) {
                      console.error(e);
                    }
                  }}
                  sx={{ textTransform: 'none', px: 1, fontSize: '0.75rem' }}
                  title={t('checkCredentials')}
                >
                  🔍 {t('check')}
                </Button>
                <Button
                  variant="text"
                  size="small"
                  onClick={async () => {
                    try {
                      await window.api?.youtubeOpenUserData?.();
                      setSnack(t('openedUserDataFolderWithHint'));
                    } catch (e) {
                      console.error(e);
                      setSnack(t('failedToOpenUserDataFolder'));
                    }
                  }}
                  sx={{ textTransform: 'none', px: 1, fontSize: '0.75rem' }}
                  title={t('openUserData')}
                >
                  📂 {t('openUserData')}
                </Button>
              </Stack>
            </Paper>
          </Stack>
        </Paper>
        </Box>

        {!apiOk && (
          <Alert
            severity="error"
            sx={{
              mb: 2,
              borderRadius: 2,
              '& .MuiAlert-icon': { fontSize: 28 },
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t('windowApiNotFound')}
            </Typography>
            <Typography variant="caption">
              {t('preloadNotLoaded', { command: 'npm run dev' })}
            </Typography>
          </Alert>
        )}

        {/* Legacy status chips - hidden, moved to CommandBar */}
        <Box sx={{ display: 'none' }}>
          <Stack direction="row" spacing={1} sx={{ mb: 3 }} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              variant="outlined"
              color={ytConnected ? 'success' : 'default'}
              label={ytConnected ? t('youtubeConnected') : t('youtubeNotConnected')}
            />

            {/* Keep legacy schedule popover wiring alive (hidden). */}
            <Button sx={{ display: 'none' }} onClick={(e) => toggleSchedule(e)}>
              {t('schedule')}
            </Button>

<Popover
            open={scheduleOpen}
            anchorEl={scheduleAnchorEl}
            onClose={closeSchedule}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            <ClickAwayListener onClickAway={closeSchedule}>
              <Box sx={{ p: 1.5, width: timesPopoverWidth, maxWidth: '92vw' }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t('scheduleSettings')}
                </Typography>

                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap' }} useFlexGap>
                  <TextField
                    size="small"
                    label={t('startDate')}
                    type="date"
                    value={scheduleStartDate}
                    onChange={(e) => setScheduleStartDate(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    sx={{ width: 150 }}
                  />
                  <TextField
                    size="small"
                    label={t('videosPerDay')}
                    type="number"
                    value={videosPerDay}
                    onChange={(e) => setVideosPerDay(Math.max(1, Number(e.target.value || 1)))}
                    sx={{ width: 150 }}
                    inputProps={{ min: 1, step: 1 }}
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <Stack direction="row" spacing={0.5}>
                            <Tooltip title={t('decreaseVideosPerDay')}>
                            <IconButton
                              size="small"
                              onClick={() => setVideosPerDay((v) => Math.max(1, (Number.isFinite(v) ? v : 1) - 1))}
                            >
                              <Typography variant="caption">−</Typography>
                            </IconButton>
                            </Tooltip>
                            <Tooltip title={t('increaseVideosPerDay')}>
                            <IconButton
                              size="small"
                              onClick={() => setVideosPerDay((v) => (Number.isFinite(v) ? v : 1) + 1)}
                            >
                              <Typography variant="caption">+</Typography>
                            </IconButton>
                            </Tooltip>
                          </Stack>
                        </InputAdornment>
                      ),
                    }}
                  />

                  <TextField
                    size="small"
                    label={t('timesInputLabel')}
                    value={timesCsv.replace(/,/g, ' ')}
                    onChange={(e) => setTimesCsv(e.target.value)}
                    onBlur={() => setTimesCsv((cur) => normalizeTimesCsv(cur))}
                    sx={{ flex: 1, minWidth: 240 }}
                    placeholder={t('timesInputPlaceholder')}
                  />
                </Stack>

                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap' }} useFlexGap>
                  <TextField
                    size="small"
                    label={t('time')}
                    type="time"
                    value={timePickValue}
                    onChange={(e) => setTimePickValue(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => {
                      const picked = timeToMinutes(timePickValue);
                      if (picked == null) return;
                      const next = Array.from(new Set([...parseTimesCsv(timesCsv), picked])).sort((a, b) => a - b);
                      setTimesCsv(next.map(minutesToHHmm).join(' '));
                    }}
                  >
                    {t('addLabel')}
                  </Button>
                  <Button variant="outlined" size="small" onClick={() => setTimesCsv('')}>
                    {t('clear')}
                  </Button>
                </Stack>

                <Divider sx={{ my: 1 }} />

                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap' }} useFlexGap>
                  <TextField
                    size="small"
                    label={t('start')}
                    type="time"
                    value={genStart}
                    onChange={(e) => setGenStart(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    size="small"
                    label={t('end')}
                    type="time"
                    value={genEnd}
                    onChange={(e) => setGenEnd(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    size="small"
                    label={t('stepMinutes')}
                    select
                    value={genStep}
                    onChange={(e) => setGenStep(Number(e.target.value))}
                    sx={{ width: 120 }}
                  >
                    {[5, 10, 15, 20, 30, 45, 60, 90, 120].map((v) => (
                      <MenuItem key={v} value={v}>
                        {v}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      const sMin = timeToMinutes(genStart);
                      const eMin = timeToMinutes(genEnd);
                      const step = Number.isFinite(genStep) && genStep > 0 ? genStep : 60;
                      if (sMin == null || eMin == null) return;
                      if (eMin < sMin) {
                        console.warn('[times] End must be >= Start');
                        return;
                      }
                      const out: number[] = [];
                      for (let t = sMin; t <= eMin; t += step) out.push(t);
                      const uniq = Array.from(new Set(out)).sort((a, b) => a - b);
                      setTimesCsv(uniq.map(minutesToHHmm).join(' '));
                    }}
                  >
                    {t('generateTimes')}
                  </Button>
                </Stack>

                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap' }} useFlexGap>
                  <TextField
                    size="small"
                    label={t('slots')}
                    type="number"
                    value={genCount}
                    onChange={(e) => setGenCount(Math.max(1, Number(e.target.value || 1)))}
                    sx={{ width: 120 }}
                    inputProps={{ min: 1, step: 1 }}
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <Tooltip title={t('setSlotsEqualsVideosPerDay')}>
                            <IconButton size="small" onClick={() => setGenCount(Math.max(1, videosPerDay))}>
                              <Typography variant="caption">=</Typography>
                            </IconButton>
                          </Tooltip>
                        </InputAdornment>
                      ),
                    }}
                  />
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      const sMin = timeToMinutes(genStart);
                      const eMin = timeToMinutes(genEnd);
                      const nRaw = Number(genCount);
                      const n = Math.max(1, Number.isFinite(nRaw) ? Math.round(nRaw) : 1);
                      if (sMin == null || eMin == null) return;
                      if (eMin < sMin) {
                        console.warn('[times] End must be >= Start');
                        return;
                      }
                      if (n === 1) {
                        setTimesCsv([minutesToHHmm(sMin)].join(' '));
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
                  >
                    Spread
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      setGenCount(Math.max(1, videosPerDay));
                      const sMin = timeToMinutes(genStart);
                      const eMin = timeToMinutes(genEnd);
                      const n = Math.max(1, videosPerDay);
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
                  >
                    Spread = Videos/day
                  </Button>
                </Stack>

                <Divider sx={{ my: 1 }} />

                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
                  <Button size="small" variant="outlined" onClick={() => setTimesCsv('09:00 13:00 18:00')}>
                    3/day preset
                  </Button>
                  <Button size="small" variant="outlined" onClick={() => setTimesCsv('09:00 12:00 15:00 18:00')}>
                    4/day preset
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setTimesCsv('09:00 10:00 11:00 12:00 13:00 14:00 15:00 16:00 17:00 18:00')}
                  >
                    hourly 09–18
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setTimesCsv('12:00 13:00 14:00 15:00 16:00 17:00 18:00 19:00 20:00 21:00')}
                  >
                    12–21 (10)
                  </Button>
                </Stack>

                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Times are shown as boxes (no commas). Click a box to remove it.
                </Typography>

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
                    gap: 1,
                    mt: 1,
                  }}
                >
                  {timesList.map((m) => (
                    <Tooltip key={m} title={t('clickToRemove')}>
                      <Box
                        onClick={() => {
                          const next = timesList.filter((x) => x !== m);
                          setTimesCsv(next.map(minutesToHHmm).join(' '));
                        }}
                        sx={{
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1,
                          px: 1,
                          py: 1,
                          textAlign: 'center',
                          cursor: 'pointer',
                          userSelect: 'none',
                          '&:hover': { backgroundColor: 'action.hover' },
                        }}
                      >
                        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          {minutesToHHmm(m)}
                        </Typography>
                      </Box>
                    </Tooltip>
                  ))}
                </Box>
              </Box>
            </ClickAwayListener>
          </Popover>
            <Tooltip title={t('tooltipApplyPlan')}>
              <span>
                <Button 
                  variant="outlined" 
                  onClick={() => void rescheduleAll()} 
                  disabled={!autoEnabled || rowsById.size === 0}
                  data-testid="recalculate-schedule"
                >
                  {t('applyPlan')}
                </Button>
              </span>
            </Tooltip>

            <Divider flexItem orientation="vertical" sx={{ mx: 1 }} />

            <Autocomplete
              size="small"
              options={tzOptions}
              value={timeZoneId}
              onChange={(_e, v) => setTimeZoneId(v || 'SYSTEM')}
              sx={{ width: 280 }}
              renderInput={(params) => <TextField {...params} label={t('timeZone')} />}
              getOptionLabel={(o) => (o === 'SYSTEM' ? systemTzOffset : o)}
              isOptionEqualToValue={(o, v) => o === v}
            />
          </Stack>
        </Box>

        <Stack
          ref={splitterContainerRef}
          direction={interfaceSettings.panelsLayout === 'swapped' ? 'row-reverse' : 'row'}
          spacing={0}
          alignItems="stretch"
          sx={{
            mt: 1.5,
            flex: 1,
            minHeight: 0, // Let flex shrink so panels extend to bottom; gap = padding (p:3) like sides
            width: '100%',
            minWidth: 0,
            overflow: 'visible',
            display: 'flex',
            position: 'relative',
          }}
        >
          <Paper
            sx={{
              flex: '1 1 0%',
              minHeight: 520,
              minWidth: 0,
              width: '100%',
              maxWidth: '100%',
              maxHeight: '100%',
              borderRadius: 3,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              border: `1px solid ${dark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(79, 70, 229, 0.1)'}`,
              transition: 'all 0.3s ease-in-out',
              '&:hover': {
                border: `1px solid ${dark ? 'rgba(99, 102, 241, 0.4)' : 'rgba(79, 70, 229, 0.2)'}`,
                boxShadow: dark
                  ? '0 8px 24px rgba(99, 102, 241, 0.15)'
                  : '0 8px 24px rgba(79, 70, 229, 0.1)',
              },
            }}
          >
            {/* Search and Filter */}
            <Stack spacing={1} sx={{ p: 2, pb: 1, borderBottom: `1px solid ${dark ? 'rgba(99, 102, 241, 0.1)' : 'rgba(79, 70, 229, 0.05)'}` }}>
              <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap">
                <TextField
                  size="small"
                  placeholder={t('search')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  sx={{
                    flex: 1,
                    minWidth: 160,
                    '& .MuiOutlinedInput-root': { borderRadius: 2 },
                  }}
                  InputProps={{
                    startAdornment: <Typography sx={{ mr: 1 }}>🔍</Typography>,
                  }}
                />
                {autoArchiveEnabledFromSettings && (
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={showArchived}
                        onChange={(e) => setShowArchived(e.target.checked)}
                        color="primary"
                      />
                    }
                    label={<Typography variant="body2">{t('showArchived')}</Typography>}
                  />
                )}
              </Stack>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Tooltip title={t('filterAllItemsTooltip')}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setFilter('all')}
                    data-testid="filter-all"
                    sx={{
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: 600,
                    minHeight: 40,
                    px: 2,
                    boxShadow: filter === 'all' 
                      ? dark 
                        ? '0 2px 8px rgba(107, 114, 128, 0.4)' 
                        : '0 2px 8px rgba(107, 114, 128, 0.3)'
                      : dark
                        ? '0 2px 4px rgba(0, 0, 0, 0.3)'
                        : '0 2px 4px rgba(0, 0, 0, 0.1)',
                    bgcolor: filter === 'all' 
                      ? '#6b7280 !important'
                      : dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
                    color: filter === 'all' 
                      ? '#ffffff !important'
                      : dark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)',
                    borderColor: filter === 'all'
                      ? '#6b7280'
                      : dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.12)',
                    '&:hover': {
                      bgcolor: filter === 'all'
                        ? '#4b5563 !important'
                        : dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                    },
                  }}
                >
                  {formatFilterLabel(t('all'), statusCounts.all)}
                  </Button>
                </Tooltip>
                <Tooltip title={t('filterNeedsActionTooltip')}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setFilter('needsAction')}
                    data-testid="filter-needs-action"
                    sx={{
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: 600,
                    minHeight: 40,
                    px: 2,
                    boxShadow: filter === 'needsAction' 
                      ? dark 
                        ? '0 2px 8px rgba(245, 158, 11, 0.4)' 
                        : '0 2px 8px rgba(245, 158, 11, 0.3)'
                      : dark
                        ? '0 2px 4px rgba(0, 0, 0, 0.3)'
                        : '0 2px 4px rgba(0, 0, 0, 0.1)',
                    bgcolor: filter === 'needsAction' 
                      ? '#f59e0b !important'
                      : dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
                    color: filter === 'needsAction' 
                      ? '#ffffff !important'
                      : dark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)',
                    borderColor: filter === 'needsAction'
                      ? '#f59e0b'
                      : dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.12)',
                    '&:hover': {
                      bgcolor: filter === 'needsAction'
                        ? '#d97706 !important'
                        : dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                    },
                  }}
                >
                  {formatFilterLabel(t('needsAction'), statusCounts.needsAction)}
                  </Button>
                </Tooltip>
                <Tooltip title={t('filterReadyTooltip')}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setFilter('ready')}
                    data-testid="filter-ready"
                    sx={{
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: 600,
                    minHeight: 40,
                    px: 2,
                    boxShadow: filter === 'ready' 
                      ? dark 
                        ? '0 2px 8px rgba(16, 185, 129, 0.4)' 
                        : '0 2px 8px rgba(16, 185, 129, 0.3)'
                      : dark
                        ? '0 2px 4px rgba(0, 0, 0, 0.3)'
                        : '0 2px 4px rgba(0, 0, 0, 0.1)',
                    bgcolor: filter === 'ready' 
                      ? '#10b981 !important'
                      : dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
                    color: filter === 'ready' 
                      ? '#ffffff !important'
                      : dark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)',
                    borderColor: filter === 'ready'
                      ? '#10b981'
                      : dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.12)',
                    '&:hover': {
                      bgcolor: filter === 'ready'
                        ? '#059669 !important'
                        : dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                    },
                  }}
                >
                  {formatFilterLabel(t('ready'), statusCounts.ready)}
                  </Button>
                </Tooltip>
                <Tooltip title={t('filterScheduledTooltip')}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setFilter('scheduled')}
                    data-testid="filter-scheduled"
                    sx={{
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: 600,
                    minHeight: 40,
                    px: 2,
                    boxShadow: filter === 'scheduled' 
                      ? dark 
                        ? '0 2px 8px rgba(59, 130, 246, 0.4)' 
                        : '0 2px 8px rgba(59, 130, 246, 0.3)'
                      : dark
                        ? '0 2px 4px rgba(0, 0, 0, 0.3)'
                        : '0 2px 4px rgba(0, 0, 0, 0.1)',
                    bgcolor: filter === 'scheduled' 
                      ? '#3b82f6 !important'
                      : dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
                    color: filter === 'scheduled' 
                      ? '#ffffff !important'
                      : dark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)',
                    borderColor: filter === 'scheduled'
                      ? '#3b82f6'
                      : dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.12)',
                    '&:hover': {
                      bgcolor: filter === 'scheduled'
                        ? '#2563eb !important'
                        : dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                    },
                  }}
                >
                  {formatFilterLabel(t('scheduled'), statusCounts.scheduled)}
                  </Button>
                </Tooltip>
                <Tooltip title={t('filterProcessingTooltip')}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setFilter('processing')}
                    data-testid="filter-processing"
                    sx={{
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: 600,
                    minHeight: 40,
                    px: 2,
                    boxShadow: filter === 'processing' 
                      ? dark 
                        ? '0 2px 8px rgba(59, 130, 246, 0.4)' 
                        : '0 2px 8px rgba(59, 130, 246, 0.3)'
                      : dark
                        ? '0 2px 4px rgba(0, 0, 0, 0.3)'
                        : '0 2px 4px rgba(0, 0, 0, 0.1)',
                    bgcolor: filter === 'processing' 
                      ? '#3b82f6 !important'
                      : dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
                    color: filter === 'processing' 
                      ? '#ffffff !important'
                      : dark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)',
                    borderColor: filter === 'processing'
                      ? '#3b82f6'
                      : dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.12)',
                    '&:hover': {
                      bgcolor: filter === 'processing'
                        ? '#2563eb !important'
                        : dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                    },
                  }}
                >
                  {formatFilterLabel(t('processing'), statusCounts.processing)}
                  </Button>
                </Tooltip>
                <Tooltip title={t('filterDoneTooltip')}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setFilter('done')}
                    data-testid="filter-done"
                    sx={{
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: 600,
                    minHeight: 40,
                    px: 2,
                    boxShadow: filter === 'done' 
                      ? dark 
                        ? '0 2px 8px rgba(16, 185, 129, 0.4)' 
                        : '0 2px 8px rgba(16, 185, 129, 0.3)'
                      : dark
                        ? '0 2px 4px rgba(0, 0, 0, 0.3)'
                        : '0 2px 4px rgba(0, 0, 0, 0.1)',
                    bgcolor: filter === 'done' 
                      ? '#10b981 !important'
                      : dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
                    color: filter === 'done' 
                      ? '#ffffff !important'
                      : dark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)',
                    borderColor: filter === 'done'
                      ? '#10b981'
                      : dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.12)',
                    '&:hover': {
                      bgcolor: filter === 'done'
                        ? '#059669 !important'
                        : dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                    },
                  }}
                >
                  {formatFilterLabel(t('done'), statusCounts.done)}
                  </Button>
                </Tooltip>
                <Tooltip title={t('filterFailedTooltip')}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setFilter('failed')}
                    data-testid="filter-failed"
                    sx={{
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: 600,
                    minHeight: 40,
                    px: 2,
                    boxShadow: filter === 'failed' 
                      ? dark 
                        ? '0 2px 8px rgba(239, 68, 68, 0.4)' 
                        : '0 2px 8px rgba(239, 68, 68, 0.3)'
                      : dark
                        ? '0 2px 4px rgba(0, 0, 0, 0.3)'
                        : '0 2px 4px rgba(0, 0, 0, 0.1)',
                    bgcolor: filter === 'failed' 
                      ? '#ef4444 !important'
                      : dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
                    color: filter === 'failed' 
                      ? '#ffffff !important'
                      : dark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)',
                    borderColor: filter === 'failed'
                      ? '#ef4444'
                      : dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.12)',
                    '&:hover': {
                      bgcolor: filter === 'failed'
                        ? '#dc2626 !important'
                        : dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                    },
                  }}
                >
                  {formatFilterLabel(t('failed'), statusCounts.failed)}
                  </Button>
                </Tooltip>
              </Stack>
            </Stack>
            {youtubeLimitWarning && (
              <Alert
                severity="warning"
                onClose={() => setYoutubeLimitWarning(null)}
                sx={{ mb: 1 }}
              >
                {youtubeLimitWarning}
              </Alert>
            )}
            <Dialog open={youtubeDailyLimitModalOpen} onClose={() => setYoutubeDailyLimitModalOpen(false)} maxWidth="sm" fullWidth>
              <DialogTitle>{t('youtubeDailyLimitModalTitle')}</DialogTitle>
              <DialogContent>
                <Typography sx={{ pt: 0 }}>{t('youtubeDailyLimitModalBody')}</Typography>
              </DialogContent>
              <DialogActions sx={{ px: 2, pb: 1 }}>
                <Button onClick={() => setYoutubeDailyLimitModalOpen(false)}>{t('close')}</Button>
                <Button
                  variant="contained"
                  onClick={() => {
                    window.api?.openExternal?.(YOUTUBE_VERIFICATION_GUIDE_URL);
                  }}
                >
                  {t('youtubeDailyLimitLearnVerify')}
                </Button>
              </DialogActions>
            </Dialog>
            <Box 
              sx={{ 
                flex: 1, 
                minHeight: '400px', // Changed from 0 to '400px' to fix MUI X height error
                height: '100%', // Ensure full height
                minWidth: 1, // Prevent 0px width edge case (not a visual change, just prevents MUI X error)
                width: '100%', 
                maxWidth: '100%', // Prevent overflow
                display: 'flex', 
                flexDirection: 'column',
                position: 'relative', // Ensure proper layout
                overflow: 'hidden', // Prevent content overflow
              }}
              onContextMenu={(e) => {
                // Handle context menu on DataGrid container
                const target = e.target as HTMLElement;
                const rowElement = target.closest('.MuiDataGrid-row');
                if (rowElement) {
                  const rowId = rowElement.getAttribute('data-id');
                  if (rowId) {
                    handleContextMenu(e, rowId);
                  }
                } else if (selectedIds.length > 0) {
                  handleContextMenu(e);
                }
              }}
              onDragStartCapture={(e) => {
                if (!canManualReorder) return;
                const target = e.target as HTMLElement | null;
                if (!target) return;
                const rowEl = target.closest('.MuiDataGrid-row') as HTMLElement | null;
                if (!rowEl) return;

                // Don't start reorder when dragging interactive controls.
                const interactive = target.closest(
                  'button, input, textarea, select, a, [role="button"], .MuiChip-root, .MuiSwitch-root, .MuiCheckbox-root',
                );
                if (interactive) {
                  e.preventDefault();
                  return;
                }

                const id = rowEl.getAttribute('data-id');
                if (!id) return;

                rowDraggingRef.current = true;
                setRowDragId(id);
                try {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('application/x-cu-row-reorder', id);
                  e.dataTransfer.setData('text/plain', id);
                } catch {
                  // ignore
                }
              }}
              onDragOverCapture={(e) => {
                // Only handle internal row reorder drags; allow file drops to fall through to app-level drop handler.
                const isRowDrag = Array.from(e.dataTransfer.types || []).includes('application/x-cu-row-reorder');
                if (!isRowDrag) return;
                e.preventDefault();
                e.stopPropagation();
                try {
                  e.dataTransfer.dropEffect = 'move';
                } catch {
                  // ignore
                }
                const target = e.target as HTMLElement | null;
                const rowEl = target?.closest('.MuiDataGrid-row') as HTMLElement | null;
                const id = rowEl?.getAttribute('data-id') || null;
                if (id && rowDragOverId !== id) setRowDragOverId(id);
              }}
              onDropCapture={(e) => {
                const isRowDrag = Array.from(e.dataTransfer.types || []).includes('application/x-cu-row-reorder');
                if (!isRowDrag) return;
                e.preventDefault();
                e.stopPropagation();

                const src =
                  e.dataTransfer.getData('application/x-cu-row-reorder') ||
                  e.dataTransfer.getData('text/plain') ||
                  rowDragId ||
                  '';

                const target = e.target as HTMLElement | null;
                const rowEl = target?.closest('.MuiDataGrid-row') as HTMLElement | null;
                const targetId = rowEl?.getAttribute('data-id') || null;
                const rect = rowEl?.getBoundingClientRect();
                const dropAfter = rect ? e.clientY > rect.top + rect.height / 2 : true;

                reorderRowsByDrop(src, targetId, dropAfter);

                rowDraggingRef.current = false;
                setRowDragId(null);
                setRowDragOverId(null);
              }}
              onDragEndCapture={() => {
                rowDraggingRef.current = false;
                setRowDragId(null);
                setRowDragOverId(null);
              }}
            >
              <DataGrid
                key={dataGridKey}
                apiRef={gridApiRef}
                className={canManualReorder ? 'manual-reorder-enabled' : ''}
                rows={sortedRows}
                columns={cols}
                autosizeOnMount={false}
                autosizeOptions={{
                  columns: ['stage', 'visibility', 'selfDeclaredMadeForKids', 'youtube', 'instagram', 'tiktok'],
                  includeHeaders: true,
                  includeOutliers: true,
                  outliersFactor: 1.5,
                  expand: false,
                  disableColumnVirtualization: true,
                }}
                onColumnResize={(params) => {
                  // Only mark as user-resized if it's a manual resize by user (not programmatic autosize)
                  // If autosize is programmatic, do nothing to prevent blocking future autosize
                  if (isProgrammaticAutosizeRef.current) {
                    return; // Ignore resize events from programmatic autosize
                  }
                  
                  if (params.colDef?.field && params.width) {
                    // This is a user-driven resize, mark it so autosize won't override user preferences
                    userResizedColumnsRef.current = true;
                    
                    // Save column width using MUI's recommended approach
                    setColumnWidths((prev) => ({
                      ...prev,
                      [params.colDef.field]: params.width,
                    }));
                  }
                }}
                onColumnWidthChange={(params) => {
                  // Save column width changes (including from autosize) using MUI's recommended approach
                  if (params.colDef?.field && params.width) {
                    setColumnWidths((prev) => ({
                      ...prev,
                      [params.colDef.field]: params.width,
                    }));
                  }
                }}
                getRowId={(r) => r.id}
                processRowUpdate={(newRow, oldRow) => {
                  // Force re-render when metadata changes
                  const oldMetaHash = JSON.stringify(oldRow.meta?.byPlatform);
                  const newMetaHash = JSON.stringify(newRow.meta?.byPlatform);
                  if (oldMetaHash !== newMetaHash) {
                    // Metadata changed, force update
                    return newRow;
                  }
                  return newRow;
                }}
                rowSelectionModel={selectionModel}
                onRowSelectionModelChange={(m) => {
                  setSelectionModel(m);
                  // Do not clear active row when toggling checkbox; keep details panel and active highlight unchanged.
                }}
                onRowClick={(params) => {
                  if (rowDraggingRef.current) return;
                  // Click pe rând → afișează details și evidențiază rândul
                  setSelectedRowId(params.row.id);
                }}
                disableColumnMenu={false}
                disableColumnSorting={true}
                getRowClassName={(params) => {
                  // Evidențiază doar rândul selectat pentru details (nu cel selectat cu checkbox)
                  const classes: string[] = [];
                  if (params.id === selectedRowId) classes.push('MuiDataGrid-row-selected');
                  if (rowDragId && params.id === rowDragId) classes.push('row-dragging');
                  if (rowDragOverId && params.id === rowDragOverId) classes.push('row-dragover');
                  return classes.join(' ');
                }}
                // Note: DataGrid automatically sets data-id attribute on rows, use that for E2E testing
                density="compact"
                checkboxSelection
                disableRowSelectionOnClick
                disableVirtualization={false}
                autoHeight={false}
                pageSizeOptions={[25, 50, 100]}
                paginationModel={paginationModel}
                onPaginationModelChange={(model) => {
                  setPaginationModel(model);
                  
                  // Persist to localStorage
                  if (model.page === 0) {
                    // User went to page 1 - clear saved pagination
                    try {
                      localStorage.removeItem('dataGridPagination');
                    } catch (e) {
                      console.warn('[PAGINATION] Failed to remove pagination from localStorage:', e);
                    }
                  } else {
                    // Save pagination for restoration
                    try {
                      localStorage.setItem('dataGridPagination', JSON.stringify({
                        page: model.page,
                        pageSize: model.pageSize,
                        timestamp: Date.now(),
                      }));
                    } catch (e) {
                      console.warn('[PAGINATION] Failed to save pagination to localStorage:', e);
                    }
                  }
                }}
                sortModel={sortModel}
                onSortModelChange={(model) => {
                  setSortModel(model.map(m => ({ field: m.field, sort: (m.sort || 'asc') as 'asc' | 'desc' })));
                  // Optionally persist sort model to localStorage
                  try {
                    if (model.length > 0) {
                      localStorage.setItem('dataGridSortModel', JSON.stringify(model));
                    } else {
                      localStorage.removeItem('dataGridSortModel');
                    }
                  } catch (e) {
                    // Ignore
                  }
                }}
                slots={{
                  footer: () => {
                    const selectedCount = selectedIds.length;
                    const hasSelection = selectedCount > 0;
                    return (
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          p: 1,
                          px: 2,
                          borderTop: `1px solid ${dark ? 'rgba(99, 102, 241, 0.1)' : 'rgba(79, 70, 229, 0.05)'}`,
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            {hasSelection
                              ? `${selectedCount} ${selectedCount === 1 ? t('row') : t('rows')} ${t('selected')}`
                              : `${sortedRows.length} ${sortedRows.length === 1 ? t('row') : t('rows')}`}
                          </Typography>
                          {filter === 'failed' && sortedRows.length > 0 && (
                            <>
                              <Button
                                size="small"
                                variant="outlined"
                                color="warning"
                                onClick={async () => {
                                  // Retry pipeline for all failed items
                                  const failedRows = sortedRows.filter(row => getRowStatus(row) === 'failed');
                                  for (const row of failedRows) {
                                    // Check if failure is from pipeline (status === 'Error')
                                    if (row.status === 'Error') {
                                      // Reset status and retry pipeline
                                      updateRow(row.id, (r) => ({ ...r, status: 'Ready' as const }));
                                      // Clear log in separate state (doesn't trigger rows rebuild)
                                      setLogsById((prev) => {
                                        const next = new Map(prev);
                                        next.set(row.id, '');
                                        return next;
                                      });
                                      // Trigger pipeline generation
                                      generateMetadata([row], ['youtube', 'instagram', 'tiktok']);
                                    }
                                  }
                                  setSnack(t('retryingPipelineCount', { count: failedRows.length }));
                                }}
                                startIcon={<Typography>🔄</Typography>}
                                sx={{ ml: 1 }}
                              >
                                {t('retryPipeline')}
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="warning"
                                disabled={!hasSelection}
                                onClick={async () => {
                                  // Retry upload for selected failed items
                                  if (!requireOnline()) return;
                                  if (!guardUploadAndScheduleAccess()) return;
                                  const failedSelectedRows = sortedRows.filter(
                                    row => selectedIds.includes(row.id) && getRowStatus(row) === 'failed'
                                  );
                                  const youtubeRetries = failedSelectedRows.filter((row) => {
                                    const targets = row.targets || { youtube: false, instagram: false, tiktok: false };
                                    if (!targets.youtube) return false;
                                    const platformStatus = getPlatformStatus(row, 'youtube');
                                    return platformStatus.status === 'failed';
                                  });
                                  let retryReservations: Map<string, string> | null = null;
                                  let latestSnapshot: UsageSnapshot | null = null;
                                  if (youtubeRetries.length > 0) {
                                    try {
                                      retryReservations = await reserveQuotaForRows(youtubeRetries, 'upload');
                                      setSnack(t('uploadCreditsReserved', { count: youtubeRetries.length }));
                                    } catch (err) {
                                      handleBillingError(err, 'upload');
                                      return;
                                    }
                                  }
                                  for (const row of failedSelectedRows) {
                                    const targets = row.targets || { youtube: false, instagram: false, tiktok: false };
                                    // Check which platforms failed
                                    for (const platform of ['youtube', 'instagram', 'tiktok'] as const) {
                                      if (!targets[platform]) continue;
                                      const platformStatus = getPlatformStatus(row, platform);
                                      if (platformStatus.status === 'failed') {
                                        // Reset failed status and retry
                                        if (platform === 'youtube') {
                                          // Retry YouTube upload
                                          const reservationId = retryReservations?.get(row.filePath);
                                          const outputs = await window.api?.readOutputsForPath?.(row.filePath);
                                          const exports = outputs?.exports?.youtube || {};
                                          const meta = outputs?.meta?.platforms?.youtube || {};
                                          const title = (exports?.title || meta?.title || row.filename || '').trim();
                                          let description = (exports?.description || meta?.description || '').trim();
                                          const tagsRaw = (exports?.hashtags || meta?.hashtags || '').trim();
                                          const tags = tagsRaw
                                            ? tagsRaw.split(/[,\n\r\t ]+/g).map((x: string) => x.trim()).filter(Boolean).map((x: string) => (x.startsWith('#') ? x.slice(1) : x)).join(' ')
                                            : '';
                                          // Append hashtags to description so they appear on YouTube
                                          const hashtagsForDesc = tags ? tags.split(/\s+/).filter(Boolean).map((t) => (t.startsWith('#') ? t.replace(/^#+/, '#') : `#${t}`)).join(' ') : '';
                                          if (hashtagsForDesc) description = description ? `${description}\n\n${hashtagsForDesc}` : hashtagsForDesc;
                                          const payload = {
                                            filePath: row.filePath,
                                            title,
                                            description,
                                            tags,
                                            publishAt: null,
                                            privacyStatus: row.visibility,
                                            selfDeclaredMadeForKids: row.selfDeclaredMadeForKids ?? false,
                                          };
                                          try {
                                            const res: any = await window.api?.youtubeUpload?.(payload);
                                            if (res?.ok && res?.videoId) {
                                              if (reservationId) {
                                                try {
                                                  latestSnapshot = await finalizeQuota(reservationId);
                                                } catch (err) {
                                                  console.error('Failed to finalize upload quota:', err);
                                                }
                                              }
                                              await upsertJobRunForPlatform({
                                                row,
                                                platform: 'youtube',
                                                ok: true,
                                                videoId: res.videoId,
                                                publishAtUtcMs: payload.publishAt ?? null,
                                              });
                                            } else {
                                              if (res?.error) {
                                                handleNetworkError(res.error);
                                              }
                                              if (reservationId) {
                                                try {
                                                  await releaseQuota(reservationId);
                                                } catch (err) {
                                                  console.error('Failed to release upload quota:', err);
                                                }
                                              }
                                              const isDailyLimit = isYoutubeDailyLimitError(res);
                                              if (isDailyLimit) {
                                                setYoutubeDailyLimitModalOpen(true);
                                              }
                                              await upsertJobRunForPlatform({
                                                row,
                                                platform: 'youtube',
                                                ok: false,
                                                error: isDailyLimit ? t('youtubeDailyLimitBlockedStatus') : (res?.error || t('uploadFailed')),
                                                publishAtUtcMs: payload.publishAt ?? null,
                                              });
                                            }
                                          } catch (e) {
                                            handleNetworkError(e);
                                            console.error('Retry upload failed:', e);
                                            if (reservationId) {
                                              try {
                                                await releaseQuota(reservationId);
                                              } catch (err) {
                                                console.error('Failed to release upload quota:', err);
                                              }
                                            }
                                            const errMsg = String(e?.message ?? e);
                                            const isDailyLimit = /daily upload limit|upload limit|verify your account|phone verification|youtube verification|exceeded the number of videos|verification required|channel verification/i.test(errMsg);
                                            if (isDailyLimit) {
                                              setYoutubeDailyLimitModalOpen(true);
                                            }
                                            await upsertJobRunForPlatform({
                                              row,
                                              platform: 'youtube',
                                              ok: false,
                                              error: isDailyLimit ? t('youtubeDailyLimitBlockedStatus') : errMsg,
                                              publishAtUtcMs: payload.publishAt ?? null,
                                            });
                                          }
                                        } else {
                                          // For IG/TT, trigger assist
                                          const current = await window.api?.jobsLoad?.();
                                          const jobs = Array.isArray(current) ? current : [];
                                          const alreadyDone = getJobsForRow(row, jobs).some((j) => Boolean(j.run?.[platform]?.done));
                                          if (alreadyDone) {
                                            continue;
                                          }
                                          try {
                                            await window.api?.autouploadTriggerAssist?.({
                                              filePath: row.filePath,
                                              platform,
                                            });
                                          } catch (e) {
                                            handleNetworkError(e);
                                          }
                                        }
                                      }
                                    }
                                  }
                                  if (latestSnapshot) {
                                    setUsageSnapshot(latestSnapshot);
                                  }
                                  setSnack(t('retryingUploadCount', { count: failedSelectedRows.length }));
                                  void loadJobs();
                                }}
                                startIcon={<Typography>🔄</Typography>}
                                sx={{ ml: 1 }}
                              >
                                {t('retryUpload')}
                              </Button>
                            </>
                          )}
                          {showArchived ? (
                            <>
                              <Button
                                size="small"
                                variant="outlined"
                                disabled={!hasSelection}
                                onClick={() => {
                                  if (!hasSelection) return;
                                  restoreArchivedRows(selectedIds);
                                }}
                                startIcon={<Typography>↩️</Typography>}
                                sx={{ ml: 1 }}
                              >
                                {t('restore')}
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="error"
                                disabled={!hasSelection}
                                onClick={() => {
                                  if (!hasSelection) return;
                                  setItemsToDeleteFromApp(selectedIds);
                                  setDeleteFromAppConfirmOpen(true);
                                }}
                                startIcon={<Typography>🗑️</Typography>}
                                sx={{ ml: 1 }}
                              >
                                {t('deleteFromApp')}
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              disabled={!hasSelection}
                              onClick={() => {
                                if (!hasSelection) return;
                                removeVideos(selectedIds);
                              }}
                              startIcon={<Typography>🗑️</Typography>}
                              sx={{ ml: 1 }}
                            >
                              {t('removeVideo')}
                            </Button>
                          )}
                          <Tooltip title={t('savedMetadataTooltip')}>
                            <Button
                              size="small"
                              variant="outlined"
                              disabled={!hasSelection}
                              onClick={() => {
                                if (!hasSelection) return;
                                setTemplateDialogOpen(true);
                              }}
                              startIcon={<Typography>🧩</Typography>}
                              sx={{ ml: 1 }}
                            >
                              {t('savedMetadata')}
                            </Button>
                          </Tooltip>
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={selectedRows.length < 2}
                            onClick={() => {
                              if (selectedRows.length < 2) return;
                              setBulkEditVisibilityChoice('');
                              setBulkEditMfkChoice('');
                              setBulkEditOpen(true);
                            }}
                            startIcon={<Typography>🧰</Typography>}
                            sx={{ ml: 1 }}
                          >
                            Bulk Edit
                          </Button>
                        </Box>
                        <GridPagination />
                      </Box>
                    );
                  },
                }}
                hideFooterSelectedRowCount
                sx={{
                  flex: 1,
                  minHeight: '400px', // Changed from 0 to '400px' to fix MUI X height error
                  height: '100%', // Ensure full height
                  minWidth: '100%', // Changed from 0 to '100%' to fix MUI X width error
                  width: '100%',
                  '& .MuiDataGrid-row:hover': {
                    cursor: 'pointer',
                  },
                  // Checkbox-selected only: no background so it doesn't override active row
                  '& .MuiDataGrid-row.Mui-selected': {
                    backgroundColor: 'transparent',
                  },
                  '& .MuiDataGrid-row.Mui-selected:hover': {
                    backgroundColor: 'transparent',
                  },
                  // Active (focused) row for details panel — always visible; stronger in dark mode for contrast
                  '& .MuiDataGrid-row.MuiDataGrid-row-selected': {
                    backgroundColor: dark
                      ? 'rgba(99, 102, 241, 0.28)'
                      : 'rgba(79, 70, 229, 0.1)',
                    ...(dark && {
                      borderLeft: '3px solid rgba(129, 140, 248, 0.9)',
                      boxSizing: 'border-box',
                    }),
                  },
                  '& .MuiDataGrid-row.MuiDataGrid-row-selected:hover': {
                    backgroundColor: dark
                      ? 'rgba(99, 102, 241, 0.38)'
                      : 'rgba(79, 70, 229, 0.15)',
                  },
                  // When row is both checkbox-selected and active, active highlight wins (higher specificity)
                  '& .MuiDataGrid-row.Mui-selected.MuiDataGrid-row-selected': {
                    backgroundColor: dark
                      ? 'rgba(99, 102, 241, 0.28)'
                      : 'rgba(79, 70, 229, 0.1)',
                    ...(dark && {
                      borderLeft: '3px solid rgba(129, 140, 248, 0.9)',
                      boxSizing: 'border-box',
                    }),
                  },
                  '& .MuiDataGrid-row.Mui-selected.MuiDataGrid-row-selected:hover': {
                    backgroundColor: dark
                      ? 'rgba(99, 102, 241, 0.38)'
                      : 'rgba(79, 70, 229, 0.15)',
                  },
                  // Scrollbar styles are handled globally in App.css for consistency
                }}
              />
            </Box>
          </Paper>

          {/* Splitter - invisible but functional */}
          <Box
            onMouseDown={handleSplitterMouseDown}
            sx={{
              width: 8,
              cursor: 'col-resize',
              backgroundColor: 'transparent',
              border: 'none',
              position: 'relative',
              zIndex: 1,
              // Make it easier to grab by extending hit area
              '&::before': {
                content: '""',
                position: 'absolute',
                left: -5,
                right: -5,
                top: 0,
                bottom: 0,
                cursor: 'col-resize',
              },
            }}
          />

          {/* New Details Panel */}
          <Box
            sx={{
              width: interfaceSettings.detailsPanelWidth,
              minHeight: 0,
              flex: '0 0 auto',
              alignSelf: 'stretch',
              flexShrink: 0,
            }}
          >
            <DetailsPanel
              selectedRow={selectedRow}
              platformStatus={selectedRowPlatformStatus}
              generateMetadataDisabled={selectedRow ? metadataGenerationBusyPaths.has(selectedRow.filePath) : false}
              generateMetadataBusyTooltip={t('tooltipGenerateMetadataBusy')}
              onGenerateMetadata={async (platform?: 'youtube' | 'instagram' | 'tiktok' | 'all') => {
                if (!selectedRow) return;
                
                // Check metadata directly from disk (same logic as generateMetadata)
                const checkMetadataOnDisk = async (filePath: string, platformsToCheck: ('youtube' | 'instagram' | 'tiktok')[]): Promise<('youtube' | 'instagram' | 'tiktok')[]> => {
                  try {
                    const res = await window.api?.readOutputsForPath?.(filePath);
                    if (!res?.ok) {
                      console.log(`[onGenerateMetadata] readOutputsForPath failed for ${filePath}`);
                      return platformsToCheck; // Assume all need metadata if check fails
                    }
                    
                    console.log(`[onGenerateMetadata] Checking metadata for ${filePath}:`, {
                      hasMetadata: !!res.metadata,
                      platformsKeys: res.metadata?.platforms ? Object.keys(res.metadata.platforms) : [],
                      platforms: res.metadata?.platforms,
                    });
                    
                    const metadataPlatforms = res?.metadata?.platforms || {};
                    const exports = res?.exports || {};
                    
                    // If metadata.platforms is empty object {}, treat as no metadata
                    if (Object.keys(metadataPlatforms).length === 0) {
                      console.log(`[onGenerateMetadata] metadata.platforms is empty {} for ${filePath}, all platforms need metadata`);
                      return platformsToCheck;
                    }
                    
                    // Helper to check if a platform has actual content (non-empty)
                    const hasPlatformContent = (p: 'youtube' | 'instagram' | 'tiktok'): boolean => {
                      // Check in metadata.platforms
                      const metaPlatform = metadataPlatforms[p];
                      let hasMeta = false;
                      if (metaPlatform && typeof metaPlatform === 'object') {
                        const title = metaPlatform.title ? String(metaPlatform.title).trim() : '';
                        const desc = metaPlatform.description ? String(metaPlatform.description).trim() : '';
                        let tags = false;
                        if (metaPlatform.hashtags) {
                          if (Array.isArray(metaPlatform.hashtags)) {
                            tags = metaPlatform.hashtags.length > 0 && metaPlatform.hashtags.some((t: unknown) => String(t).trim());
                          } else if (typeof metaPlatform.hashtags === 'string') {
                            tags = Boolean(metaPlatform.hashtags.trim());
                          }
                        }
                        hasMeta = Boolean(title || desc || tags);
                        if (hasMeta) {
                          console.log(`[onGenerateMetadata] Platform ${p} has metadata content: title="${title}", desc="${desc}", tags=${tags}`);
                        }
                      }
                      
                      // Also check exports
                      const exp = exports[p];
                      let hasExport = false;
                      if (exp && typeof exp === 'object') {
                        const title = exp.title ? String(exp.title).trim() : '';
                        const desc = exp.description ? String(exp.description).trim() : '';
                        const tags = exp.hashtags ? String(exp.hashtags).trim() : '';
                        hasExport = Boolean(title || desc || tags);
                        if (hasExport) {
                          console.log(`[onGenerateMetadata] Platform ${p} has export content: title="${title}", desc="${desc}", tags="${tags}"`);
                        }
                      }
                      
                      const result = hasMeta || hasExport;
                      if (!result) {
                        console.log(`[onGenerateMetadata] Platform ${p} has NO content`);
                      }
                      return result;
                    };
                    
                    // Return only platforms that don't have content
                    const missing = platformsToCheck.filter(p => !hasPlatformContent(p));
                    console.log(`[onGenerateMetadata] Platforms to check: ${platformsToCheck.join(', ')}, Missing: ${missing.join(', ') || 'none'}`);
                    return missing;
                  } catch (e) {
                    console.error('[onGenerateMetadata] Failed to check metadata on disk:', e);
                    return platformsToCheck; // Assume all need metadata if check fails
                  }
                };
                
                // Determine which platforms to check
                // Handle case where platform might be an event object (from onClick without parameters)
                let actualPlatform: 'youtube' | 'instagram' | 'tiktok' | 'all' | undefined = platform;
                if (platform && typeof platform === 'object' && 'target' in platform) {
                  // It's an event object, default to 'all'
                  console.warn(`[onGenerateMetadata] Received event object instead of platform string, defaulting to 'all'`);
                  actualPlatform = 'all';
                }
                
                console.log(`[onGenerateMetadata] Received platform parameter: "${actualPlatform}" (type: ${typeof actualPlatform})`);
                let platformsToCheck: ('youtube' | 'instagram' | 'tiktok')[] = [];
                if (actualPlatform === 'all' || !actualPlatform || actualPlatform === undefined) {
                  platformsToCheck = ['youtube', 'instagram', 'tiktok'];
                  console.log(`[onGenerateMetadata] Setting platformsToCheck to all platforms: [${platformsToCheck.join(', ')}]`);
                } else if (actualPlatform === 'youtube' || actualPlatform === 'instagram' || actualPlatform === 'tiktok') {
                  platformsToCheck = [actualPlatform];
                  console.log(`[onGenerateMetadata] Setting platformsToCheck to single platform: [${platformsToCheck.join(', ')}]`);
                } else {
                  console.warn(`[onGenerateMetadata] Unknown platform value: "${actualPlatform}", defaulting to all platforms`);
                  platformsToCheck = ['youtube', 'instagram', 'tiktok'];
                }
                
                // Force a refresh from disk first to ensure we have the latest data
                // This is important after deletion operations
                await refreshOutputsForPath(selectedRow.filePath, true);
                // Small delay to ensure file system operations are complete
                await new Promise(resolve => setTimeout(resolve, 200));
                
                // Check which platforms actually need metadata (from disk)
                const missingPlatforms = await checkMetadataOnDisk(selectedRow.filePath, platformsToCheck);
                
                console.log(`[onGenerateMetadata] After check: missingPlatforms = [${missingPlatforms.join(', ')}], platformsToCheck = [${platformsToCheck.join(', ')}]`);
                
                if (missingPlatforms.length === 0) {
                  console.log(`[onGenerateMetadata] No missing platforms, showing snack and returning`);
                  if (platformsToCheck.length > 0) {
                    setSnack(t('allSelectedPlatformsHaveMetadataFor', { platforms: platformsToCheck.map((p) => platformLabels[p]).join(', ') }));
                  } else {
                    setSnack(t('allSelectedPlatformsHaveMetadata'));
                  }
                  return;
                }
                
                console.log(`[onGenerateMetadata] Calling generateMetadata with [${selectedRow.filePath}] and platforms: [${missingPlatforms.join(', ')}]`);
                // Generate metadata for missing platforms
                generateMetadata([selectedRow], missingPlatforms);
                console.log(`[onGenerateMetadata] generateMetadata call completed`);
              }}
              onOpenEditor={async (platform: MetaPlatform | 'all') => {
                if (!selectedRow) return;
                try {
                  if (platform === 'all') {
                    await Promise.all([
                      window.api?.openExportsForPath?.('youtube', selectedRow.filePath),
                      window.api?.openExportsForPath?.('instagram', selectedRow.filePath),
                      window.api?.openExportsForPath?.('tiktok', selectedRow.filePath),
                    ]);
                    setSnack(t('openedMetadataFolderHint'));
                  } else {
                    const result = await window.api?.openExportsForPath?.(platform, selectedRow.filePath);
                    if (result?.openedFolder) {
                      setSnack(t('exportFileNotFoundOpenedFolder'));
                    } else if (result?.ok !== false) {
                      setSnack(t('openedMetadataFolderHint'));
                    }
                    if (result?.ok === false && result?.error) {
                      setSnack(t('failedToOpenMetadataFolder'));
                    }
                  }
                } catch (e) {
                  console.error('Failed to open exports:', e);
                  setSnack(t('failedToOpenMetadataFolder'));
                }
              }}
              onApplyTemplate={async () => {
                if (!selectedRow) return;
                setTemplateDialogOpen(true);
              }}
              onCopyCaption={async (platform, value) => {
                const text = (value ?? '').trim() || selectedRow?.meta?.byPlatform?.[platform]?.description;
                if (text) {
                  try {
                    if (navigator?.clipboard?.writeText) {
                      await navigator.clipboard.writeText(text);
                    } else {
                      await window.api?.copyText?.(text);
                    }
                    setSnack(t('copied'));
                  } catch (e) {
                    try {
                      await window.api?.copyText?.(text);
                      setSnack(t('copied'));
                    } catch {
                      setSnack(t('failedToCopy'));
                    }
                  }
                } else {
                  setSnack(t('noMetadataForPlatform', { platform: platformLabels[platform] }));
                }
              }}
              onCopyHashtags={async (platform, value) => {
                const text = (value ?? '').trim() || selectedRow?.meta?.byPlatform?.[platform]?.hashtags;
                if (text) {
                  try {
                    if (navigator?.clipboard?.writeText) {
                      await navigator.clipboard.writeText(text);
                    } else {
                      await window.api?.copyText?.(text);
                    }
                    setSnack(t('copied'));
                  } catch (e) {
                    try {
                      await window.api?.copyText?.(text);
                      setSnack(t('copied'));
                    } catch {
                      setSnack(t('failedToCopy'));
                    }
                  }
                } else {
                  setSnack(t('noMetadataForPlatform', { platform: platformLabels[platform] }));
                }
              }}
              onCopyTitle={async (platform, value) => {
                const text = (value ?? '').trim() || selectedRow?.meta?.byPlatform?.[platform]?.title;
                if (text) {
                  try {
                    if (navigator?.clipboard?.writeText) {
                      await navigator.clipboard.writeText(text);
                    } else {
                      await window.api?.copyText?.(text);
                    }
                    setSnack(t('copied'));
                  } catch (e) {
                    try {
                      await window.api?.copyText?.(text);
                      setSnack(t('copied'));
                    } catch {
                      setSnack(t('failedToCopy'));
                    }
                  }
                } else {
                  setSnack(t('noMetadataForPlatform', { platform: platformLabels[platform] }));
                }
              }}
              onCopyAll={async (platform, metaOverride) => {
                const meta = metaOverride ?? selectedRow?.meta?.byPlatform?.[platform];
                if (meta) {
                  const title = (meta.title ?? '').trim();
                  const description = (meta.description ?? '').trim();
                  const hashtags = (meta.hashtags ?? '').trim();
                  const parts: string[] = [];
                  if (title) parts.push(title);
                  if (description) parts.push(description);
                  if (hashtags) parts.push(hashtags);
                  
                  if (parts.length > 0) {
                    const allText = parts.join('\n\n');
                    try {
                      if (navigator?.clipboard?.writeText) {
                        await navigator.clipboard.writeText(allText);
                      } else {
                        await window.api?.copyText?.(allText);
                      }
                      setSnack(t('copied') + ' (' + platform + ')');
                    } catch (e) {
                      try {
                        await window.api?.copyText?.(allText);
                        setSnack(t('copied') + ' (' + platform + ')');
                      } catch {
                        setSnack(t('failedToCopy'));
                      }
                    }
                  } else {
                    setSnack(t('noMetadataForPlatform', { platform: platformLabels[platform] }));
                  }
                } else {
                  setSnack(t('noMetadataForPlatform', { platform: platformLabels[platform] }));
                }
              }}
              onAssistNow={async (platform: 'youtube' | 'instagram' | 'tiktok') => {
                if (!selectedRow) return;
                if (!requireOnline()) return;
                
                try {
                  // Ensure job exists in jobs.json before triggering assist
                  // Assist Now needs the job to get metadata and file path
                  const current = await window.api?.jobsLoad?.();
                  const jobs = Array.isArray(current) ? current : [];
                  const alreadyDone = getJobsForRow(selectedRow, jobs).some((j) => Boolean(j.run?.[platform]?.done));
                  if (alreadyDone) {
                    setSnack(t('publishSkippedAlreadyPosted', { platform: platformLabels[platform], count: 1 }));
                    return;
                  }
                  const existingJob = jobs.find(j => j.filePath === selectedRow.filePath);
                  
                  // Prepare targets with the selected platform enabled
                  const currentTargets = selectedRow.targets || { youtube: false, instagram: false, tiktok: false };
                  const updatedTargets = {
                    ...currentTargets,
                    [platform]: true, // Enable target for the selected platform
                  };
                  
                  if (!existingJob) {
                    // Create job if it doesn't exist (for immediate assist without scheduling)
                    const newJob: ScheduledJob = {
                      id: newId(),
                      filePath: selectedRow.filePath,
                      publishAtUtcMs: Date.now(), // Use current time as placeholder (not used for immediate assist)
                      targets: updatedTargets,
                      visibility: selectedRow.visibility || 'private',
                      selfDeclaredMadeForKids: selectedRow.selfDeclaredMadeForKids ?? false,
                      createdAt: selectedRow.createdAt || Date.now(),
                    };
                    jobs.push(newJob);
                  } else {
                    // Update existing job to enable target for the selected platform
                    existingJob.targets = updatedTargets;
                    existingJob.selfDeclaredMadeForKids = selectedRow.selfDeclaredMadeForKids ?? false;
                  }
                  
                  await window.api?.jobsSave?.(jobs);
                  setScheduledJobs(jobs);
                  
                  // Update row targets to reflect the enabled platform
                  await updateTargetsForRow(selectedRow, updatedTargets);
                  
                  const res: any = await (window.api?.autouploadTriggerAssist as any)?.({
                    filePath: selectedRow.filePath,
                    platform,
                  });
                  
                  if (res?.ok) {
                    // Mark as posted immediately (same as "Open Instagram/TikTok Now")
                    // Capture timestamp before calling upsertJobRunForPlatform
                    const postedAt = Date.now();
                    await upsertJobRunForPlatform({
                      row: selectedRow,
                      platform,
                      ok: true,
                      publishAtUtcMs: postedAt,
                    });

                    // Update row targets only (status comes from jobs.json)
                    updateRow(selectedRow.id, (r) => {
                      const upload = { ...(r.upload || {}) };
                      delete upload[platform];
                      return { ...r, targets: updatedTargets, upload };
                    });

                    setSnack(t('assistTriggeredMarkedPosted', { platform: platformLabels[platform] }));
                    // upsertJobRunForPlatform already calls loadJobs(), but we need to ensure
                    // selectedRowPlatformStatus recalculates. Force a small delay to allow
                    // React to process the scheduledJobs update.
                    await new Promise(resolve => setTimeout(resolve, 50));
                  } else {
                    if (res?.error) {
                      handleNetworkError(res.error);
                    }
                    setSnack(res?.error || t('failedToTriggerAssist'));
                  }
                } catch (e) {
                  handleNetworkError(e);
                  console.error('Assist now error:', e);
                  setSnack(t('failedToTriggerAssist'));
                }
              }}
              onOpenUploadPage={(platform) => {
                const url = platform === 'instagram' 
                  ? 'https://www.instagram.com/'
                  : 'https://www.tiktok.com/upload';
                window.api?.openExternal?.(url);
              }}
              onRevealFile={async () => {
                if (selectedRow?.filePath) {
                  try {
                    const result = await window.api?.showItemInFolder?.(selectedRow.filePath);
                    if (result?.ok) {
                      setSnack(t('revealFile'));
                    } else if (result?.notFound) {
                      setSnack(t('revealFileMovedOrRenamed'));
                    } else {
                      setSnack(t('failedToRevealFile'));
                    }
                  } catch (e) {
                    console.error(e);
                    setSnack(t('failedToRevealFile'));
                  }
                }
              }}
              onMarkAsPosted={async (platform) => {
                if (!selectedRow) return;
                
                try {
                  const res: any = await window.api?.autouploadMarkAsPosted?.({
                    filePath: selectedRow.filePath,
                    platform,
                  });
                  
                  if (res?.ok) {
                    setSnack(t('markedAsPosted', { platform: platformLabels[platform] }));
                    // Update row status optimistically
                    updateRow(selectedRow.id, (r) => ({
                      ...r,
                      upload: {
                        ...r.upload,
                        [platform]: {
                          status: 'Done',
                          message: t('markedAsPostedShort'),
                          updatedAt: Date.now(),
                        },
                      },
                      targets: {
                        ...(r.targets || { youtube: false, instagram: false, tiktok: false }),
                        [platform]: true,
                      },
                    }));
                    // Reload jobs to sync and wait for it to complete
                    await loadJobs();
                  } else {
                    setSnack(res?.error || t('failedToMarkAsPosted'));
                  }
                } catch (e) {
                  console.error('Mark as posted error:', e);
                  setSnack(t('failedToMarkAsPosted'));
                }
              }}
              onCopyFirstComment={async () => {
                if (!selectedRow) return;
                
                // Try to read first comment from metadata
                try {
                  const outputs = await window.api?.readOutputsForPath?.(selectedRow.filePath);
                  const firstComment = outputs?.firstComment || outputs?.meta?.firstComment;
                  
                  if (firstComment) {
                    await window.api?.copyText?.(firstComment);
                    setSnack(t('copied'));
                  } else {
                    setSnack(t('noFirstCommentFound'));
                  }
                } catch (e) {
                  console.error('Failed to copy first comment:', e);
                  setSnack(t('failedToCopyFirstComment'));
                }
              }}
              onEditPlan={() => {
                if (selectedRow) {
                  setScheduleDialogRow(selectedRow);
                  setScheduleDialogOpen(true);
                }
              }}
              onRemovePlatformJob={async (platform: 'youtube' | 'instagram' | 'tiktok') => {
                if (!selectedRow) return;
                const job = scheduledJobs.find(
                  (j) => j.filePath === selectedRow.filePath && Boolean(j.targets?.[platform]),
                );
                if (!job) return;
                await removeJob(job.id, platform);
              }}
              onRemovePlan={async () => {
                if (!selectedRow) return;
                
                try {
                  // Remove all jobs for this file
                  const current = await window.api?.jobsLoad?.();
                  const jobs = Array.isArray(current) ? current : [];
                  const updatedJobs = jobs.filter(j => j.filePath !== selectedRow.filePath);
                  
                  await window.api?.jobsSave?.(updatedJobs);
                  setScheduledJobs(updatedJobs);
                  
                  // Update row to clear publishAt, reset publishMode, and reset targets
                  updateRow(selectedRow.id, (r) => ({
                    ...r,
                    publishAt: null,
                    publishMode: 'now' as const,
                    publishSource: 'manual' as const,
                    targets: { youtube: false, instagram: false, tiktok: false },
                  }));
                  
                  setSnack(t('planRemoved'));
                } catch (e) {
                  console.error('Failed to remove plan:', e);
                  setSnack(t('failedToRemovePlan'));
                }
              }}
              onDeleteMetadata={async (platform) => {
                if (!selectedRow) return;
                
                try {
                  const res = await window.api?.deleteMetadataForPlatform?.({
                    filePath: selectedRow.filePath,
                    platform,
                  });
                  
                  if (res?.ok) {
                    setSnack(t('deletedPlatformMetadata', { platform: platformLabels[platform] }));
                    // Note: Persistent tombstone is now handled in main.mjs (outputs:deletePlatform)
                    // It marks metadata as deleted in deleted_metadata.json which survives reloads
                    
                    // Also keep in-memory ref for immediate UI updates (optional, for faster response)
                    if (!recentlyDeletedMetadataRef.current.has(selectedRow.filePath)) {
                      recentlyDeletedMetadataRef.current.set(selectedRow.filePath, new Set());
                    }
                    recentlyDeletedMetadataRef.current.get(selectedRow.filePath)!.add(platform);
                    
                    // Increment counter to force DataGrid re-render
                    setMetadataUpdateCounter(prev => prev + 1);
                    // Immediately update state to remove metadata for this platform
                    // Find row by filePath and update only that row
                    const rowToUpdate = Array.from(rowsById.values()).find(r => r.filePath === selectedRow.filePath);
                    if (rowToUpdate) {
                      updateRow(rowToUpdate.id, (r) => {
                        const updatedMeta = r.meta ? { ...r.meta } : { byPlatform: {}, raw: null };
                        if (updatedMeta.byPlatform) {
                          const updatedByPlatform = { ...updatedMeta.byPlatform };
                          delete updatedByPlatform[platform];
                          updatedMeta.byPlatform = updatedByPlatform;
                        }
                        return {
                          ...r,
                          meta: updatedMeta,
                        };
                      });
                      
                      // Update rowsRef for consistency
                      const updated = rowsRef.current.map((r) => {
                        if (r.filePath !== selectedRow.filePath) return r;
                        const updatedMeta = r.meta ? { ...r.meta } : { byPlatform: {}, raw: null };
                        if (updatedMeta.byPlatform) {
                          const updatedByPlatform = { ...updatedMeta.byPlatform };
                          delete updatedByPlatform[platform];
                          updatedMeta.byPlatform = updatedByPlatform;
                        }
                        return {
                          ...r,
                          meta: updatedMeta,
                        };
                      });
                      // Update rowsRef for consistency
                      rowsRef.current = updated;
                    }
        
        // Also refresh from disk to ensure consistency (force refresh to bypass scroll checks)
        // Persistent tombstone in main.mjs will prevent restore of deleted metadata
        setTimeout(() => {
          refreshOutputsForPath(selectedRow.filePath, true);
        }, 500);
      } else {
        setSnack(res?.error || t('failedToDeleteMetadata'));
      }
    } catch (e) {
      console.error('Failed to delete metadata:', e);
      setSnack(t('failedToDeleteMetadata'));
    }
  }}
              onSaveMetadata={async (platform, title, description, hashtags) => {
                if (!selectedRow) return;
                
                try {
                  const res = await (window.api as any)?.updatePlatformMetadata?.({
                    filePath: selectedRow.filePath,
                    platform,
                    title,
                    description,
                    hashtags,
                  });
                  
                  if (res?.ok) {
                    setSnack(t('savedPlatformMetadata', { platform: platformLabels[platform] }));
                    // Refresh from disk to ensure consistency
                    setTimeout(() => {
                      refreshOutputsForPath(selectedRow.filePath, true);
                    }, 100);
                  } else {
                    setSnack(res?.error || t('failedToSaveMetadata'));
                  }
                } catch (e) {
                  console.error('Failed to save metadata:', e);
                  setSnack(t('failedToSaveMetadata'));
                }
              }}
              onRemovePostedPlan={async (platform: 'youtube' | 'instagram' | 'tiktok') => {
                if (!selectedRow) return;
                await removePostedStatusForPlatform(selectedRow, platform);
              }}
              formatForGrid={(ts: number | null | undefined, mode: 'now' | 'schedule', tz: string) => formatForGrid(ts, mode, getIanaTimeZone(tz))}
              timeZoneId={timeZoneId}
            />
          </Box>

          {/* Legacy Details Panel (hidden, kept for reference) */}
          <Paper
            sx={{
              width: 420,
              p: 3,
              borderRadius: 3,
              display: 'none', // Hide old panel
              background: dark
                ? 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.8) 100%)'
                : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.9) 100%)',
              border: `1px solid ${dark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(79, 70, 229, 0.1)'}`,
              boxShadow: dark
                ? '0 8px 32px rgba(0, 0, 0, 0.3)'
                : '0 8px 32px rgba(0, 0, 0, 0.08)',
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 2,
                    background: dark
                      ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                      : 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Typography variant="h6">📋</Typography>
                </Box>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  {t('details')}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={0.5}>
                <Button
                  size="small"
                  variant="text"
                  onClick={collapseDetails}
                  sx={{ textTransform: 'none', minWidth: 'auto', px: 1 }}
                >
                  {t('collapseAll')}
                </Button>
                <Button
                  size="small"
                  variant="text"
                  onClick={expandDetails}
                  sx={{ textTransform: 'none', minWidth: 'auto', px: 1 }}
                >
                  {t('expandAll')}
                </Button>
              </Stack>
            </Stack>

            <Popover
              open={Boolean(sortMenuAnchor)}
              anchorEl={sortMenuAnchor}
              onClose={() => setSortMenuAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            >
              <List dense sx={{ p: 0.5, minWidth: 200 }}>
                <ListItemButton
                  selected={sortBy === 'added'}
                  onClick={() => {
                    setSortBy('added');
                    setSortMenuAnchor(null);
                  }}
                >
                  <ListItemText 
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography>{t('sortByAdded')}</Typography>
                        {sortBy === 'added' && <Typography sx={{ color: 'primary.main' }}>✓</Typography>}
                      </Stack>
                    } 
                  />
                </ListItemButton>
                <ListItemButton
                  selected={sortBy === 'name'}
                  onClick={() => {
                    setSortBy('name');
                    setSortMenuAnchor(null);
                  }}
                >
                  <ListItemText 
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography>{t('sortByName')}</Typography>
                        {sortBy === 'name' && <Typography sx={{ color: 'primary.main' }}>✓</Typography>}
                      </Stack>
                    } 
                  />
                </ListItemButton>
                <ListItemButton
                  selected={sortBy === 'date'}
                  onClick={() => {
                    setSortBy('date');
                    setSortMenuAnchor(null);
                  }}
                >
                  <ListItemText 
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography>{t('sortByDate')}</Typography>
                        {sortBy === 'date' && <Typography sx={{ color: 'primary.main' }}>✓</Typography>}
                      </Stack>
                    } 
                  />
                </ListItemButton>
              </List>
            </Popover>

            {!selectedRow && (
              <Paper
                elevation={0}
                sx={{
                  p: 3,
                  textAlign: 'center',
                  borderRadius: 2,
                  bgcolor: dark ? 'rgba(99, 102, 241, 0.05)' : 'rgba(79, 70, 229, 0.03)',
                  border: `1px dashed ${dark ? 'rgba(99, 102, 241, 0.3)' : 'rgba(79, 70, 229, 0.2)'}`,
                }}
              >
                <Typography variant="h3" sx={{ mb: 1, opacity: 0.5 }}>
                  👆
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('selectRow')}
            </Typography>
              </Paper>
            )}

            {selectedRow && <Divider sx={{ my: 2 }} />}

            {selectedRow ? (
              <>
                {/* Metadata FIRST (so users don't need to scroll) */}
                <Accordion
                  disableGutters
                  expanded={detailsOpen.metadata}
                  onChange={(_e, v) => setDetailsOpen((s) => ({ ...s, metadata: v }))}
                >
                  <AccordionSummary
                    expandIcon={<Typography variant="caption">▾</Typography>}
                    sx={{ px: 0, minHeight: 40 }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%', pr: 1 }}>
                      <Typography variant="subtitle2">{t('metadata')}</Typography>
                      <Box sx={{ flexGrow: 1 }} />
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {t('source')}: {selectedRow.meta?.byPlatform?.[metaPlatform]?.source ?? '—'}
                      </Typography>
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails sx={{ px: 0, pt: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap' }} useFlexGap>
                      <FormControl size="small" sx={{ minWidth: 160 }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {t('platform')}
                        </Typography>
                        <Select value={metaPlatform} onChange={(e) => setMetaPlatform(e.target.value as any)}>
                          <MenuItem value="youtube">{platformLabels.youtube}</MenuItem>
                          <MenuItem value="instagram">{platformLabels.instagram}</MenuItem>
                          <MenuItem value="tiktok">{platformLabels.tiktok}</MenuItem>
                        </Select>
                      </FormControl>

                      <Box sx={{ flexGrow: 1 }} />

                      <Tooltip title={t('tooltipReload')}>
                        <span>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => selectedRow.filePath && refreshOutputsForPath(selectedRow.filePath, false, true)}
                        disabled={metaLoadingFor === selectedRow.filePath}
                      >
                        {t('reload')}
                      </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title={t('tooltipCopy')}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                            const byPlatform = selectedRow.meta?.byPlatform || {};
                            const platforms = ['youtube', 'instagram', 'tiktok'] as const;
                            const parts: string[] = [];
                            
                            for (const platform of platforms) {
                              const p = byPlatform[platform];
                              if (p && (p.title || p.description || p.hashtags)) {
                                const platformName = platformLabels[platform];
                                parts.push(`=== ${platformName.toUpperCase()} ===`);
                                if (p.title) parts.push(`${t('title')}:\n${p.title}`);
                                if (p.description) parts.push(`\n${t('description')}:\n${p.description}`);
                                if (p.hashtags) parts.push(`\n${t('hashtags')}:\n${p.hashtags}`);
                                parts.push('\n');
                              }
                            }
                            
                            const blob = parts.join('\n').trim();
                          copyToClipboard(blob);
                        }}
                      >
                        {t('copyAll')}
                      </Button>
                      </Tooltip>
                      <Tooltip title={t('tooltipOpenExports')}>
                      <Button
                        size="small"
                        variant="outlined"
                          onClick={() => window.api?.openExportsForPath?.(metaPlatform as MetaPlatform, selectedRow.filePath)}
                      >
                        {t('openExports')}
                      </Button>
                      </Tooltip>
                      <Tooltip title={t('tooltipOpenOutputs')}>
                      <Button size="small" variant="outlined" onClick={() => window.api?.openOutputsRoot?.()}>
                        {t('openOutputs')}
                      </Button>
                      </Tooltip>
                      <Tooltip title={t('tooltipUploadYouTube')}>
                        <span>
                          <Button
                            size="small"
                            variant="contained"
                            disabled={!ytConnected}
                            onClick={async () => {
                            if (!selectedRow) return;
                            if (!requireOnline()) return;
                            if (!guardUploadAndScheduleAccess()) return;
                            let uploadReservationId: string | null = null;
                            const uploadReservedNote = t('uploadCreditsReserved', { count: 1 });
                            try {
                              const requestId = createRequestId();
                              const reservation = await reserveUpload(requestId, 1);
                              uploadReservationId = reservation.reservation_id;
                            } catch (err) {
                              handleBillingError(err, 'upload');
                              return;
                            }
                            const publishAtUtcMs =
                              selectedRow.publishMode === 'schedule' && typeof selectedRow.publishAt === 'number'
                                ? selectedRow.publishAt
                                : null;
                            try {
                              
                              // Read metadata from exports files (same as automatic upload)
                              const outputs = await window.api?.readOutputsForPath?.(selectedRow.filePath);
                              const exports = outputs?.exports?.youtube || {};
                              const meta = outputs?.meta?.platforms?.youtube || {};
                              
                              // Prefer exports over metadata
                              const title = (exports?.title || meta?.title || selectedRow.filename || '').trim();
                              let description = (exports?.description || meta?.description || '').trim();
                              const tagsRaw = (exports?.hashtags || meta?.hashtags || '').trim();
                              
                              // Process tags: split by spaces, commas, newlines, remove #, filter empty (for API)
                              const tags = tagsRaw
                                ? tagsRaw
                                    .split(/[,\n\r\t ]+/g)
                                    .map((x: string) => x.trim())
                                    .filter(Boolean)
                                    .map((x: string) => (x.startsWith('#') ? x.slice(1) : x))
                                    .join(' ')
                                : '';
                              // Append hashtags to description so they appear in video description on YouTube
                              const hashtagsForDesc = tags ? tags.split(/\s+/).filter(Boolean).map((t) => (t.startsWith('#') ? t.replace(/^#+/, '#') : `#${t}`)).join(' ') : '';
                              if (hashtagsForDesc) description = description ? `${description}\n\n${hashtagsForDesc}` : hashtagsForDesc;

                              const payload = {
                                filePath: selectedRow.filePath,
                                title,
                                description,
                                tags,
                                publishAt: publishAtUtcMs,
                                privacyStatus: selectedRow.visibility,
                                selfDeclaredMadeForKids: selectedRow.selfDeclaredMadeForKids ?? false,
                              } as const;

                              setSnack(`${t('uploadingToPlatform', { platform: platformLabels.youtube })} ${uploadReservedNote}`);
                              const res: any = await window.api?.youtubeUpload?.(payload);
                              
                              if (res?.ok && res?.videoId) {
                                if (uploadReservationId) {
                                  try {
                                    const snapshot = await finalizeQuota(uploadReservationId);
                                    setUsageSnapshot(snapshot);
                                  } catch (err) {
                                    console.error('Failed to finalize upload quota:', err);
                                  }
                                }
                                setSnack(t('uploadSuccessWithId', { platform: platformLabels.youtube, id: res.videoId }));
                                await upsertJobRunForPlatform({
                                  row: selectedRow,
                                  platform: 'youtube',
                                  ok: true,
                                  videoId: res.videoId,
                                  publishAtUtcMs: payload.publishAt ?? null,
                                });
                              } else {
                                if (res?.error) {
                                  handleNetworkError(res.error);
                                }
                                if (uploadReservationId) {
                                  try {
                                    await releaseQuota(uploadReservationId);
                                  } catch (err) {
                                    console.error('Failed to release upload quota:', err);
                                  }
                                }
                                const isDailyLimit = isYoutubeDailyLimitError(res);
                                if (isDailyLimit) {
                                  setYoutubeDailyLimitModalOpen(true);
                                }
                                const failureMsg = isDailyLimit ? t('youtubeDailyLimitBlockedStatus') : (res?.error || t('uploadFailedToPlatform', { platform: platformLabels.youtube }));
                                setSnack(`${failureMsg} ${t('uploadCreditsReleased', { count: 1 })}`);
                                await upsertJobRunForPlatform({
                                  row: selectedRow,
                                  platform: 'youtube',
                                  ok: false,
                                  error: isDailyLimit ? t('youtubeDailyLimitBlockedStatus') : (res?.error || t('uploadFailed')),
                                  publishAtUtcMs: payload.publishAt ?? null,
                                });
                              }

                              updateRow(selectedRow.id, (r) => {
                                const upload = { ...(r.upload || {}) };
                                if (upload.youtube) {
                                  delete upload.youtube;
                                }
                                return { ...r, upload };
                              });
                            } catch (e: any) {
                              console.error(e);
                              handleNetworkError(e);
                              if (uploadReservationId) {
                                try {
                                  await releaseQuota(uploadReservationId);
                                } catch (err) {
                                  console.error('Failed to release upload quota:', err);
                                }
                              }
                              // Extract error message from YouTube API or IPC error
                              // IPC errors may have the message nested: "Error invoking remote method 'youtube:upload': Error: ..."
                              let errorMsg = e?.message || String(e);
                              // Extract the actual error message if it's wrapped in IPC error
                              if (errorMsg.includes('Error invoking remote method')) {
                                const match = errorMsg.match(/Error: (.+)$/);
                                if (match && match[1]) {
                                  errorMsg = match[1];
                                }
                              }
                              
                              let userFriendlyMsg = t('uploadFailedToPlatform', { platform: platformLabels.youtube });
                              const isDailyLimit = /daily upload limit|upload limit|verify your account|phone verification|youtube verification|exceeded the number of videos|verification required|channel verification/i.test(errorMsg);
                              if (isDailyLimit) {
                                userFriendlyMsg = t('youtubeUploadLimitReached');
                                setYoutubeLimitWarning(userFriendlyMsg);
                                setYoutubeDailyLimitModalOpen(true);
                              } else if (errorMsg.includes('quota')) {
                                userFriendlyMsg = t('youtubeQuotaExceeded');
                              } else if (errorMsg.includes('Not connected')) {
                                userFriendlyMsg = t('youtubeNotConnectedPrompt');
                              } else if (errorMsg) {
                                userFriendlyMsg = t('uploadFailedToPlatformWithError', { platform: platformLabels.youtube, error: errorMsg });
                              }
                              
                              setSnack(`${userFriendlyMsg} ${t('uploadCreditsReleased', { count: 1 })}`);
                              await upsertJobRunForPlatform({
                                row: selectedRow,
                                platform: 'youtube',
                                ok: false,
                                error: isDailyLimit ? t('youtubeDailyLimitBlockedStatus') : userFriendlyMsg,
                                publishAtUtcMs,
                              });
                              updateRow(selectedRow.id, (r) => {
                                const upload = { ...(r.upload || {}) };
                                if (upload.youtube) {
                                  delete upload.youtube;
                                }
                                return { ...r, upload };
                              });
                            }
                          }}
                        >
                          {t('uploadToPlatformButton', { platform: platformLabels.youtube })}
                        </Button>
                        </span>
                      </Tooltip>
                    </Stack>

                    {metaLoadingFor === selectedRow.filePath ? (
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {t('loadingOutputs')}
                      </Typography>
                    ) : selectedRow.meta?.byPlatform?.[metaPlatform] ? (
                      <Stack spacing={1}>
                        <TextField
                          size="small"
                          label={t('title')}
                          value={selectedRow.meta.byPlatform[metaPlatform].title ?? ''}
                          fullWidth
                          inputProps={{ spellCheck: false }}
                          InputProps={{
                            endAdornment: (
                              <InputAdornment position="end">
                                <Button
                                  size="small"
                                  onClick={() => {
                                    const txt = selectedRow.meta?.byPlatform?.[metaPlatform]?.title ?? '';
                                    copyToClipboard(txt);

                                  }}
                                >
                                  {t('copy')}
                                </Button>
                              </InputAdornment>
                            ),
                          }}
                        />
                        <TextField
                          size="small"
                          label={t('description')}
                          value={selectedRow.meta.byPlatform[metaPlatform].description ?? ''}
                          fullWidth
                          multiline
                          minRows={5}
                          inputProps={{ spellCheck: false }}
                          InputProps={{
                            endAdornment: (
                              <InputAdornment position="end">
                                <Button
                                  size="small"
                                  onClick={() => {
                                    const txt = selectedRow.meta?.byPlatform?.[metaPlatform]?.description ?? '';
                                    copyToClipboard(txt);

                                  }}
                                >
                                  {t('copy')}
                                </Button>
                              </InputAdornment>
                            ),
                          }}
                        />
                        <TextField
                          size="small"
                          label={t('hashtags')}
                          value={selectedRow.meta.byPlatform[metaPlatform].hashtags ?? ''}
                          fullWidth
                          multiline
                          minRows={2}
                          inputProps={{ spellCheck: false }}
                          InputProps={{
                            endAdornment: (
                              <InputAdornment position="end">
                                <Button
                                  size="small"
                                  onClick={() => {
                                    const txt = selectedRow.meta?.byPlatform?.[metaPlatform]?.hashtags ?? '';
                                    copyToClipboard(txt);

                                  }}
                                >
                                  {t('copy')}
                                </Button>
                              </InputAdornment>
                            ),
                          }}
                        />
                      </Stack>
                    ) : (
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        No metadata found in outputs for this file.
                      </Typography>
                    )}
                  </AccordionDetails>
                </Accordion>

                <Divider sx={{ my: 1.5 }} />

                {/* Schedule */}
                <Accordion
                  disableGutters
                  expanded={detailsOpen.schedule}
                  onChange={(_e, v) => setDetailsOpen((s) => ({ ...s, schedule: v }))}
                >
                  <AccordionSummary expandIcon={<Typography variant="caption">▾</Typography>} sx={{ px: 0, minHeight: 40 }}>
                    <Typography variant="subtitle2">{t('schedule')}</Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ px: 0, pt: 0 }}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={selectedRow.publishMode === 'schedule'}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setSelectedPatch({
                              publishMode: on ? 'schedule' : 'now',
                              publishSource: on ? selectedRow.publishSource : 'manual',
                            });
                          }}
                        />
                      }
                      label={t('schedule')}
                    />

                    {selectedRow.publishMode === 'schedule' && (
                      <TextField
                        size="small"
                        fullWidth
                        label={`${t('publish')} (${timeZoneId === 'SYSTEM' ? systemTzOffset : timeZoneId})`}
                        type="datetime-local"
                        value={toDateTimeLocalValue(selectedRow.publishAt, getIanaTimeZone(timeZoneId))}
                        onChange={(e) => {
                          const ms = parseDateTimeLocalValue(e.target.value, getIanaTimeZone(timeZoneId));
                          setSelectedPatch({ publishAt: ms, publishSource: 'manual' });
                        }}
                        helperText={t('editsTz')}
                        sx={{ mb: 1 }}
                        InputLabelProps={{ shrink: true }}
                      />
                    )}

                    {selectedRow.publishSource === 'manual' && autoEnabled && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          setSelectedPatch({ publishSource: 'auto' });
                          setTimeout(() => void rescheduleAll(), 0);
                        }}
                        sx={{ mb: 1 }}
                      >
                        {t('resetAuto')}
                      </Button>
                    )}
                  </AccordionDetails>
                </Accordion>

                <Divider sx={{ my: 1.5 }} />

                {/* Scheduled Jobs */}
                <Accordion
                  disableGutters
                  expanded={detailsOpen.jobs}
                  onChange={(_e, v) => setDetailsOpen((s) => ({ ...s, jobs: v }))}
                >
                  <AccordionSummary expandIcon={<Typography variant="caption">▾</Typography>} sx={{ px: 0, minHeight: 40 }}>
                    <Typography variant="subtitle2">{t('scheduledJobs')}</Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ px: 0, pt: 0 }}>
                    <Stack spacing={1}>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {t('createScheduledJobHint')}
                      </Typography>
                      <TextField
                        size="small"
                        fullWidth
                        label={`${t('publish')} (${timeZoneId === 'SYSTEM' ? systemTzOffset : timeZoneId})`}
                        type="datetime-local"
                        value={jobPublishAt}
                        onChange={(e) => setJobPublishAt(e.target.value)}
                        InputLabelProps={{ shrink: true }}
                      />
                      <FormGroup row>
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={jobTargets.youtube}
                              onChange={(e) => setJobTargets((t) => ({ ...t, youtube: e.target.checked }))}
                            />
                          }
                          label={platformLabels.youtube}
                        />
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={jobTargets.instagram}
                              onChange={(e) => setJobTargets((t) => ({ ...t, instagram: e.target.checked }))}
                            />
                          }
                          label={platformLabels.instagram}
                        />
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={jobTargets.tiktok}
                              onChange={(e) => setJobTargets((t) => ({ ...t, tiktok: e.target.checked }))}
                            />
                          }
                          label={platformLabels.tiktok}
                        />
                      </FormGroup>
                      <Button size="small" variant="contained" onClick={addJob} disabled={!selectedRow || !jobPublishAt}>
                        {t('addJob')}
                      </Button>
                      <Divider />
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="subtitle2">{t('jobsCount', { count: scheduledJobs.length })}</Typography>
                        <Box sx={{ flexGrow: 1 }} />
                        <Button size="small" variant="outlined" onClick={loadJobs}>
                          {t('refresh')}
                        </Button>
                      </Stack>
                      {scheduledJobs.length === 0 ? (
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {t('noScheduledJobs')}
                        </Typography>
                      ) : (
                        <Stack spacing={0.5}>
                          {scheduledJobs
                            .filter((j) => j.filePath === selectedRow?.filePath)
                            .map((job) => {
                              const publishDate = new Date(job.publishAtUtcMs);
                              const isDue = publishDate.getTime() <= Date.now();
                              const ytDone = job.run?.youtube?.done ?? false;
                              const igDone = job.run?.instagram?.done ?? false;
                              const tiktokDone = job.run?.tiktok?.done ?? false;
                              return (
                                <Paper key={job.id} variant="outlined" sx={{ p: 1 }}>
                                  <Stack spacing={0.5}>
                                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                                      <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                                        {formatForGrid(job.publishAtUtcMs, 'schedule', getIanaTimeZone(timeZoneId))}
                                      </Typography>
                                      <Tooltip title={t('deleteJob')}>
                                        <span>
                                          <IconButton
                                            size="small"
                                            color="error"
                                            onClick={() => removeJob(job.id)}
                                            disabled={ytDone || igDone || tiktokDone}
                                            sx={{ p: 0.5 }}
                                          >
                                            <Typography variant="caption">🗑️</Typography>
                                          </IconButton>
                                        </span>
                                      </Tooltip>
                                    </Stack>
                                    <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
                                      {(job.targets?.youtube ?? false) && (
                                        <Chip
                                          size="small"
                                          label={ytDone ? (job.run?.youtube?.ok ? `${platformLabels.youtube} ✓` : `${platformLabels.youtube} ✗`) : platformLabels.youtube}
                                          color={ytDone ? (job.run?.youtube?.ok ? 'success' : 'error') : 'default'}
                                          onDelete={ytDone ? undefined : () => removeJob(job.id, 'youtube')}
                                          deleteIcon={
                                            <Tooltip title={t('removePlatformFromJob', { platform: platformLabels.youtube })}>
                                              <span>
                                                <IconButton size="small" sx={{ p: 0 }}>
                                                  <Typography variant="caption">✕</Typography>
                                                </IconButton>
                                              </span>
                                            </Tooltip>
                                          }
                                        />
                                      )}
                                      {(job.targets?.instagram ?? false) && (
                                        <Chip
                                          size="small"
                                          label={igDone ? (job.run?.instagram?.ok ? `${platformLabels.instagram} ✓` : `${platformLabels.instagram} ✗`) : platformLabels.instagram}
                                          color={igDone ? (job.run?.instagram?.ok ? 'success' : 'error') : 'default'}
                                          onDelete={igDone ? undefined : () => removeJob(job.id, 'instagram')}
                                          deleteIcon={
                                            <Tooltip title={t('removePlatformFromJob', { platform: platformLabels.instagram })}>
                                              <span>
                                                <IconButton size="small" sx={{ p: 0 }}>
                                                  <Typography variant="caption">✕</Typography>
                                                </IconButton>
                                              </span>
                                            </Tooltip>
                                          }
                                        />
                                      )}
                                      {(job.targets?.tiktok ?? false) && (
                                        <Chip
                                          size="small"
                                          label={tiktokDone ? (job.run?.tiktok?.ok ? `${platformLabels.tiktok} ✓` : `${platformLabels.tiktok} ✗`) : platformLabels.tiktok}
                                          color={tiktokDone ? (job.run?.tiktok?.ok ? 'success' : 'error') : 'default'}
                                          onDelete={tiktokDone ? undefined : () => removeJob(job.id, 'tiktok')}
                                          deleteIcon={
                                            <Tooltip title={t('removePlatformFromJob', { platform: platformLabels.tiktok })}>
                                              <span>
                                                <IconButton size="small" sx={{ p: 0 }}>
                                                  <Typography variant="caption">✕</Typography>
                                                </IconButton>
                                              </span>
                                            </Tooltip>
                                          }
                                        />
                                      )}
                                    </Stack>
                                    {isDue && !ytDone && !igDone && !tiktokDone && (
                                      <Typography variant="caption" sx={{ color: 'warning.main' }}>
                                        {t('dueWaitingForRunner')}
                                      </Typography>
                                    )}
                                    {job.run?.youtube?.videoId && (
                                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                        {t('videoIdLabel', { id: job.run.youtube.videoId })}
                                      </Typography>
                                    )}
                                  </Stack>
                                </Paper>
                              );
                            })}
                        </Stack>
                      )}
                    </Stack>
                  </AccordionDetails>
                </Accordion>

                <Divider sx={{ my: 1.5 }} />

                {/* File / Status / Visibility */}
                <Accordion
                  disableGutters
                  expanded={detailsOpen.file}
                  onChange={(_e, v) => setDetailsOpen((s) => ({ ...s, file: v }))}
                >
                  <AccordionSummary expandIcon={<Typography variant="caption">▾</Typography>} sx={{ px: 0, minHeight: 40 }}>
                    <Typography variant="subtitle2">{t('file')}</Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ px: 0, pt: 0 }}>
                    <Typography variant="subtitle2">{t('file')}</Typography>
                    <Typography sx={{ mb: 1 }}>{selectedRow.filename}</Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 1 }}>
                      {selectedRow.filePath}
                    </Typography>

                    <Typography variant="subtitle2">{t('status')}</Typography>
                    <Typography sx={{ mb: 1 }}>{selectedRow.status}</Typography>

                    <Typography variant="subtitle2">{t('visibility')}</Typography>

<Typography variant="subtitle2" sx={{ mt: 1 }}>{t('targets')}</Typography>
<FormGroup row sx={{ mb: 1 }}>
  <FormControlLabel
    control={
      <Checkbox
        checked={selectedRow.targets?.youtube ?? true}
        onChange={(e) =>
          setSelectedPatch({
            targets: {
              ...(selectedRow.targets ?? { youtube: true, instagram: false, tiktok: false }),
              youtube: e.target.checked,
            },
          })
        }
      />
    }
    label={platformLabels.youtube}
  />
  <FormControlLabel
    control={
      <Checkbox
        checked={selectedRow.targets?.instagram ?? false}
        onChange={(e) =>
          setSelectedPatch({
            targets: {
              ...(selectedRow.targets ?? { youtube: true, instagram: false, tiktok: false }),
              instagram: e.target.checked,
            },
          })
        }
      />
    }
    label={platformLabels.instagram}
  />
  <FormControlLabel
    control={
      <Checkbox
        checked={selectedRow.targets?.tiktok ?? false}
        onChange={(e) =>
          setSelectedPatch({
            targets: {
              ...(selectedRow.targets ?? { youtube: true, instagram: false, tiktok: false }),
              tiktok: e.target.checked,
            },
          })
        }
      />
    }
    label={platformLabels.tiktok}
  />
</FormGroup>

                    <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                      <Select
                        value={selectedRow.visibility}
                        onChange={(e) => setSelectedPatch({ visibility: e.target.value as Visibility })}
                      >
                        <MenuItem value="private">{t('visibilityPrivate')}</MenuItem>
                        <MenuItem value="unlisted">{t('visibilityUnlisted')}</MenuItem>
                        <MenuItem value="public">{t('visibilityPublic')}</MenuItem>
                      </Select>
                    </FormControl>
                  </AccordionDetails>
                </Accordion>

                <Divider sx={{ my: 1.5 }} />

                {/* Pipeline Log LAST + collapsed by default */}
                <Accordion
                  disableGutters
                  expanded={detailsOpen.log}
                  onChange={(_e, v) => setDetailsOpen((s) => ({ ...s, log: v }))}
                  data-testid="pipeline-log-accordion"
                >
                  <AccordionSummary
                    data-testid="pipeline-log-expand"
                    expandIcon={<Typography variant="caption">▾</Typography>}
                    sx={{ px: 0, minHeight: 40 }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%', pr: 1 }}>
                      <Typography variant="subtitle2">{t('pipelineLog')}</Typography>
                      <Box sx={{ flexGrow: 1 }} />
                      <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {((selectedRow.log || '—').trimEnd().split(/\r?\n/).slice(-1)[0])}
                      </Typography>
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails data-testid="pipeline-log-panel" sx={{ px: 0, pt: 0 }}>
                    <Paper
                      variant="outlined"
                      sx={{
                        mt: 1,
                        p: 1,
                        height: 250,
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        fontSize: 12,
                      }}
                    >
                      {selectedRow.log || '—'}
                    </Paper>
                  </AccordionDetails>
                </Accordion>
              </>
            ) : (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('noRow')}
              </Typography>
            )}
          </Paper>
        </Stack>

        {/* Command Bar - conditionally rendered at bottom */}
        {interfaceSettings.commandBarPosition === 'bottom' && (
          <CommandBar
            position="bottom"
            onAddClick={() => setAddDialogOpen(true)}
            onPlanClick={() => {
              if (!guardUploadAndScheduleAccess()) return;
              setPlannerOpen(true);
            }}
            onPublishClick={() => {
              if (!guardUploadAndScheduleAccess()) return;
              setPublishDialogOpen(true);
            }}
            disablePlanAndPublish={!planAccess.isActive}
            youtubeConnected={ytConnected}
            metadataQueueCounts={metadataQueueCounts}
            onStopCurrentMetadata={handleStopCurrentMetadata}
            onCancelQueuedMetadata={handleCancelQueuedMetadata}
            onStopAllMetadata={() => void stopAllMetadataJobs('user')}
            onInterfaceClick={() => setInterfaceDialogOpen(true)}
            onAccountClick={() => setAccountDialogOpen(true)}
            onCustomAIClick={() => setCustomAIDialogOpen(true)}
            onDiagnosticsClick={() => setDiagnosticsDialogOpen(true)}
            onDeveloperModeClick={() => setDeveloperModeDialogOpen(true)}
            onTestConnection={async () => {
              try {
                const validation: any = await window.api?.youtubeValidateCredentials?.();
                if (validation?.ok) {
                  setSnack(t('credentialsOk', { clientId: validation.clientIdPrefix, file: validation.filePath }));
                } else {
                  const message = validation?.message || t('credentialsNotFound');
                  setSnack(t('credentialsValidationFailedWithMessage', { message }));
                }
              } catch (e) {
                console.error(e);
                setSnack(t('failedToCheckCredentials'));
              }
            }}
            onReconnect={async () => {
              try {
                const msg = await window.api?.youtubeConnect?.();
                if (msg?.ok) {
                  setSnack(t('reconnectedToPlatform', { platform: platformLabels.youtube }));
                } else {
                  setSnack(t('reconnectFailed', { message: msg?.message || t('unknownError') }));
                }
                void refreshYtConnected();
              } catch (e) {
                console.error(e);
                setSnack(t('failedToReconnect'));
              }
            }}
            onDisconnect={disconnectYouTube}
            dark={dark}
          />
        )}
      </Box>

      <Snackbar
        open={Boolean(snack)}
        autoHideDuration={2000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{
          '& .MuiSnackbarContent-root': {
            borderRadius: 2,
          },
        }}
      >
        <Alert
          onClose={() => setSnack(null)}
          severity="success"
          variant="filled"
          icon={<Typography>✓</Typography>}
          sx={{
            borderRadius: 2,
            boxShadow: dark
              ? '0 8px 16px rgba(16, 185, 129, 0.3)'
              : '0 8px 16px rgba(16, 185, 129, 0.2)',
            fontWeight: 500,
          }}
        >
          {snack}
        </Alert>
      </Snackbar>

      {/* Undo Snackbar */}
      <Snackbar
        open={undoSnackOpen}
        autoHideDuration={10000}
        onClose={() => {
          setUndoSnackOpen(false);
          setDeletedItems([]);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="info"
          variant="filled"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={undoDelete}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              {t('undo')}
            </Button>
          }
          sx={{
            borderRadius: 2,
            fontWeight: 500,
          }}
        >
          {deletedItems.length} {deletedItems.length === 1 ? t('item') : t('items')} {t('removed')}
        </Alert>
      </Snackbar>

      {/* Context Menu */}
      <Menu
        open={contextMenu !== null}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
      >
        {!contextMenu?.platform && (
          <MenuItem
            onClick={() => {
              if (contextMenu?.rowId) {
                setItemsToDelete([contextMenu.rowId]);
                setDeleteConfirmOpen(true);
              } else if (selectedIds.length > 0) {
                setItemsToDelete(selectedIds);
                setDeleteConfirmOpen(true);
              }
              handleCloseContextMenu();
            }}
          >
            <Typography sx={{ mr: 1 }}>🗑️</Typography>
            {t('removeFromProject')}
          </MenuItem>
        )}
        {selectedIds.length > 0 && !contextMenu?.rowId && (
          <>
            <MenuItem
              onClick={() => {
                setTemplateDialogOpen(true);
                handleCloseContextMenu();
              }}
            >
              <Typography sx={{ mr: 1 }}>📋</Typography>
              {t('savedMetadata')}
            </MenuItem>
            <Divider />
          </>
        )}
        {contextMenu?.rowId && contextMenu?.platform && (() => {
          const row = rows.find(r => r.id === contextMenu.rowId);
          if (!row || !contextMenu.platform) return null;
          
          // Check platform status to see if there's a job
          const platformStatus = getPlatformStatus(row, contextMenu.platform);
          const hasJob = platformStatus.status !== 'none';
          
          // Check if row has metadata for this platform
          const platformMeta = row.meta?.byPlatform?.[contextMenu.platform];
          const hasMetadata = platformMeta && (platformMeta.title || platformMeta.description || platformMeta.hashtags);
          
          return (
            <>
              {hasJob && (() => {
                // Find the job for this row and platform
                const job = scheduledJobs.find(j => 
                  j.filePath === row.filePath && 
                  (j.targets?.[contextMenu.platform!] ?? false)
                );
                
                return job ? (
                  <MenuItem
                    onClick={async () => {
                      await removeJob(job.id, contextMenu.platform!);
                      handleCloseContextMenu();
                    }}
                  >
                    <Typography sx={{ mr: 1 }}>🗑️</Typography>
                    {t('deletePlatformJob', { platform: platformLabels[contextMenu.platform!] })}
                  </MenuItem>
                ) : null;
              })()}
              {hasMetadata && (
                <MenuItem
                  onClick={async () => {
                    const rowToDelete = rows.find(r => r.id === contextMenu.rowId);
                    if (!rowToDelete || !contextMenu.platform) {
                      handleCloseContextMenu();
                      return;
                    }
                    
                    try {
                      const res = await window.api?.deleteMetadataForPlatform?.({
                        filePath: rowToDelete.filePath,
                        platform: contextMenu.platform,
                      });
                      
                      if (res?.ok) {
                        setSnack(t('deletedPlatformMetadata', { platform: platformLabels[contextMenu.platform!] }));
                        
                        // Track deleted metadata in ref
                        if (!recentlyDeletedMetadataRef.current.has(rowToDelete.filePath)) {
                          recentlyDeletedMetadataRef.current.set(rowToDelete.filePath, new Set());
                        }
                        recentlyDeletedMetadataRef.current.get(rowToDelete.filePath)!.add(contextMenu.platform);
                        
                        // Increment counter to force DataGrid re-render
                        setMetadataUpdateCounter(prev => prev + 1);
                        
                        // Immediately update state to remove metadata for this platform
                        const rowToUpdate = Array.from(rowsById.values()).find(r => r.filePath === rowToDelete.filePath);
                        if (rowToUpdate) {
                          updateRow(rowToUpdate.id, (r) => {
                            const updatedMeta = r.meta ? { ...r.meta } : { byPlatform: {}, raw: null };
                            if (updatedMeta.byPlatform) {
                              const updatedByPlatform = { ...updatedMeta.byPlatform };
                              delete updatedByPlatform[contextMenu.platform!];
                              updatedMeta.byPlatform = updatedByPlatform;
                            }
                            return {
                              ...r,
                              meta: updatedMeta,
                            };
                          });
                          
                          // Update rowsRef for consistency
                          rowsRef.current = rowsRef.current.map((r) => {
                            if (r.filePath !== rowToDelete.filePath) return r;
                            const updatedMeta = r.meta ? { ...r.meta } : { byPlatform: {}, raw: null };
                            if (updatedMeta.byPlatform) {
                              const updatedByPlatform = { ...updatedMeta.byPlatform };
                              delete updatedByPlatform[contextMenu.platform!];
                              updatedMeta.byPlatform = updatedByPlatform;
                            }
                            return {
                              ...r,
                              meta: updatedMeta,
                            };
                          });
                        }
                        
                        // Refresh from disk after a delay
                        setTimeout(() => {
                          refreshOutputsForPath(rowToDelete.filePath, true);
                        }, 500);
                      } else {
                        setSnack(res?.error || t('failedToDeleteMetadata'));
                      }
                    } catch (e) {
                      console.error('Failed to delete metadata:', e);
                      setSnack(t('failedToDeleteMetadata'));
                    }
                    
                    handleCloseContextMenu();
                  }}
                >
                  <Typography sx={{ mr: 1 }}>🗑️</Typography>
                  {t('deletePlatformMetadataAction', { platform: platformLabels[contextMenu.platform!] })}
                </MenuItem>
              )}
              <MenuItem
                onClick={async () => {
                  const row = rows.find(r => r.id === contextMenu.rowId);
                  if (row && contextMenu.platform) {
                    try {
                      const res: any = await window.api?.autouploadMarkAsPosted?.({
                        filePath: row.filePath,
                        platform: contextMenu.platform,
                      });
                      
                      if (res?.ok) {
                        setSnack(t('markedAsPosted', { platform: platformLabels[contextMenu.platform!] }));
                        // Update row status optimistically
                        updateRow(row.id, (r) => ({
                          ...r,
                          upload: {
                            ...r.upload,
                            [contextMenu.platform!]: {
                              status: 'Done',
                              message: t('markedAsPostedShort'),
                              updatedAt: Date.now(),
                            },
                          },
                          targets: {
                            ...(r.targets || { youtube: false, instagram: false, tiktok: false }),
                            [contextMenu.platform!]: true,
                          },
                        }));
                        // Reload jobs to sync and wait for it to complete
                        await loadJobs();
                      } else {
                        setSnack(res?.error || t('failedToMarkAsPosted'));
                      }
                    } catch (e) {
                      console.error('Mark as posted error:', e);
                      setSnack(t('failedToMarkAsPosted'));
                    }
                  }
                  handleCloseContextMenu();
                }}
              >
                <Typography sx={{ mr: 1 }}>✓</Typography>
                {t('markAsPostedWithPlatform', { platform: platformLabels[contextMenu.platform!] })}
              </MenuItem>
            </>
          );
        })()}
        {contextMenu?.rowId && !contextMenu?.platform && (
          <MenuItem
            onClick={async () => {
              const row = rows.find(r => r.id === contextMenu.rowId);
              if (row) {
                try {
                  const result = await window.api?.showItemInFolder?.(row.filePath);
                  if (result?.ok) {
                    setSnack(t('revealFile'));
                  } else if (result?.notFound) {
                    setSnack(t('revealFileMovedOrRenamed'));
                  } else {
                    setSnack(t('failedToRevealFile'));
                  }
                } catch (e) {
                  console.error(e);
                  setSnack(t('failedToRevealFile'));
                }
              }
              handleCloseContextMenu();
            }}
          >
            <Typography sx={{ mr: 1 }}>📂</Typography>
            {t('revealFile')}
          </MenuItem>
        )}
        {contextMenu?.rowId && !contextMenu?.platform && (() => {
          const row = rows.find(r => r.id === contextMenu.rowId);
          if (!row) return null;
          // Check if row has metadata for any platform
          const hasMetadata = row.meta?.byPlatform && (
            row.meta.byPlatform.youtube || 
            row.meta.byPlatform.instagram || 
            row.meta.byPlatform.tiktok
          );
          if (!hasMetadata) return null;
          return (
            <MenuItem
              onClick={async () => {
                const rowToDelete = rows.find(r => r.id === contextMenu.rowId);
                if (!rowToDelete) {
                  handleCloseContextMenu();
                  return;
                }
                
                try {
                  const platforms: ('youtube' | 'instagram' | 'tiktok')[] = ['youtube', 'instagram', 'tiktok'];
                  let successCount = 0;
                  let errorCount = 0;
                  
                  // Delete metadata for all platforms
                  for (const platform of platforms) {
                    try {
                      const res = await window.api?.deleteMetadataForPlatform?.({
                        filePath: rowToDelete.filePath,
                        platform,
                      });
                      
                      if (res?.ok) {
                        successCount++;
                        // Track deleted metadata in ref
                        if (!recentlyDeletedMetadataRef.current.has(rowToDelete.filePath)) {
                          recentlyDeletedMetadataRef.current.set(rowToDelete.filePath, new Set());
                        }
                        recentlyDeletedMetadataRef.current.get(rowToDelete.filePath)!.add(platform);
                      } else {
                        errorCount++;
                      }
                    } catch (e) {
                      console.error(`Failed to delete ${platform} metadata:`, e);
                      errorCount++;
                    }
                  }
                  
                  // Update state to remove all metadata
                  if (successCount > 0) {
                    const rowToUpdate = Array.from(rowsById.values()).find(r => r.filePath === rowToDelete.filePath);
                    if (rowToUpdate) {
                      updateRow(rowToUpdate.id, (r) => {
                        return {
                          ...r,
                          meta: { byPlatform: {}, raw: r.meta?.raw || null },
                        };
                      });
                      
                      // Update rowsRef for consistency
                      rowsRef.current = rowsRef.current.map((r) => {
                        if (r.filePath !== rowToDelete.filePath) return r;
                        return {
                          ...r,
                          meta: { byPlatform: {}, raw: r.meta?.raw || null },
                        };
                      });
                    }
                    
                    // Increment counter to force DataGrid re-render
                    setMetadataUpdateCounter(prev => prev + 1);
                    
                    // Refresh from disk after a delay
                    setTimeout(() => {
                      refreshOutputsForPath(rowToDelete.filePath, true);
                    }, 500);
                    
                    if (errorCount === 0) {
                      setSnack(t('deletedMetadataAllPlatforms'));
                    } else {
                      setSnack(t('deletedMetadataPartial', { successCount, errorCount }));
                    }
                  } else {
                    setSnack(t('failedToDeleteMetadata'));
                  }
                } catch (e) {
                  console.error('Failed to delete all metadata:', e);
                  setSnack(t('failedToDeleteMetadata'));
                }
                
                handleCloseContextMenu();
              }}
            >
              <Typography sx={{ mr: 1 }}>🗑️</Typography>
              {t('deleteMetadata')}
            </MenuItem>
          );
        })()}
      </Menu>

      {/* Delete Confirm Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setItemsToDelete([]);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('removeFromProject')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('removeItemsConfirm', { count: itemsToDelete.length })}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            {t('removeItemsDisclaimer')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setDeleteConfirmOpen(false);
            setItemsToDelete([]);
          }}>
            {t('cancel')}
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            variant="contained"
            color="error"
          >
            {t('removeVideo')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete from app (archived) confirmation */}
      <Dialog
        open={deleteFromAppConfirmOpen}
        onClose={() => {
          setDeleteFromAppConfirmOpen(false);
          setItemsToDeleteFromApp([]);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('deleteRowFromAppTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('deleteRowFromAppBody')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDeleteFromAppConfirmOpen(false);
              setItemsToDeleteFromApp([]);
            }}
          >
            {t('cancel')}
          </Button>
          <Button onClick={handleDeleteFromAppConfirm} variant="contained" color="error">
            {t('delete')}
          </Button>
        </DialogActions>
      </Dialog>

    </ThemeProvider>
  );
}
