import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

export interface AdvancedDialogProps {
  open: boolean;
  onClose: () => void;
  youtubeConnected: boolean;
  onCheckCredentials: () => void;
  onReconnect: () => void;
  onOpenUserData?: () => void;
  developerMode?: boolean;
}

export default function AdvancedDialog({
  open,
  onClose,
  youtubeConnected,
  onCheckCredentials,
  onReconnect,
  onOpenUserData,
  developerMode = false,
}: AdvancedDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('advanced')}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>

          {/* YouTube Connection */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
              {t('youtubeConnection')}
            </Typography>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography variant="body2" sx={{ minWidth: 100 }}>
                  {t('status')}:
                </Typography>
                <Chip
                  label={youtubeConnected ? t('connected') : t('notConnected')}
                  color={youtubeConnected ? 'success' : 'default'}
                  size="small"
                />
              </Stack>
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={onCheckCredentials}
                  sx={{ textTransform: 'none' }}
                >
                  🔍 {t('testConnection')}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={onReconnect}
                  sx={{ textTransform: 'none' }}
                >
                  🔄 {t('reconnect')}
                </Button>
                {developerMode && onOpenUserData && (
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={onOpenUserData}
                    sx={{ textTransform: 'none' }}
                  >
                    📂 {t('openUserData')}
                  </Button>
                )}
              </Stack>
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
