import * as React from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

export interface PublishDialogProps {
  open: boolean;
  onClose: () => void;
  onPublish: (options: PublishOptions) => void;
  selectedCount: number;
  autoUploadEnabled: boolean;
  onAutoUploadEnabledChange: (value: boolean) => void;
  silentMode: boolean;
  onSilentModeChange: (value: boolean) => void;
}

export type PublishPreset = 'youtube-only' | 'metadata-only';

export interface PublishOptions {
  preset: PublishPreset;
}

export default function PublishDialog({
  open,
  onClose,
  onPublish,
  selectedCount,
  autoUploadEnabled,
  onAutoUploadEnabledChange,
  silentMode,
  onSilentModeChange,
}: PublishDialogProps) {
  const { t } = useTranslation();
  const [preset, setPreset] = React.useState<PublishPreset>('youtube-only');

  const handlePublish = () => {
    onPublish({ preset });
    onClose();
  };

  // Calculate button text based on selected preset/options
  const getButtonText = (): string => {
    if (preset === 'metadata-only') {
      return t('publishButtonGenerate');
    }
    if (preset === 'youtube-only') {
      return t('publishButtonYouTube');
    }
    // Fallback
    return t('publish');
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {t('publishSelected')} ({selectedCount} {selectedCount === 1 ? t('item') : t('items')})
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {/* Auto Upload Toggle */}
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={autoUploadEnabled}
                  onChange={(e) => onAutoUploadEnabledChange(e.target.checked)}
                  color="secondary"
                  data-testid="auto-upload-switch"
                  inputProps={{ 'aria-label': t('autoUpload') }}
                />
              }
              label={
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Typography>🚀</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t('autoUpload')}
                  </Typography>
                </Stack>
              }
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
              {t('tooltipAutoUpload')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
              {t('autoUploadNote')}
            </Typography>

            {autoUploadEnabled && (
              <Box sx={{ mt: 1 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={silentMode}
                      onChange={(e) => onSilentModeChange(e.target.checked)}
                      color="default"
                      sx={{
                        '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                          backgroundColor: 'rgba(96, 165, 250, 0.9)',
                          opacity: 1,
                        },
                      }}
                      data-testid="silent-mode-switch"
                      inputProps={{ 'aria-label': t('silent') }}
                    />
                  }
                  label={
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Typography>{silentMode ? '🔇' : '🔈'}</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {t('silent')}
                      </Typography>
                    </Stack>
                  }
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                  {silentMode ? t('silentModeOnDesc') : t('silentModeOffDesc')}
                </Typography>
              </Box>
            )}
          </Box>

          <Divider />

          <RadioGroup
            value={preset}
            onChange={(e) => setPreset(e.target.value as PublishPreset)}
          >
            <FormControlLabel
              value="youtube-only"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body1" sx={{ fontWeight: 500 }}>
                    {t('youtubeOnly')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('youtube')}: {t('uploadAndSchedule')}
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="metadata-only"
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body1" sx={{ fontWeight: 500 }}>
                    {t('metadataOnly')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('generateMetadataOnly')}
                  </Typography>
                </Box>
              }
            />
          </RadioGroup>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button onClick={handlePublish} variant="contained">
          {getButtonText()}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
