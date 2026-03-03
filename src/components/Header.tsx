import * as React from 'react';
import { Box, Stack, Tooltip, IconButton, Typography } from '@mui/material';
import type { SettingsPanelProps } from './SettingsPanel';
import SettingsPanel from './SettingsPanel';
import { useTranslation } from 'react-i18next';

interface HeaderProps {
  dark: boolean;
  settingsOpen: boolean;
  settingsButtonRef: React.RefObject<HTMLButtonElement>;
  settingsAnchorPosition: { top: number; left: number } | undefined;
  onSettingsToggle: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onSettingsClose: () => void;
  settingsPanelProps: SettingsPanelProps;
}

export default function Header({
  dark,
  settingsOpen,
  settingsButtonRef,
  settingsAnchorPosition,
  onSettingsToggle,
  onSettingsClose,
  settingsPanelProps,
}: HeaderProps) {
  const { t } = useTranslation();
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Box
          component="img"
          src="/logo.png"
          alt="ClipCast"
          sx={{
            width: 48,
            height: 48,
            objectFit: 'contain',
            flexShrink: 0,
          }}
        />
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
            {t('appTitle')}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('appSubtitle')}
          </Typography>
        </Box>
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center">
        <Tooltip title={t('settings')}>
          <IconButton
            ref={settingsButtonRef}
            onClick={onSettingsToggle}
            aria-label={t('settings')}
            sx={{
              bgcolor: dark ? 'rgba(99, 102, 241, 0.1)' : 'rgba(79, 70, 229, 0.08)',
              '&:hover': {
                bgcolor: dark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(79, 70, 229, 0.15)',
                transform: 'rotate(90deg)',
              },
              transition: 'all 0.3s ease-in-out',
            }}
          >
            <Typography variant="h6">⚙️</Typography>
          </IconButton>
        </Tooltip>

        <SettingsPanel
          open={settingsOpen}
          anchorEl={settingsButtonRef.current}
          anchorPosition={settingsAnchorPosition}
          onClose={onSettingsClose}
          {...settingsPanelProps}
        />
      </Stack>
    </Stack>
  );
}
