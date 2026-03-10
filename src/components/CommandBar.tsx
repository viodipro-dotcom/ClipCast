import * as React from 'react';
import { Box, Button, Chip, IconButton, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import { useTranslation } from 'react-i18next';

export interface CommandBarProps {
  onAddClick: () => void;
  onPlanClick: () => void;
  onPublishClick: () => void;
  disablePlanAndPublish?: boolean;
  youtubeConnected: boolean;
  queueCount: number;
  onInterfaceClick?: () => void;
  onAccountClick?: () => void;
  onDiagnosticsClick: () => void;
  onDeveloperModeClick: () => void;
  onCustomAIClick?: () => void;
  onTestConnection?: () => void;
  onReconnect?: () => void;
  dark?: boolean;
}

export default function CommandBar({
  onAddClick,
  onPlanClick,
  onPublishClick,
  disablePlanAndPublish = false,
  youtubeConnected,
  queueCount,
  onInterfaceClick,
  onAccountClick,
  onDiagnosticsClick,
  onDeveloperModeClick,
  onCustomAIClick,
  onTestConnection,
  onReconnect,
  dark: _dark = false,
}: CommandBarProps) {
  const { t } = useTranslation();
  const [menuAnchorPosition, setMenuAnchorPosition] = React.useState<{ top: number; left: number } | null>(null);
  const menuOpen = Boolean(menuAnchorPosition);
  const [youtubeMenuAnchor, setYoutubeMenuAnchor] = React.useState<HTMLElement | null>(null);
  const youtubeMenuOpen = Boolean(youtubeMenuAnchor);

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    // Anchor by click coordinates to avoid position drift when UI scale changes.
    setMenuAnchorPosition({ top: event.clientY, left: event.clientX });
  };

  const handleMenuClose = () => {
    setMenuAnchorPosition(null);
  };

  const handleYoutubeMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    setYoutubeMenuAnchor(event.currentTarget);
  };

  const handleYoutubeMenuClose = () => {
    setYoutubeMenuAnchor(null);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        py: 1.5,
        px: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        borderRadius: 2,
      }}
    >
      {/* Left side: Logo + Title + Actions */}
      <Stack direction="row" spacing={2} alignItems="center">
        {/* Logo */}
        <Box
          component="img"
          src="/logo.png"
          alt="ClipCast"
          className="gradient-animated"
          sx={{
            width: 48,
            height: 48,
            objectFit: 'contain',
            flexShrink: 0,
            transition: 'transform 0.3s ease-in-out',
            cursor: 'pointer',
            '&:hover': {
              transform: 'scale(1.1) rotate(5deg)',
            },
          }}
        />
        
        {/* Title */}
        <Box sx={{ mr: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {t('appTitle')}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1 }}>
            {t('appSubtitle')}
          </Typography>
        </Box>

        {/* Actions */}
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ ml: 1 }}>
          <Button
            variant="contained"
            onClick={onAddClick}
            startIcon="📁"
            data-testid="add-files-button"
            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
          >
            {t('add')}
          </Button>
        <Button
          variant="outlined"
          onClick={onPlanClick}
          disabled={disablePlanAndPublish}
          startIcon="📅"
          sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
        >
          {t('plan')}
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={onPublishClick}
          disabled={disablePlanAndPublish}
          startIcon="🚀"
          sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
        >
          {t('publish')}
        </Button>
        </Stack>
      </Stack>

      {/* Right side: Badges and Menu */}
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Chip
          label={youtubeConnected ? t('youtubeConnected') : t('youtubeNotConnected')}
          color={youtubeConnected ? 'success' : 'default'}
          size="small"
          sx={{ fontWeight: 500, cursor: 'pointer' }}
          onClick={handleYoutubeMenuClick}
        />
        <Menu
          anchorEl={youtubeMenuAnchor}
          open={youtubeMenuOpen}
          onClose={handleYoutubeMenuClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          {onTestConnection && (
            <MenuItem
              onClick={() => {
                onTestConnection();
                handleYoutubeMenuClose();
              }}
            >
              🔍 {t('testConnection')}
            </MenuItem>
          )}
          {onReconnect && (
            <MenuItem
              onClick={() => {
                onReconnect();
                handleYoutubeMenuClose();
              }}
            >
              🔄 {t('reconnect')}
            </MenuItem>
          )}
        </Menu>
        {queueCount > 0 && (
          <Chip
            label={`${t('queue')}: ${queueCount} ${t('running')}`}
            color="info"
            size="small"
            sx={{ fontWeight: 500 }}
          />
        )}

        <Tooltip title={t('settings')}>
          <IconButton
            size="small"
            onClick={handleMenuClick}
            sx={{ ml: 0.5 }}
            data-testid="settings-button"
          >
            <SettingsIcon />
          </IconButton>
        </Tooltip>

        <Menu
          anchorReference="anchorPosition"
          anchorPosition={menuAnchorPosition ?? undefined}
          anchorEl={undefined}
          open={menuOpen}
          onClose={handleMenuClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          {onInterfaceClick && (
            <MenuItem onClick={() => { onInterfaceClick(); handleMenuClose(); }}>
              🎨 {t('interface')}
            </MenuItem>
          )}
          {onAccountClick && (
            <MenuItem onClick={() => { onAccountClick(); handleMenuClose(); }}>
              👤 {t('account')}
            </MenuItem>
          )}
          {onCustomAIClick && (
            <MenuItem onClick={() => { onCustomAIClick(); handleMenuClose(); }}>
              🤖 {t('customAI')}
            </MenuItem>
          )}
          <MenuItem onClick={() => { onDiagnosticsClick(); handleMenuClose(); }}>
            {t('diagnostics')}
          </MenuItem>
          <MenuItem onClick={() => { onDeveloperModeClick(); handleMenuClose(); }}>
            {t('developerMode')}
          </MenuItem>
        </Menu>
      </Stack>
    </Box>
  );
}
