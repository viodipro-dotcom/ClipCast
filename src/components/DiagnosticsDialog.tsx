import * as React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Stack,
  Typography,
  TextField,
  LinearProgress,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { UsageSnapshot } from '../billing/usage';
import type { DiagnosticsAuthSnapshot } from '../vite-env.d.ts';

export interface DiagnosticsDialogProps {
  open: boolean;
  onClose: () => void;
  youtubeConnected: boolean;
  autoUploadEnabled: boolean;
  silentMode: boolean;
  jobsCount: number;
  processingCount: number;
  /** Safe auth summary for support bundle (no tokens). */
  signedIn: boolean;
  userEmail?: string | null;
  plan?: string | null;
  subscriptionStatus?: string | null;
  usageSnapshot?: UsageSnapshot | null;
  onSnack?: (message: string) => void;
}

export default function DiagnosticsDialog({
  open,
  onClose,
  youtubeConnected,
  autoUploadEnabled,
  silentMode,
  jobsCount,
  processingCount,
  signedIn,
  userEmail,
  plan,
  subscriptionStatus,
  usageSnapshot,
  onSnack,
}: DiagnosticsDialogProps) {
  const { t } = useTranslation();
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [lastExportPath, setLastExportPath] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setExportError(null);
      setLastExportPath(null);
      setExporting(false);
    }
  }, [open]);

  const buildAuthSnapshot = React.useCallback((): DiagnosticsAuthSnapshot => {
    return {
      signedIn,
      userEmail: userEmail ?? null,
      plan: plan ?? null,
      subscriptionStatus: subscriptionStatus ?? null,
      usage: usageSnapshot
        ? {
            uploads_used: usageSnapshot.uploads_used,
            metadata_used: usageSnapshot.metadata_used,
            uploads_limit: usageSnapshot.uploads_limit,
            metadata_limit: usageSnapshot.metadata_limit,
          }
        : null,
    };
  }, [signedIn, userEmail, plan, subscriptionStatus, usageSnapshot]);

  const handleExport = React.useCallback(async () => {
    if (!window.api?.diagnosticsExportSupportBundle) {
      setExportError(t('diagnosticsExportUnavailable'));
      return;
    }
    setExporting(true);
    setExportError(null);
    setLastExportPath(null);
    try {
      const res = await window.api.diagnosticsExportSupportBundle(buildAuthSnapshot());
      if (res.ok && res.path) {
        setLastExportPath(res.path);
        onSnack?.(`${t('diagnosticsExported')}: ${res.path}`);
      } else {
        const err = !res.ok ? res.error : t('diagnosticsExportFailed');
        setExportError(err);
        onSnack?.(`${t('diagnosticsExportFailed')}: ${err}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setExportError(msg);
      onSnack?.(`${t('diagnosticsExportFailed')}: ${msg}`);
    } finally {
      setExporting(false);
    }
  }, [buildAuthSnapshot, onSnack, t]);

  const handleOpenFolder = React.useCallback(async () => {
    if (!lastExportPath || !window.api?.pathsOpen) return;
    try {
      const r = await window.api.pathsOpen(lastExportPath);
      if (!r.ok && r.error) {
        onSnack?.(r.error);
      }
    } catch (e) {
      onSnack?.(e instanceof Error ? e.message : String(e));
    }
  }, [lastExportPath, onSnack]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('diagnostics')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
              {t('connections')}
            </Typography>
            <Stack spacing={1}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2">{t('youtube')}:</Typography>
                <Chip
                  label={youtubeConnected ? t('connected') : t('notConnected')}
                  color={youtubeConnected ? 'success' : 'default'}
                  size="small"
                />
              </Stack>
            </Stack>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
              {t('autoUpload')}
            </Typography>
            <Stack spacing={1}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2">{t('enabled')}:</Typography>
                <Chip
                  label={autoUploadEnabled ? t('yes') : t('no')}
                  color={autoUploadEnabled ? 'success' : 'default'}
                  size="small"
                />
              </Stack>
              {autoUploadEnabled && (
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">{t('silent')}:</Typography>
                  <Chip
                    label={silentMode ? t('yes') : t('no')}
                    color={silentMode ? 'warning' : 'default'}
                    size="small"
                  />
                </Stack>
              )}
            </Stack>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
              {t('jobs')}
            </Typography>
            <Stack spacing={1}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2">{t('total')}:</Typography>
                <Chip label={jobsCount} size="small" />
              </Stack>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2">{t('processing')}:</Typography>
                <Chip
                  label={processingCount}
                  color={processingCount > 0 ? 'info' : 'default'}
                  size="small"
                />
              </Stack>
            </Stack>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
              {t('diagnosticsSupportBundle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {t('diagnosticsSupportBundleHint')}
            </Typography>
            {exporting && <LinearProgress sx={{ mb: 1 }} />}
            {exportError && (
              <Alert severity="error" sx={{ mb: 1 }}>
                {exportError}
              </Alert>
            )}
            {lastExportPath && (
              <Alert severity="success" sx={{ mb: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t('diagnosticsExported')}
                </Typography>
                <TextField
                  value={lastExportPath}
                  fullWidth
                  size="small"
                  margin="dense"
                  InputProps={{ readOnly: true }}
                  sx={{ mt: 1 }}
                />
                <Button variant="outlined" size="small" sx={{ mt: 1 }} onClick={handleOpenFolder}>
                  {t('diagnosticsOpenFolder')}
                </Button>
              </Alert>
            )}
            <Button variant="contained" disabled={exporting} onClick={handleExport} sx={{ textTransform: 'none' }}>
              {t('diagnosticsExport')}
            </Button>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
