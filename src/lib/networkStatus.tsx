import * as React from 'react';

export type NetworkStatus = 'online' | 'offline' | 'degraded';

type NetworkState = {
  networkStatus: NetworkStatus;
  lastOnlineAt: number | null;
  lastError: string | null;
};

type NetworkStatusContextValue = NetworkState & {
  retryHeartbeat: () => Promise<boolean>;
  markOffline: (err?: unknown) => void;
};

const NetworkStatusContext = React.createContext<NetworkStatusContextValue | null>(null);

const HEARTBEAT_INTERVAL_MS = 15000;
const HEARTBEAT_TIMEOUT_MS = 3000;
const HEARTBEAT_FAILURE_LIMIT = 2;

const toErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(err);
};

const NETWORK_ERROR_RE = /(ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|network request failed|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|offline)/i;

export const isNetworkError = (err: unknown): boolean => {
  if (err && typeof err === 'object') {
    const candidate = err as { name?: string };
    if (candidate.name === 'AbortError') return true;
  }
  return NETWORK_ERROR_RE.test(toErrorMessage(err));
};

const getHeartbeatConfig = () => {
  const baseUrl = (import.meta as any)?.env?.VITE_SUPABASE_URL as string | undefined;
  if (!baseUrl) return { url: null as string | null, headers: undefined as undefined | Record<string, string> };
  const url = `${String(baseUrl).replace(/\/+$/, '')}/auth/v1/health`;
  return { url, headers: undefined };
};

export const NetworkStatusProvider = ({ children }: { children: React.ReactNode }) => {
  const [networkStatus, setNetworkStatus] = React.useState<NetworkStatus>(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
    return 'degraded';
  });
  const [lastOnlineAt, setLastOnlineAt] = React.useState<number | null>(null);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const failureCountRef = React.useRef(0);
  const inflightRef = React.useRef<Promise<boolean> | null>(null);

  const markOffline = React.useCallback((err?: unknown) => {
    failureCountRef.current = HEARTBEAT_FAILURE_LIMIT;
    setLastError(err ? toErrorMessage(err) : 'Network request failed');
    setNetworkStatus('offline');
  }, []);

  const markOnline = React.useCallback(() => {
    failureCountRef.current = 0;
    setLastError(null);
    setLastOnlineAt(Date.now());
    setNetworkStatus('online');
  }, []);

  const markDegraded = React.useCallback((err?: unknown) => {
    if (err) setLastError(toErrorMessage(err));
    setNetworkStatus((prev) => (prev === 'offline' ? 'offline' : 'degraded'));
  }, []);

  const runHeartbeat = React.useCallback(async () => {
    if (inflightRef.current) return inflightRef.current;
    const { url, headers } = getHeartbeatConfig();
    if (!url) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        markOffline('Browser reported offline');
        return false;
      }
      failureCountRef.current = 0;
      setLastError('Heartbeat URL not configured');
      setNetworkStatus('degraded');
      return false;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
    const promise = (async () => {
      try {
        await fetch(url, {
          method: 'GET',
          headers,
          cache: 'no-store',
          signal: controller.signal,
        });
        markOnline();
        return true;
      } catch (err) {
        failureCountRef.current += 1;
        if (failureCountRef.current >= HEARTBEAT_FAILURE_LIMIT) {
          markOffline(err);
        } else {
          markDegraded(err);
        }
        return false;
      } finally {
        window.clearTimeout(timer);
        inflightRef.current = null;
      }
    })();
    inflightRef.current = promise;
    return promise;
  }, [markDegraded, markOffline, markOnline]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOffline = () => markOffline('Browser reported offline');
    const handleOnline = () => {
      void runHeartbeat();
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [markOffline, runHeartbeat]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    void runHeartbeat();
    const id = window.setInterval(() => {
      void runHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [runHeartbeat]);

  const retryHeartbeat = React.useCallback(() => runHeartbeat(), [runHeartbeat]);

  const value = React.useMemo(
    () => ({
      networkStatus,
      lastOnlineAt,
      lastError,
      retryHeartbeat,
      markOffline,
    }),
    [lastError, lastOnlineAt, markOffline, networkStatus, retryHeartbeat],
  );

  return (
    <NetworkStatusContext.Provider value={value}>
      {children}
    </NetworkStatusContext.Provider>
  );
};

export const useNetworkStatus = () => {
  const ctx = React.useContext(NetworkStatusContext);
  if (!ctx) {
    throw new Error('useNetworkStatus must be used within NetworkStatusProvider');
  }
  return ctx;
};
