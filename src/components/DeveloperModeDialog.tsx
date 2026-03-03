import * as React from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Stack,
  Switch,
  FormControlLabel,
  Typography,
  Alert,
  TextField,
  Checkbox,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

export interface DeveloperModeDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenUserData: () => void;
  onOpenOutputs: () => void;
  onSnack?: (message: string) => void;
}

export default function DeveloperModeDialog({
  open,
  onClose,
  onOpenUserData,
  onOpenOutputs,
  onSnack,
}: DeveloperModeDialogProps) {
  const { t } = useTranslation();
  const [debugMode, setDebugMode] = React.useState(false);
  const [autoCleanupOutputReports, setAutoCleanupOutputReports] = React.useState(true);
  const [autoCleanOutputArtifacts, setAutoCleanOutputArtifacts] = React.useState(false);
  const [artifactRetentionDays, setArtifactRetentionDays] = React.useState(30);
  const [autoArchivePosted, setAutoArchivePosted] = React.useState(false);
  const [archiveAfterDays, setArchiveAfterDays] = React.useState(7);
  const [autoDeleteArchived, setAutoDeleteArchived] = React.useState(false);
  const [deleteArchivedAfterDays, setDeleteArchivedAfterDays] = React.useState(30);
  const [outputsPath, setOutputsPath] = React.useState('');
  const [moveConfirmOpen, setMoveConfirmOpen] = React.useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = React.useState(false);
  const [pendingNewPath, setPendingNewPath] = React.useState<string | null>(null);
  const [pendingOldPath, setPendingOldPath] = React.useState<string | null>(null);
  const [deleteAfterCopy, setDeleteAfterCopy] = React.useState(false);
  const [resetDeleteAfterCopy, setResetDeleteAfterCopy] = React.useState(false);

  const loadOutputsPath = React.useCallback(async () => {
    try {
      const res = await window.api?.getOutputsDir?.();
      if (res?.ok && typeof res.path === 'string') {
        setOutputsPath(res.path);
      }
    } catch {
      // ignore
    }
  }, []);

  const loadDeveloperOptions = React.useCallback(async () => {
    try {
      const opts = await window.api?.getDeveloperOptions?.();
      if (opts && typeof opts === 'object') {
        setDebugMode(Boolean(opts.debugMode));
        setAutoCleanupOutputReports(opts.autoCleanupOutputReports !== false);
        setAutoCleanOutputArtifacts(Boolean(opts.autoCleanOutputArtifacts));
        setArtifactRetentionDays(Math.min(365, Math.max(1, Number(opts.artifactRetentionDays) || 30)));
        setAutoArchivePosted(Boolean(opts.autoArchivePosted));
        setArchiveAfterDays(Math.min(365, Math.max(1, Number(opts.archiveAfterDays) || 7)));
        setAutoDeleteArchived(Boolean(opts.autoDeleteArchived));
        setDeleteArchivedAfterDays(Math.min(365, Math.max(1, Number(opts.deleteArchivedAfterDays) || 30)));
      }
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    if (open) {
      loadOutputsPath();
      loadDeveloperOptions();
    }
  }, [open, loadOutputsPath, loadDeveloperOptions]);

  const handleDebugModeChange = (enabled: boolean) => {
    setDebugMode(enabled);
    window.api?.setDeveloperOptions?.({ debugMode: enabled });
  };

  const handleAutoCleanupChange = (enabled: boolean) => {
    setAutoCleanupOutputReports(enabled);
    window.api?.setDeveloperOptions?.({ autoCleanupOutputReports: enabled });
  };

  const handleAutoCleanOutputArtifactsChange = (enabled: boolean) => {
    setAutoCleanOutputArtifacts(enabled);
    window.api?.setDeveloperOptions?.({ autoCleanOutputArtifacts: enabled });
  };

  const handleArtifactRetentionDaysChange = (value: number) => {
    const clamped = Math.min(365, Math.max(1, value));
    setArtifactRetentionDays(clamped);
    window.api?.setDeveloperOptions?.({ artifactRetentionDays: clamped });
  };

  const handleAutoArchivePostedChange = (enabled: boolean) => {
    setAutoArchivePosted(enabled);
    window.api?.setDeveloperOptions?.({ autoArchivePosted: enabled });
  };

  const handleArchiveAfterDaysChange = (value: number) => {
    const clamped = Math.min(365, Math.max(1, value));
    setArchiveAfterDays(clamped);
    window.api?.setDeveloperOptions?.({ archiveAfterDays: clamped });
  };

  const handleAutoDeleteArchivedChange = (enabled: boolean) => {
    setAutoDeleteArchived(enabled);
    window.api?.setDeveloperOptions?.({ autoDeleteArchived: enabled });
  };

  const handleDeleteArchivedAfterDaysChange = (value: number) => {
    const clamped = Math.min(365, Math.max(1, value));
    setDeleteArchivedAfterDays(clamped);
    window.api?.setDeveloperOptions?.({ deleteArchivedAfterDays: clamped });
  };

  const handleBrowse = async () => {
    try {
      const res = await window.api?.pickOutputsDir?.();
      if (!res?.ok || res.path == null) return;
      const newPath = res.path;
      const currentRes = await window.api?.getOutputsDir?.();
      const currentPath = currentRes?.ok ? currentRes.path : '';
      if (currentPath && currentPath !== newPath) {
        setPendingOldPath(currentPath);
        setPendingNewPath(newPath);
        setDeleteAfterCopy(false);
        setMoveConfirmOpen(true);
        return;
      }
      const setRes = await window.api?.setOutputsDir?.(newPath);
      if (setRes?.ok) {
        setOutputsPath(setRes.path ?? newPath);
        onSnack?.(t('outputsFolderSetSuccess'));
      } else {
        onSnack?.(`${t('outputsFolderError')}: ${setRes?.error ?? 'Unknown'}`);
      }
    } catch (e) {
      onSnack?.(`${t('outputsFolderError')}: ${String(e)}`);
    }
  };

  const handleMoveConfirm = async (choice: 'move' | 'dontMove' | 'cancel') => {
    const newPath = pendingNewPath;
    const oldPath = pendingOldPath;
    setMoveConfirmOpen(false);
    setPendingNewPath(null);
    setPendingOldPath(null);
    if (choice === 'cancel' || !newPath) return;
    try {
      if (choice === 'move' && oldPath) {
        const moveRes = await window.api?.moveOutputsToNewDir?.({
          fromDir: oldPath,
          toDir: newPath,
          deleteAfterCopy,
        });
        if (moveRes?.deleteFailedCount && moveRes.deleteFailedCount > 0) {
          onSnack?.(t('outputsMigrationSomeLocked'));
        }
      }
      const setRes = await window.api?.setOutputsDir?.(newPath);
      if (setRes?.ok) {
        setOutputsPath(setRes.path ?? newPath);
        onSnack?.(t('outputsFolderSetSuccess'));
      } else {
        onSnack?.(`${t('outputsFolderError')}: ${setRes?.error ?? 'Unknown'}`);
      }
    } catch (e) {
      onSnack?.(`${t('outputsFolderError')}: ${String(e)}`);
    }
  };

  const handleResetClick = () => {
    setResetDeleteAfterCopy(false);
    setResetConfirmOpen(true);
  };

  const handleResetConfirm = async (choice: 'reset' | 'resetWithoutMoving' | 'cancel') => {
    setResetConfirmOpen(false);
    if (choice === 'cancel') return;
    try {
      if (choice === 'resetWithoutMoving') {
        const res = await window.api?.resetOutputsDir?.();
        if (res?.ok) {
          setOutputsPath(res.path ?? '');
          onSnack?.(t('outputsFolderResetSuccess'));
        } else {
          onSnack?.(t('outputsFolderError'));
        }
        return;
      }
      const currentRes = await window.api?.getOutputsDir?.();
      const defaultRes = await window.api?.getDefaultOutputsDir?.();
      const currentPath = currentRes?.ok ? currentRes.path : '';
      const defaultPathRes = defaultRes?.ok ? defaultRes.path : '';
      if (currentPath && defaultPathRes && currentPath !== defaultPathRes) {
        const moveRes = await window.api?.moveOutputsToNewDir?.({
          fromDir: currentPath,
          toDir: defaultPathRes,
          deleteAfterCopy: resetDeleteAfterCopy,
        });
        if (moveRes?.deleteFailedCount && moveRes.deleteFailedCount > 0) {
          onSnack?.(t('outputsMigrationSomeLocked'));
        }
      }
      const res = await window.api?.resetOutputsDir?.();
      if (res?.ok) {
        setOutputsPath(res.path ?? '');
        onSnack?.(t('outputsFolderResetSuccess'));
      } else {
        onSnack?.(t('outputsFolderError'));
      }
    } catch (e) {
      onSnack?.(`${t('outputsFolderError')}: ${String(e)}`);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>{t('developerMode')}</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <Alert severity="warning">
              {t('developerModeWarning')}
            </Alert>

            {/* Outputs folder */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                {t('outputsFolder')}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {t('outputsFolderHelper')}
              </Typography>
              <TextField
                size="small"
                fullWidth
                value={outputsPath}
                readOnly
                margin="dense"
                variant="outlined"
                inputProps={{ readOnly: true }}
                sx={{ mb: 1 }}
              />
              <Stack direction="row" spacing={1}>
                <Button variant="outlined" size="small" onClick={handleBrowse}>
                  {t('outputsFolderBrowse')}
                </Button>
                <Button variant="outlined" size="small" onClick={handleResetClick} color="secondary">
                  {t('outputsFolderReset')}
                </Button>
              </Stack>
            </Box>

            <Divider />

            {/* Auto-cleanup output reports */}
            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={autoCleanupOutputReports}
                    onChange={(e) => handleAutoCleanupChange(e.target.checked)}
                    color="primary"
                  />
                }
                label={
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {t('autoCleanupOutputReports')}
                  </Typography>
                }
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 4.5, display: 'block' }}>
                {t('autoCleanupOutputReportsHelper')}
              </Typography>
            </Box>

            {/* Auto-clean output artifacts (Audio/Exports/Metadata/Transcripts) */}
            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={autoCleanOutputArtifacts}
                    onChange={(e) => handleAutoCleanOutputArtifactsChange(e.target.checked)}
                    color="primary"
                  />
                }
                label={
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {t('autoCleanOutputArtifacts')}
                  </Typography>
                }
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 4.5, display: 'block' }}>
                {t('autoCleanOutputArtifactsHelper')}
              </Typography>
              <TextField
                size="small"
                type="number"
                inputProps={{ min: 1, max: 365 }}
                value={artifactRetentionDays}
                onChange={(e) => handleArtifactRetentionDaysChange(Number(e.target.value))}
                disabled={!autoCleanOutputArtifacts}
                margin="dense"
                sx={{ mt: 1, width: 120 }}
                label={t('deleteArtifactsOlderThanDays')}
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                {t('autoCleanArtifactsWarning')}
              </Typography>
            </Box>

            <Divider />

            {/* Data retention */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
                {t('dataRetention')}
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={autoArchivePosted}
                    onChange={(e) => handleAutoArchivePostedChange(e.target.checked)}
                    color="primary"
                  />
                }
                label={
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {t('autoArchivePosted')}
                  </Typography>
                }
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 4.5, display: 'block' }}>
                {t('autoArchivePostedHelper')}
              </Typography>
              <TextField
                size="small"
                type="number"
                inputProps={{ min: 1, max: 365 }}
                value={archiveAfterDays}
                onChange={(e) => handleArchiveAfterDaysChange(Number(e.target.value))}
                disabled={!autoArchivePosted}
                margin="dense"
                sx={{ mt: 1, width: 120 }}
                label={t('archiveAfterDays')}
              />
              <Box sx={{ mt: 1.5 }} />
              <FormControlLabel
                control={
                  <Switch
                    checked={autoDeleteArchived}
                    onChange={(e) => handleAutoDeleteArchivedChange(e.target.checked)}
                    color="primary"
                  />
                }
                label={
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {t('autoDeleteArchived')}
                  </Typography>
                }
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 4.5, display: 'block' }}>
                {t('autoDeleteArchivedHelper')}
              </Typography>
              <TextField
                size="small"
                type="number"
                inputProps={{ min: 1, max: 365 }}
                value={deleteArchivedAfterDays}
                onChange={(e) => handleDeleteArchivedAfterDaysChange(Number(e.target.value))}
                disabled={!autoDeleteArchived}
                margin="dense"
                sx={{ mt: 1, width: 120 }}
                label={t('deleteArchivedAfterDays')}
              />
            </Box>

            <Divider />

            {/* Debug Mode Toggle */}
            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={debugMode}
                    onChange={(e) => handleDebugModeChange(e.target.checked)}
                    color="warning"
                  />
                }
                label={
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography>🐛</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {t('debugMode')}
                    </Typography>
                  </Stack>
                }
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 4.5, display: 'block' }}>
                {t('debugModeDescription')}
              </Typography>
            </Box>

            <Divider />

            {/* Developer Actions */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
                {t('developerActions')}
              </Typography>
              <Stack spacing={1}>
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={onOpenUserData}
                  size="small"
                >
                  {t('openUserData')}
                </Button>
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={onOpenOutputs}
                  size="small"
                >
                  {t('openOutputs')}
                </Button>
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Move outputs folder */}
      <Dialog open={moveConfirmOpen} onClose={() => handleMoveConfirm('cancel')} maxWidth="sm" fullWidth>
        <DialogTitle>{t('moveOutputsFolderTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2">{t('moveOutputsFolderBody')}</Typography>
            <FormControlLabel
              control={
                <Checkbox
                  checked={deleteAfterCopy}
                  onChange={(e) => setDeleteAfterCopy(e.target.checked)}
                  color="primary"
                />
              }
              label={t('moveOutputsFolderDeleteCheckbox')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleMoveConfirm('cancel')}>{t('cancel')}</Button>
          <Button onClick={() => handleMoveConfirm('dontMove')}>{t('moveExistingOutputsDontMove')}</Button>
          <Button variant="contained" onClick={() => handleMoveConfirm('move')}>
            {t('moveOutputsFolderPrimary')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reset outputs folder */}
      <Dialog open={resetConfirmOpen} onClose={() => handleResetConfirm('cancel')} maxWidth="sm" fullWidth>
        <DialogTitle>{t('resetOutputsFolderTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2">{t('resetOutputsFolderBody')}</Typography>
            <FormControlLabel
              control={
                <Checkbox
                  checked={resetDeleteAfterCopy}
                  onChange={(e) => setResetDeleteAfterCopy(e.target.checked)}
                  color="primary"
                />
              }
              label={t('moveOutputsFolderDeleteCheckbox')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleResetConfirm('cancel')}>{t('cancel')}</Button>
          <Button onClick={() => handleResetConfirm('resetWithoutMoving')}>{t('resetOutputsWithoutMoving')}</Button>
          <Button variant="contained" onClick={() => handleResetConfirm('reset')}>
            {t('resetOutputsFolderPrimary')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
