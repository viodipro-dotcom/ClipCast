import * as React from 'react';
import {
  Box,
  Button,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

export interface IntegrationsSettingsPanelProps {
  open: boolean;
  onSnack: (message: string) => void;
  /** Refreshes YouTube connected chip elsewhere */
  onYouTubeStateMayChange?: () => void;
}

export default function IntegrationsSettingsPanel({
  open,
  onSnack,
  onYouTubeStateMayChange,
}: IntegrationsSettingsPanelProps) {
  const { t } = useTranslation();
  const [openAiHint, setOpenAiHint] = React.useState<string | null>(null);
  const [openAiConfigured, setOpenAiConfigured] = React.useState(false);
  const [openAiKeyInput, setOpenAiKeyInput] = React.useState('');
  const [cloudTranscript, setCloudTranscript] = React.useState(false);
  const [googleClientId, setGoogleClientId] = React.useState('');
  const [googleSecret, setGoogleSecret] = React.useState('');

  const load = React.useCallback(async () => {
    try {
      const st = await window.api?.secretsGetOpenAIApiKeyStatus?.();
      if (st && 'configured' in st) {
        setOpenAiConfigured(Boolean(st.configured));
        setOpenAiHint(typeof st.hint === 'string' ? st.hint : null);
      }
      const settings = await window.api?.settingsGet?.();
      if (settings && typeof settings.openAiCloudTranscript === 'boolean') {
        setCloudTranscript(settings.openAiCloudTranscript);
      } else {
        setCloudTranscript(false);
      }
      const g = await window.api?.secretsGetGoogleOAuthClient?.();
      if (g && 'clientId' in g && g.clientId) {
        setGoogleClientId(String(g.clientId));
      } else {
        setGoogleClientId('');
      }
      setOpenAiKeyInput('');
      setGoogleSecret('');
    } catch (e) {
      console.error('[IntegrationsSettingsPanel] load failed', e);
    }
  }, []);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const saveOpenAi = async () => {
    const key = openAiKeyInput.trim();
    if (!key) {
      onSnack('Paste an API key first');
      return;
    }
    try {
      await window.api?.secretsSetOpenAIApiKey?.(key);
      setOpenAiKeyInput('');
      const st = await window.api?.secretsGetOpenAIApiKeyStatus?.();
      setOpenAiConfigured(Boolean(st?.configured));
      setOpenAiHint(typeof st?.hint === 'string' ? st.hint : null);
      onSnack(t('integrationsOpenAiSaveOk'));
    } catch (e) {
      console.error(e);
      onSnack(String(e));
    }
  };

  const clearOpenAi = async () => {
    try {
      await window.api?.secretsClearOpenAIApiKey?.();
      setOpenAiConfigured(false);
      setOpenAiHint(null);
      onSnack(t('integrationsOpenAiClearOk'));
    } catch (e) {
      console.error(e);
      onSnack(String(e));
    }
  };

  const onCloudChange = async (_: unknown, checked: boolean) => {
    const prev = cloudTranscript;
    setCloudTranscript(checked);
    try {
      await window.api?.settingsSet?.({ openAiCloudTranscript: checked });
    } catch (e) {
      console.error(e);
      setCloudTranscript(prev);
      onSnack(String(e));
    }
  };

  const saveGoogle = async () => {
    const id = googleClientId.trim();
    if (!id) {
      onSnack('Client ID is required');
      return;
    }
    try {
      await window.api?.secretsSetGoogleOAuthClient?.(id, googleSecret);
      setGoogleSecret('');
      onSnack(t('integrationsGoogleSaveOk'));
    } catch (e) {
      console.error(e);
      onSnack(String(e));
    }
  };

  const connectYouTube = async () => {
    try {
      const validation = await window.api?.youtubeValidateCredentials?.();
      if (validation && validation.ok === false) {
        onSnack(String(validation?.message || validation?.error || 'Add Google OAuth client credentials first.'));
        return;
      }
      if (validation && 'clientIdValid' in validation && validation.clientIdValid === false) {
        onSnack('Invalid Client ID format (must end with .apps.googleusercontent.com)');
        return;
      }
      await window.api?.youtubeConnect?.();
      onSnack('YouTube connected');
      onYouTubeStateMayChange?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      onSnack(msg);
    }
  };

  return (
    <Box sx={{ pt: 0.5 }}>
      <FormControl fullWidth sx={{ mb: 2 }}>
        <FormLabel sx={{ mb: 0.5, fontWeight: 600 }}>{t('integrationsOpenAiTitle')}</FormLabel>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t('integrationsOpenAiHelper')}
        </Typography>
        <TextField
          size="small"
          type="password"
          autoComplete="off"
          label={t('integrationsOpenAiKey')}
          value={openAiKeyInput}
          onChange={(e) => setOpenAiKeyInput(e.target.value)}
          fullWidth
          sx={{ mb: 1 }}
        />
        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" size="small" onClick={() => void saveOpenAi()}>
            {t('integrationsOpenAiSave')}
          </Button>
          <Button
            variant="outlined"
            size="small"
            color="warning"
            onClick={() => void clearOpenAi()}
            disabled={!openAiConfigured}
          >
            {t('integrationsOpenAiClear')}
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {openAiConfigured
            ? t('integrationsOpenAiStatusOn', { hint: openAiHint || '' })
            : t('integrationsOpenAiStatusOff')}
        </Typography>
      </FormControl>

      <FormControlLabel
        sx={{ display: 'flex', alignItems: 'flex-start', ml: 0, mb: 1 }}
        control={
          <Switch checked={cloudTranscript} onChange={onCloudChange} />
        }
        label={
          <Box>
            <Typography variant="body2">{t('integrationsCloudTranscript')}</Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              {t('integrationsCloudTranscriptHelper')}
            </Typography>
          </Box>
        }
      />
      {cloudTranscript && !openAiConfigured ? (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
          {t('integrationsCloudTranscriptNoKey')}
        </Typography>
      ) : null}

      <Divider sx={{ my: 2 }} />

      <FormControl fullWidth>
        <FormLabel sx={{ mb: 0.5, fontWeight: 600 }}>{t('integrationsYouTubeTitle')}</FormLabel>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t('integrationsYouTubeHelper')}
        </Typography>
        <TextField
          size="small"
          label={t('integrationsGoogleClientId')}
          value={googleClientId}
          onChange={(e) => setGoogleClientId(e.target.value)}
          fullWidth
          sx={{ mb: 1 }}
        />
        <TextField
          size="small"
          type="password"
          autoComplete="new-password"
          label={t('integrationsGoogleClientSecret')}
          value={googleSecret}
          onChange={(e) => setGoogleSecret(e.target.value)}
          fullWidth
          helperText="Leave empty to keep the existing secret when only updating Client ID."
          sx={{ mb: 1 }}
        />
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Button variant="contained" size="small" onClick={() => void saveGoogle()}>
            {t('integrationsGoogleSave')}
          </Button>
          <Button variant="outlined" size="small" onClick={() => void connectYouTube()}>
            {t('integrationsYouTubeConnect')}
          </Button>
        </Stack>
      </FormControl>
    </Box>
  );
}
