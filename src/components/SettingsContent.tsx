import * as React from 'react';
import {
  Box,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { UI_LANGUAGE_OPTIONS } from '../i18n/languages';

export interface SettingsContentProps {
  dark: boolean;
  lang: string;
  uiScale: number;
  onDarkChange: (dark: boolean) => void;
  onLangChange: (lang: string) => void;
  onUiScaleChange: (scale: number) => void;
  onSnack: (message: string) => void;
}

export default function SettingsContent({
  dark,
  lang,
  uiScale,
  onDarkChange,
  onLangChange,
  onUiScaleChange,
  onSnack,
}: SettingsContentProps) {
  const { t } = useTranslation();
  return (
    <Box sx={{ p: 1.5, width: '100%' }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {t('uiSize')}
      </Typography>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
        <IconButton
          size="small"
          onClick={() => onUiScaleChange(Math.min(2.0, Math.max(1.0, Math.round((uiScale - 0.05) * 100) / 100)))}
          aria-label={t('uiSizeDecrease')}
        >
          <Typography variant="caption">A−</Typography>
        </IconButton>
        <Typography variant="caption" sx={{ minWidth: 48, textAlign: 'center' }}>
          {Math.round(uiScale * 100)}%
        </Typography>
        <IconButton
          size="small"
          onClick={() => onUiScaleChange(Math.min(2.0, Math.max(1.0, Math.round((uiScale + 0.05) * 100) / 100)))}
          aria-label={t('uiSizeIncrease')}
        >
          <Typography variant="caption">A+</Typography>
        </IconButton>
      </Stack>
      <Slider
        size="small"
        value={Math.min(200, Math.max(100, Math.round(uiScale * 100)))}
        min={100}
        max={200}
        step={5}
        onChange={(e, v) => {
          e.preventDefault();
          e.stopPropagation();
          const n = Array.isArray(v) ? v[0] : v;
          const newScale = Math.min(2.0, Math.max(1.0, n / 100));
          onUiScaleChange(newScale);
        }}
        onChangeCommitted={(e, v) => {
          e.preventDefault();
          e.stopPropagation();
          const n = Array.isArray(v) ? v[0] : v;
          const newScale = Math.min(2.0, Math.max(1.0, n / 100));
          onUiScaleChange(newScale);
        }}
        sx={{ mb: 1 }}
      />

      <Divider sx={{ my: 1 }} />

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

      <Divider sx={{ my: 1 }} />

      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {t('language')}
      </Typography>
      <FormControl fullWidth size="small" sx={{ mt: 0.5 }}>
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
              sx: {
                maxHeight: 300,
              },
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

      <Divider sx={{ my: 1 }} />

      <List dense disablePadding>
        <ListItemButton onClick={() => onSnack(t('comingSoon'))} sx={{ borderRadius: 1 }}>
          <ListItemText primary={t('account')} />
        </ListItemButton>
        <ListItemButton onClick={() => onSnack(t('comingSoon'))} sx={{ borderRadius: 1 }}>
          <ListItemText primary={t('manageBilling')} />
        </ListItemButton>
        <ListItemButton onClick={() => onSnack(t('comingSoon'))} sx={{ borderRadius: 1 }}>
          <ListItemText primary={t('subscription')} />
        </ListItemButton>
      </List>
    </Box>
  );
}

