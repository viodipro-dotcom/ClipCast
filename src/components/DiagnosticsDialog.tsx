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
  Stack,
  Typography,
  TextField,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

export interface DiagnosticsDialogProps {
  open: boolean;
  onClose: () => void;
  youtubeConnected: boolean;
  autoUploadEnabled: boolean;
  silentMode: boolean;
  jobsCount: number;
  processingCount: number;
}

export default function DiagnosticsDialog({
  open,
  onClose,
  youtubeConnected,
  autoUploadEnabled,
  silentMode,
  jobsCount,
  processingCount,
}: DiagnosticsDialogProps) {
  const { t } = useTranslation();
  const [systemInfo, setSystemInfo] = React.useState<{
    platform: string;
    arch: string;
    version: string;
    userData: string;
  } | null>(null);

  React.useEffect(() => {
    if (open) {
      // Get system info (if available via API)
      setSystemInfo({
        platform: navigator.platform || 'Unknown',
        arch: (navigator as any).hardwareConcurrency ? `${(navigator as any).hardwareConcurrency} cores` : 'Unknown',
        version: '1.0.0', // Could be from package.json
        userData: 'N/A', // Would need IPC to get actual path
      });
    }
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('diagnostics')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {/* Connection Status */}
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

          {/* Auto Upload Status */}
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

          {/* Jobs Status */}
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

          {systemInfo && (
            <>
              <Divider />
              {/* System Info */}
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                  {t('systemInfo')}
                </Typography>
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2">{t('platform')}:</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {systemInfo.platform}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2">{t('architecture')}:</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {systemInfo.arch}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2">{t('version')}:</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {systemInfo.version}
                    </Typography>
                  </Stack>
                </Stack>
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
