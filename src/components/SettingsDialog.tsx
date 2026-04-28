import * as React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Typography,
  Divider,
  Box,
  IconButton,
  Slider,
  Stack,
  Switch,
  MenuItem,
  Select,
} from '@mui/material';
import type { InterfaceSettings } from '../utils/interfaceSettings';
import { useTranslation } from 'react-i18next';
import { UI_LANGUAGE_OPTIONS } from '../i18n/languages';
import IntegrationsSettingsPanel from './IntegrationsSettingsPanel';

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  interfaceSettings: InterfaceSettings;
  onChangeInterfaceSettings: (partial: Partial<InterfaceSettings>) => void;
  dark: boolean;
  onDarkChange: (dark: boolean) => void;
  uiScale: number;
  onUiScaleChange: (scale: number) => void;
  lang: string;
  onLangChange: (lang: string) => void;
  runAtStartup: boolean;
  onRunAtStartupChange: (enabled: boolean) => void;
  onSnack: (message: string) => void;
  onYouTubeStateMayChange?: () => void;
}

export default function SettingsDialog({
  open,
  onClose,
  interfaceSettings,
  onChangeInterfaceSettings,
  dark,
  onDarkChange,
  uiScale,
  onUiScaleChange,
  lang,
  onLangChange,
  runAtStartup,
  onRunAtStartupChange,
  onSnack,
  onYouTubeStateMayChange,
}: SettingsDialogProps) {
  const { t } = useTranslation();

  const handleCommandBarPositionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChangeInterfaceSettings({
      commandBarPosition: event.target.value as 'bottom' | 'top',
    });
  };

  const handlePanelsLayoutChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChangeInterfaceSettings({
      panelsLayout: event.target.value as 'default' | 'swapped',
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('settings')}</DialogTitle>
      <DialogContent
        dividers
        sx={{
          maxHeight: 'min(70vh, 720px)',
        }}
      >
        <Typography component="h2" variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
          {t('settingsTabInterface')}
        </Typography>
        <Box sx={{ pt: 0.5 }}>
          {/* UI size */}
          <FormControl component="fieldset" fullWidth sx={{ mb: 2 }}>
            <FormLabel component="legend" sx={{ mb: 1, fontWeight: 500 }}>
              {t('uiSize')}
            </FormLabel>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
              <IconButton
                size="small"
                onClick={() =>
                  onUiScaleChange(
                    Math.min(2.0, Math.max(0.5, Math.round((uiScale - 0.05) * 100) / 100))
                  )
                }
                aria-label={t('uiSizeDecrease')}
              >
                <Typography variant="caption">A−</Typography>
              </IconButton>
              <Typography variant="body2" sx={{ minWidth: 48, textAlign: 'center' }}>
                {Math.round(uiScale * 100)}%
              </Typography>
              <IconButton
                size="small"
                onClick={() =>
                  onUiScaleChange(
                    Math.min(2.0, Math.max(0.5, Math.round((uiScale + 0.05) * 100) / 100))
                  )
                }
                aria-label={t('uiSizeIncrease')}
              >
                <Typography variant="caption">A+</Typography>
              </IconButton>
            </Stack>
            <Slider
              size="small"
              value={Math.min(200, Math.max(50, Math.round(uiScale * 100)))}
              min={50}
              max={200}
              step={5}
              onChange={(e, v) => {
                e.preventDefault();
                e.stopPropagation();
                const n = Array.isArray(v) ? v[0] : v;
                onUiScaleChange(Math.min(2.0, Math.max(0.5, n / 100)));
              }}
              onChangeCommitted={(e, v) => {
                e.preventDefault();
                e.stopPropagation();
                const n = Array.isArray(v) ? v[0] : v;
                onUiScaleChange(Math.min(2.0, Math.max(0.5, n / 100)));
              }}
            />
          </FormControl>

          <Divider sx={{ my: 2 }} />

          {/* Day/Night (appearance) */}
          <FormControlLabel
            control={
              <Switch
                checked={dark}
                onChange={(e) => {
                  onDarkChange(e.target.checked);
                }}
              />
            }
            label={dark ? t('night') : t('day')}
          />

          <Divider sx={{ my: 2 }} />

          {/* Language */}
          <FormControl fullWidth size="medium" sx={{ mb: 3 }}>
            <FormLabel sx={{ mb: 1, fontWeight: 500 }}>{t('language')}</FormLabel>
            <Select
              value={lang}
              onChange={(e) => {
                onLangChange(String(e.target.value));
              }}
              MenuProps={{
                anchorOrigin: {
                  vertical: 'bottom',
                  horizontal: 'left',
                },
                transformOrigin: {
                  vertical: 'top',
                  horizontal: 'left',
                },
                PaperProps: {
                  sx: { maxHeight: 300 },
                },
              }}
            >
              {UI_LANGUAGE_OPTIONS.map((o) => (
                <MenuItem key={o.code} value={o.code}>
                  {t(o.labelKey, { defaultValue: o.label })}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Divider sx={{ my: 2 }} />

          <FormControl component="fieldset" fullWidth sx={{ mb: 3 }}>
            <FormLabel component="legend" sx={{ mb: 1, fontWeight: 500 }}>
              {t('startup')}
            </FormLabel>
            <FormControlLabel
              control={
                <Switch
                  checked={runAtStartup}
                  onChange={(e) => onRunAtStartupChange(e.target.checked)}
                />
              }
              label={t('runAtStartup')}
            />
            <Typography variant="caption" color="text.secondary" sx={{ ml: 4.5, display: 'block' }}>
              {t('runAtStartupHelper')}
            </Typography>
          </FormControl>

          <Divider sx={{ my: 2 }} />

          <FormControl component="fieldset" fullWidth sx={{ mb: 3 }}>
            <FormLabel component="legend" sx={{ mb: 1, fontWeight: 500 }}>
              {t('commandBarPosition')}
            </FormLabel>
            <RadioGroup
              value={interfaceSettings.commandBarPosition}
              onChange={handleCommandBarPositionChange}
            >
              <FormControlLabel value="top" control={<Radio />} label={t('top')} />
              <FormControlLabel value="bottom" control={<Radio />} label={t('bottom')} />
            </RadioGroup>
          </FormControl>

          <Divider sx={{ my: 2 }} />

          <FormControl component="fieldset" fullWidth>
            <FormLabel component="legend" sx={{ mb: 1, fontWeight: 500 }}>
              {t('panelsLayout')}
            </FormLabel>
            <RadioGroup
              value={interfaceSettings.panelsLayout}
              onChange={handlePanelsLayoutChange}
            >
              <FormControlLabel value="default" control={<Radio />} label={t('default')} />
              <FormControlLabel value="swapped" control={<Radio />} label={t('swapped')} />
            </RadioGroup>
          </FormControl>
        </Box>

        <Divider sx={{ my: 3 }} />

        <Typography component="h2" variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
          {t('settingsTabIntegrations')}
        </Typography>
        <IntegrationsSettingsPanel
          open={open}
          onSnack={onSnack}
          onYouTubeStateMayChange={onYouTubeStateMayChange}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          {t('close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
