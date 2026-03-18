import * as React from 'react';
import { Alert, Box, Button, LinearProgress, Typography } from '@mui/material';
import type { UpdateStatus } from '../vite-env.d';

export default function UpdateBanner() {
  const [status, setStatus] = React.useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    const off = window.api?.onUpdateStatus?.((s: UpdateStatus) => setStatus(s));
    return () => off?.();
  }, []);

  if (!status || status.disabled) return null;
  const state = status.state ?? 'idle';
  if (state === 'idle' || state === 'none') return null;
  if (dismissed && state !== 'ready' && state !== 'downloading') return null;

  const version = status.info?.version ?? '';

  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 12,
        left: 12,
        zIndex: 9999,
        maxWidth: 420,
      }}
    >
      <Alert
        severity={state === 'error' ? 'error' : 'info'}
        action={
          state === 'available' ? (
            <>
              <Button color="inherit" size="small" onClick={() => window.api?.updateDownload?.()}>
                Update
              </Button>
              <Button
                color="inherit"
                size="small"
                onClick={async () => {
                  setDismissed(true);
                  try {
                    await window.api?.updateDismiss?.();
                  } catch {
                    // ignore
                  }
                }}
              >
                Later
              </Button>
            </>
          ) : state === 'error' ? (
            <>
              <Button color="inherit" size="small" onClick={() => window.api?.updateCheck?.()}>
                Retry
              </Button>
              <Button color="inherit" size="small" onClick={() => setDismissed(true)}>
                Dismiss
              </Button>
            </>
          ) : undefined
        }
        onClose={state === 'error' ? () => setDismissed(true) : undefined}
      >
        {state === 'checking' && 'Checking for updates…'}
        {state === 'available' && (
          <Typography component="span">
            Update available {version ? `(v${version})` : ''}
          </Typography>
        )}
        {state === 'downloading' && (
          <Box sx={{ width: '100%', minWidth: 200 }}>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Downloading update… {status.progress?.percent != null ? `${Math.round(status.progress.percent)}%` : ''}
            </Typography>
            <LinearProgress
              variant={status.progress?.percent != null ? 'determinate' : 'indeterminate'}
              value={status.progress?.percent ?? 0}
              sx={{ height: 6, borderRadius: 1 }}
            />
          </Box>
        )}
        {state === 'ready' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography component="span">Update ready – Restart to install</Typography>
            <Button
              color="inherit"
              size="small"
              variant="outlined"
              onClick={() => window.api?.updateInstall?.()}
              sx={{ borderColor: 'currentColor' }}
            >
              Restart now
            </Button>
            <Button
              color="inherit"
              size="small"
              onClick={async () => {
                setDismissed(true);
                try {
                  await window.api?.updateDismiss?.();
                } catch {
                  // ignore
                }
              }}
            >
              Later
            </Button>
          </Box>
        )}
        {state === 'error' && (
          <Typography component="span">
            Update error: {status.error ?? 'Unknown error'}
          </Typography>
        )}
      </Alert>
    </Box>
  );
}
