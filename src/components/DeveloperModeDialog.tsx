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
  Radio,
  RadioGroup,
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
  const [pythonPath, setPythonPath] = React.useState('');
  const [moveConfirmOpen, setMoveConfirmOpen] = React.useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = React.useState(false);
  const [pendingNewPath, setPendingNewPath] = React.useState<string | null>(null);
  const [pendingOldPath, setPendingOldPath] = React.useState<string | null>(null);
  const [deleteAfterCopy, setDeleteAfterCopy] = React.useState(false);
  const [resetDeleteAfterCopy, setResetDeleteAfterCopy] = React.useState(false);
  const [computeBackendInfo, setComputeBackendInfo] = React.useState<{
    availableGpu: boolean;
    details: {
      python?: string;
      platform?: string;
      torch_installed?: boolean;
      torch_version?: string | null;
      cuda_available?: boolean;
      cuda_version?: string | null;
      gpu_count?: number;
      gpu_name?: string | null;
      vram_total_mb?: number;
      adapters?: Array<{
        name?: string | null;
        vendor?: string | null;
        vram_mb?: number;
        pnp_device_id?: string | null;
        driver_version?: string | null;
        is_nvidia?: boolean;
      }>;
      nvidia_present?: boolean;
      nvidia_gpus?: Array<{
        name?: string | null;
        vram_total_mb?: number;
        driver_version?: string | null;
        compute_capability?: string | null;
      }>;
      cuda_smoke?: {
        ok?: boolean;
        error?: string | null;
        reason?: string | null;
        python?: string | null;
        platform?: string | null;
        ctranslate2_version?: string | null;
        cuda_device_count?: number;
        supported_compute_types?: string[];
        elapsed_ms?: number;
      } | null;
      cuda_smoke_raw_error?: string | null;
      python_source?: string | null;
      python_exec?: string | null;
      error?: string | null;
    };
    error?: string | null;
    pythonPath?: string;
  } | null>(null);
  const [computeBackendPreference, setComputeBackendPreference] = React.useState<'auto' | 'prefer_gpu' | 'force_cpu'>('auto');
  const [computeBackendLoading, setComputeBackendLoading] = React.useState(false);
  const [updateCheckMessage, setUpdateCheckMessage] = React.useState<string | null>(null);

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
        if (opts.computeBackendPreference === 'prefer_gpu' || opts.computeBackendPreference === 'force_cpu') {
          setComputeBackendPreference(opts.computeBackendPreference);
        } else {
          setComputeBackendPreference('auto');
        }
        if (typeof opts.pythonPath === 'string') {
          setPythonPath(opts.pythonPath);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const loadComputeBackend = React.useCallback(async () => {
    try {
      setComputeBackendLoading(true);
      const info = await window.api?.getComputeBackend?.();
      if (info) {
        setComputeBackendInfo(info);
      }
    } catch {
      // ignore
    } finally {
      setComputeBackendLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open) {
      loadOutputsPath();
      loadDeveloperOptions();
    }
  }, [open, loadOutputsPath, loadDeveloperOptions]);

  const handleComputeBackendRefresh = async () => {
    try {
      setComputeBackendLoading(true);
      const info = await window.api?.refreshComputeBackend?.();
      if (info) {
        setComputeBackendInfo(info);
      }
    } catch {
      // ignore
    } finally {
      setComputeBackendLoading(false);
    }
  };

  const handleComputeBackendPreferenceChange = (value: 'auto' | 'prefer_gpu' | 'force_cpu') => {
    setComputeBackendPreference(value);
    window.api?.setDeveloperOptions?.({ computeBackendPreference: value });
    handleComputeBackendRefresh();
  };

  const savePythonPath = async (value: string) => {
    const trimmed = value.trim();
    setPythonPath(trimmed);
    try {
      await window.api?.setDeveloperOptions?.({ pythonPath: trimmed });
      if (trimmed) {
        onSnack?.(t('pythonPathSaved'));
      } else {
        onSnack?.(t('pythonPathCleared'));
      }
      handleComputeBackendRefresh();
    } catch {
      onSnack?.(t('pythonPathSaveError'));
    }
  };

  const handlePythonBrowse = async () => {
    try {
      const res = await window.api?.pickPythonPath?.();
      if (res?.ok && res.path) {
        await savePythonPath(res.path);
      }
    } catch {
      onSnack?.(t('pythonPathSaveError'));
    }
  };

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

  const gpuAvailable =
    Boolean(computeBackendInfo?.availableGpu) &&
    Boolean(computeBackendInfo?.details?.cuda_available) &&
    (computeBackendInfo?.details?.gpu_count ?? 0) > 0;

  const effectiveBackend: 'gpu' | 'cpu' = (() => {
    if (computeBackendPreference === 'force_cpu') return 'cpu';
    if (computeBackendPreference === 'prefer_gpu') return gpuAvailable ? 'gpu' : 'cpu';
    return gpuAvailable ? 'gpu' : 'cpu';
  })();

  const computeModeLabel = computeBackendPreference === 'auto'
    ? 'Auto'
    : computeBackendPreference === 'prefer_gpu'
      ? 'Prefer GPU'
      : 'Force CPU';

  const hasComputeInfo = Boolean(computeBackendInfo);
  const selectedDeviceLabel = !hasComputeInfo ? 'Unknown' : effectiveBackend === 'gpu' ? 'CUDA' : 'CPU';
  const nvidiaPresent = computeBackendInfo?.details?.nvidia_present;
  const nvidiaLabel = !hasComputeInfo
    ? 'Not checked yet'
    : typeof nvidiaPresent === 'boolean'
      ? (nvidiaPresent ? 'yes' : 'no')
      : 'Unknown';

  const smoke = computeBackendInfo?.details?.cuda_smoke;
  const rawSmokeError = computeBackendInfo?.details?.cuda_smoke_raw_error || '';
  const hasSmokeFailure = Boolean((smoke && smoke.ok === false) || rawSmokeError);
  const smokeStatus = (() => {
    if (computeBackendPreference === 'force_cpu') return 'skipped';
    if (!hasComputeInfo) return 'Not checked yet';
    if (nvidiaPresent === false) return 'skipped';
    if (smoke?.ok === true) return 'passed';
    if (hasSmokeFailure) return 'failed';
    return 'Not checked yet';
  })();

  const formatFallbackReason = (reason: string): string => {
    const key = String(reason || '').toLowerCase();
    const map: Record<string, string> = {
      missing_cudnn: 'missing cuDNN DLL',
      missing_cublas: 'missing cuBLAS DLL',
      missing_cudart: 'missing CUDA runtime DLL',
      missing_dll: 'missing CUDA DLL',
      no_cuda_device: 'GPU detected, but no usable CUDA device from the current driver/runtime. Falling back to CPU. Update NVIDIA driver for CUDA 12 support.',
      cuda_no_float16: 'float16 not supported',
      cuda_unavailable: 'CUDA unavailable',
      cuda_probe_failed: 'CUDA probe failed',
    };
    if (key.includes('libiomp5md.dll') || key.includes('omp: error #15')) {
      return 'OpenMP runtime conflict (libiomp5md.dll)';
    }
    return map[key] || reason;
  };

  const fallbackReasonRaw = computeBackendInfo?.details?.cuda_smoke?.reason
    || rawSmokeError
    || computeBackendInfo?.error
    || '';
  const fallbackReason =
    computeBackendPreference !== 'force_cpu'
      && selectedDeviceLabel === 'CPU'
      && hasComputeInfo
      ? formatFallbackReason(fallbackReasonRaw)
      : '';

  const pythonSource = computeBackendInfo?.details?.python_source || '';
  const pythonSourceLabel = pythonSource === 'custom'
    ? 'Custom Python / Conda env'
    : pythonSource === 'bundled'
      ? 'Bundled runtime'
      : pythonSource === 'none'
        ? 'Not configured'
        : (pythonPath ? 'Custom Python / Conda env' : 'System Python');
  const showCustomEnvWarning = Boolean(
    pythonSource === 'custom'
      && selectedDeviceLabel === 'CPU'
      && computeBackendPreference !== 'force_cpu'
      && smokeStatus === 'failed'
  );
  const effectivePythonPath = computeBackendInfo?.details?.python_exec || computeBackendInfo?.pythonPath || '';

  const adapterSummary = React.useMemo(() => {
    const adapters = computeBackendInfo?.details?.adapters;
    const nvidia = computeBackendInfo?.details?.nvidia_gpus;
    const names = Array.isArray(adapters) && adapters.length > 0
      ? adapters.map((a) => a?.name).filter(Boolean)
      : (Array.isArray(nvidia) ? nvidia.map((g) => g?.name).filter(Boolean) : []);
    if (!hasComputeInfo) return 'Not checked yet';
    if (!names.length) return 'None detected';
    const joined = names.join(', ');
    return joined.length > 120 ? `${joined.slice(0, 119)}…` : joined;
  }, [computeBackendInfo, hasComputeInfo]);

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

            {/* Compute backend */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                {t('computeBackend')}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {t('computeBackendHelper')}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {`Compute mode: ${computeModeLabel}`}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {`Selected device: ${selectedDeviceLabel}`}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {`Python source: ${pythonSourceLabel}`}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {`NVIDIA present: ${nvidiaLabel}`}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {`CUDA smoke test: ${smokeStatus}`}
              </Typography>
              {fallbackReason && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {`Fallback reason: ${fallbackReason}`}
                </Typography>
              )}
              {showCustomEnvWarning && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  GPU not available in the selected Python / Conda environment. Falling back to CPU.
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {`Adapters found: ${adapterSummary}`}
              </Typography>
              <RadioGroup
                row
                value={computeBackendPreference}
                onChange={(e) =>
                  handleComputeBackendPreferenceChange(e.target.value as 'auto' | 'prefer_gpu' | 'force_cpu')
                }
              >
                <FormControlLabel
                  value="auto"
                  control={<Radio size="small" />}
                  label={t('computeBackendAuto')}
                />
                <FormControlLabel
                  value="prefer_gpu"
                  control={<Radio size="small" />}
                  label={t('computeBackendPreferGpu')}
                  disabled={!gpuAvailable}
                />
                <FormControlLabel
                  value="force_cpu"
                  control={<Radio size="small" />}
                  label={t('computeBackendForceCpu')}
                />
              </RadioGroup>
              <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleComputeBackendRefresh}
                  disabled={computeBackendLoading}
                >
                  {t('computeBackendRefresh')}
                </Button>
                {effectivePythonPath && (
                  <Typography variant="caption" color="text.secondary">
                    {t('computeBackendPython', { path: effectivePythonPath })}
                  </Typography>
                )}
                {computeBackendInfo && !gpuAvailable && (
                  <Typography variant="caption" color="text.secondary">
                    {t('computeBackendGpuUnavailable')}
                  </Typography>
                )}
              </Box>
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  {t('pythonPathHelper')}
                </Typography>
                <TextField
                  size="small"
                  fullWidth
                  label={t('pythonPathLabel')}
                  value={pythonPath}
                  onChange={(e) => setPythonPath(e.target.value)}
                  onBlur={(e) => savePythonPath(e.target.value)}
                  margin="dense"
                />
                <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                  <Button size="small" variant="outlined" onClick={handlePythonBrowse}>
                    {t('pythonPathBrowse')}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="secondary"
                    onClick={() => savePythonPath('')}
                    disabled={!pythonPath}
                  >
                    {t('pythonPathClear')}
                  </Button>
                </Stack>
              </Box>
              {computeBackendInfo?.error && (
                <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                  {computeBackendInfo.error}
                </Typography>
              )}
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
                <Button
                  variant="outlined"
                  fullWidth
                  size="small"
                  onClick={async () => {
                    setUpdateCheckMessage(null);
                    try {
                      const s = await window.api?.updateGetStatus?.();
                      if (s?.disabled) {
                        setUpdateCheckMessage('Updates disabled in dev');
                        return;
                      }
                      window.api?.updateCheck?.();
                      setUpdateCheckMessage('Checking for updates…');
                    } catch {
                      setUpdateCheckMessage('Update check failed');
                    }
                  }}
                >
                  Check for updates
                </Button>
                {updateCheckMessage && (
                  <Typography variant="caption" color="text.secondary">
                    {updateCheckMessage}
                  </Typography>
                )}
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
