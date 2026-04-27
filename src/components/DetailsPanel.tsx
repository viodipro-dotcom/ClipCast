import * as React from 'react';
import {
  Box,
  Button,
  ButtonGroup,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  IconButton,
  Tooltip,
  LinearProgress,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
  Collapse,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import type { JobRow, MetaPlatform } from '../types';
import { useTranslation } from 'react-i18next';

export interface DetailsPanelProps {
  selectedRow: JobRow | null;
  platformStatus?: {
    youtube: { status: 'none' | 'scheduled' | 'ready' | 'processing' | 'done' | 'failed'; scheduledTime?: number; postedAt?: number; message?: string };
    instagram: { status: 'none' | 'scheduled' | 'ready' | 'processing' | 'done' | 'failed'; scheduledTime?: number; postedAt?: number; message?: string };
    tiktok: { status: 'none' | 'scheduled' | 'ready' | 'processing' | 'done' | 'failed'; scheduledTime?: number; postedAt?: number; message?: string };
  } | null;
  onGenerateMetadata: (platform?: 'youtube' | 'instagram' | 'tiktok' | 'all') => void;
  /** When true, disable Generate Metadata (file already running or queued). */
  generateMetadataDisabled?: boolean;
  /** Tooltip when Generate Metadata is disabled (e.g. "Already processing or in queue"). */
  generateMetadataBusyTooltip?: string;
  onOpenEditor: (platform: MetaPlatform | 'all') => void;
  onApplyTemplate: () => void;
  onCopyCaption: (platform: MetaPlatform, value?: string) => void;
  onCopyHashtags: (platform: MetaPlatform, value?: string) => void;
  onCopyTitle: (platform: MetaPlatform, value?: string) => void;
  onCopyAll: (platform: MetaPlatform, metaOverride?: { title?: string; description?: string; hashtags?: string }) => void;
  onAssistNow: (platform: 'youtube' | 'instagram' | 'tiktok') => void;
  onOpenUploadPage: (platform: 'instagram' | 'tiktok') => void;
  onRevealFile: () => void;
  onMarkAsPosted: (platform: 'instagram' | 'tiktok') => void;
  onCopyFirstComment: () => void;
  onEditPlan: () => void;
  onRemovePlan: () => void;
  onRemovePlatformJob: (platform: 'youtube' | 'instagram' | 'tiktok') => void;
  onRemovePostedPlan: (platform: 'youtube' | 'instagram' | 'tiktok') => void;
  onDeleteMetadata: (platform: 'youtube' | 'instagram' | 'tiktok') => void;
  onSaveMetadata: (platform: 'youtube' | 'instagram' | 'tiktok', title: string, description: string, hashtags: string) => Promise<void>;
  formatForGrid?: (timestamp: number | null | undefined, mode: 'now' | 'schedule', timeZoneId: string) => string;
  timeZoneId?: string;
}

export default function DetailsPanel({
  selectedRow,
  onGenerateMetadata,
  generateMetadataDisabled = false,
  generateMetadataBusyTooltip,
  onOpenEditor,
  onApplyTemplate,
  onCopyCaption,
  onCopyHashtags,
  onCopyTitle,
  onCopyAll,
  onAssistNow,
  onOpenUploadPage,
  onRevealFile,
  onMarkAsPosted,
  onCopyFirstComment,
  onEditPlan,
  onRemovePlan,
  onRemovePlatformJob,
  onRemovePostedPlan,
  onDeleteMetadata,
  onSaveMetadata,
  platformStatus,
  formatForGrid,
  timeZoneId,
}: DetailsPanelProps) {
  const { t } = useTranslation();
  const [logDialogOpen, setLogDialogOpen] = React.useState(false);
  const [logFilter, setLogFilter] = React.useState('');
  const [previewPlatform, setPreviewPlatform] = React.useState<MetaPlatform | 'all'>('youtube');
  const [descriptionExpanded, setDescriptionExpanded] = React.useState<Record<string, boolean>>({});
  const [assistMenuAnchor, setAssistMenuAnchor] = React.useState<HTMLElement | null>(null);
  const [assistMenuPlatform, setAssistMenuPlatform] = React.useState<'youtube' | 'instagram' | 'tiktok' | null>(null);
  const [deleteConfirmDialogOpen, setDeleteConfirmDialogOpen] = React.useState(false);
  const [platformsToDelete, setPlatformsToDelete] = React.useState<Set<'youtube' | 'instagram' | 'tiktok'>>(new Set());
  const isPosted = React.useCallback(
    (platform: 'youtube' | 'instagram' | 'tiktok') => {
      const status = platformStatus?.[platform]?.status;
      return status === 'done' || selectedRow?.upload?.[platform]?.status === 'Done';
    },
    [platformStatus, selectedRow],
  );
  
  // State for editable metadata
  const [editingMetadata, setEditingMetadata] = React.useState<Record<string, { title: string; description: string; hashtags: string }>>({});
  const [savingMetadata, setSavingMetadata] = React.useState<Record<string, boolean>>({});
  const platformLabels = React.useMemo(
    () => ({
      youtube: t('youtube'),
      instagram: t('instagram'),
      tiktok: t('tiktok'),
    }),
    [t],
  );
  const platformLabelsWithEmoji = React.useMemo(
    () => ({
      youtube: `📺 ${t('youtube')}`,
      instagram: `📷 ${t('instagram')}`,
      tiktok: `🎵 ${t('tiktok')}`,
    }),
    [t],
  );

  // Initialize editing state when selectedRow changes OR when metadata changes
  // This ensures UI updates when metadata is regenerated for the same file
  React.useEffect(() => {
    if (!selectedRow) {
      // Clear editing state when no row is selected
      setEditingMetadata({});
      return;
    }
    
    // Initialize for all platforms when row changes OR when metadata changes
    const platforms: MetaPlatform[] = ['youtube', 'instagram', 'tiktok'];
    const updates: Record<string, { title: string; description: string; hashtags: string }> = {};
    
    platforms.forEach((platform) => {
      const editKey = `${selectedRow.filePath}-${platform}`;
      const meta = selectedRow.meta?.byPlatform?.[platform];
      const hashtagsStr = typeof meta?.hashtags === 'string' 
        ? meta.hashtags 
        : (Array.isArray(meta?.hashtags) ? meta.hashtags.join(' ') : '');
      
      const currentEdit = editingMetadata[editKey];
      const newValues = {
        title: meta?.title || '',
        description: meta?.description || '',
        hashtags: hashtagsStr,
      };
      
      // Update if:
      // 1. No current edit state exists (first time)
      // 2. Current edit state matches old metadata (user hasn't edited, so safe to update)
      // 3. Current edit state doesn't match new metadata (metadata was regenerated, update it)
      const shouldUpdate = !currentEdit || 
        (currentEdit.title === (meta?.title || '') && 
         currentEdit.description === (meta?.description || '') && 
         currentEdit.hashtags === hashtagsStr) ||
        (currentEdit.title !== newValues.title || 
         currentEdit.description !== newValues.description || 
         currentEdit.hashtags !== newValues.hashtags);
      
      if (shouldUpdate) {
        updates[editKey] = newValues;
      }
    });
    
    // Batch update to avoid multiple re-renders
    if (Object.keys(updates).length > 0) {
      setEditingMetadata(prev => ({ ...prev, ...updates }));
    }
  }, [selectedRow?.filePath, selectedRow?.meta]); // Also depend on meta to catch metadata updates

  if (!selectedRow) {
    return (
      <Paper
        sx={{
          p: 3,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {t('selectRow')}
        </Typography>
      </Paper>
    );
  }

  const hasMetadata = Boolean(
    selectedRow.meta?.byPlatform?.youtube?.title ||
    selectedRow.meta?.byPlatform?.instagram?.title ||
    selectedRow.meta?.byPlatform?.tiktok?.title
  );

  const getStageChip = () => {
    if (selectedRow.status === 'Processing') {
      return <Chip label={t('processing')} color="info" size="small" />;
    }
    if (selectedRow.status === 'Error') {
      return <Chip label={t('failed')} color="error" size="small" />;
    }
    if (selectedRow.status === 'Done' && hasMetadata) {
      if (selectedRow.publishMode === 'schedule' && selectedRow.publishAt) {
        return <Chip label={t('planned')} color="success" size="small" />;
      }
      return <Chip label={t('draftReady')} color="success" size="small" />;
    }
    if (selectedRow.status === 'Done' && !hasMetadata) {
      return <Chip label={t('needsReview')} color="warning" size="small" />;
    }
    return <Chip label={t('imported')} color="default" size="small" />;
  };

  const getPrimaryCTA = () => {
    if (!hasMetadata) {
      return null; // Moved to metadata section
    }
    if (selectedRow.status === 'Done' && !hasMetadata) {
      return (
        <Button
          variant="contained"
          fullWidth
          onClick={() => onOpenEditor(previewPlatform)}
          sx={{ mb: 2 }}
        >
          {t('openReview')}
        </Button>
      );
    }
    if (selectedRow.publishMode === 'schedule' && selectedRow.publishAt) {
      return (
        <Button
          variant="outlined"
          fullWidth
          onClick={onEditPlan}
          sx={{ mb: 2 }}
        >
          {t('editPlan')}
        </Button>
      );
    }
    return null;
  };

  // Helper to render editable metadata for a platform
  const renderEditableMetadata = (platform: MetaPlatform, meta: { title?: string; description?: string; hashtags?: string }) => {
    if (!selectedRow) return null;
    
    const editKey = `${selectedRow.filePath}-${platform}`;
    const isSaving = savingMetadata[editKey] || false;
    
    // Get current edit state or initialize from meta
    const getCurrentEdit = () => {
      if (editingMetadata[editKey]) {
        return editingMetadata[editKey];
      }
      // Initialize from meta if not in editing state
      const hashtagsStr = typeof meta.hashtags === 'string' 
        ? meta.hashtags 
        : (Array.isArray(meta.hashtags) ? meta.hashtags.join(' ') : '');
      return {
        title: meta.title || '',
        description: meta.description || '',
        hashtags: hashtagsStr,
      };
    };

    const currentEdit = getCurrentEdit();

    const handleSave = async () => {
      if (!selectedRow) return;
      const editData = editingMetadata[editKey] || getCurrentEdit();
      setSavingMetadata(prev => ({ ...prev, [editKey]: true }));
      try {
        await onSaveMetadata(platform, editData.title, editData.description, editData.hashtags);
      } catch (e) {
        console.error('Failed to save metadata:', e);
      } finally {
        setSavingMetadata(prev => ({ ...prev, [editKey]: false }));
      }
    };

    return (
      <Stack spacing={2}>
        {/* Title */}
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {t('title')}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => onCopyTitle(platform, currentEdit.title)}
              sx={{ minWidth: 'auto', px: 1, py: 0.5 }}
            >
              {t('copy')}
            </Button>
          </Stack>
          <TextField
            data-testid="details-panel-title-field"
            fullWidth
            size="small"
            value={currentEdit.title}
            inputProps={{ spellCheck: false }}
            onChange={(e) => {
              const current = editingMetadata[editKey] || getCurrentEdit();
              setEditingMetadata(prev => ({
                ...prev,
                [editKey]: { ...current, title: e.target.value },
              }));
            }}
            placeholder={t('title')}
            multiline
            minRows={1}
            maxRows={10}
            sx={{
              '& .MuiInputBase-root': {
                fontSize: '0.875rem',
              },
            }}
          />
        </Box>

        {/* Description */}
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {t('description')}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => onCopyCaption(platform, currentEdit.description)}
              sx={{ minWidth: 'auto', px: 1, py: 0.5 }}
            >
              {t('copy')}
            </Button>
          </Stack>
          <TextField
            data-testid="details-panel-description-field"
            fullWidth
            size="small"
            value={currentEdit.description}
            inputProps={{ spellCheck: false }}
            onChange={(e) => {
              const current = editingMetadata[editKey] || getCurrentEdit();
              setEditingMetadata(prev => ({
                ...prev,
                [editKey]: { ...current, description: e.target.value },
              }));
            }}
            placeholder={t('description')}
            multiline
            minRows={2}
            maxRows={10}
            sx={{
              '& .MuiInputBase-root': {
                fontSize: '0.875rem',
              },
            }}
          />
        </Box>

        {/* Hashtags */}
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {t('hashtags')}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => onCopyHashtags(platform, currentEdit.hashtags)}
              sx={{ minWidth: 'auto', px: 1, py: 0.5 }}
            >
              {t('copy')}
            </Button>
          </Stack>
          <TextField
            fullWidth
            size="small"
            value={currentEdit.hashtags}
            inputProps={{ spellCheck: false }}
            onChange={(e) => {
              const current = editingMetadata[editKey] || getCurrentEdit();
              setEditingMetadata(prev => ({
                ...prev,
                [editKey]: { ...current, hashtags: e.target.value },
              }));
            }}
            placeholder={t('hashtags')}
            multiline
            minRows={1}
            maxRows={10}
            sx={{
              '& .MuiInputBase-root': {
                fontSize: '0.875rem',
              },
            }}
          />
        </Box>

        {/* Save button */}
        <Button
          variant="contained"
          size="small"
          fullWidth
          onClick={handleSave}
          disabled={isSaving}
          sx={{ mt: 1 }}
        >
          {isSaving ? t('saving') : t('save')}
        </Button>

        {/* Copy All button */}
        <Button
          variant="outlined"
          size="small"
          fullWidth
          onClick={() => onCopyAll(platform, currentEdit)}
        >
          {t('copyAll')}
        </Button>

        {/* Assist Now button - for all platforms */}
        <ButtonGroup
          variant="contained"
          size="small"
          fullWidth
          sx={{ mt: 1 }}
        >
          <Button
            onClick={() => onAssistNow(platform)}
            sx={{ flex: 1 }}
          >
            {t('assistNowWithPlatform', { platform: platformLabels[platform] })}
          </Button>
          <IconButton
            onClick={(e) => {
              setAssistMenuAnchor(e.currentTarget);
              setAssistMenuPlatform(platform);
            }}
            sx={{ 
              borderLeft: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '0 4px 4px 0',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              '&:hover': {
                bgcolor: 'primary.dark',
              },
            }}
          >
            <ArrowDropDownIcon sx={{ fontSize: '1.5rem' }} />
          </IconButton>
        </ButtonGroup>
        
        {/* Assist Actions Menu */}
        <Menu
          anchorEl={assistMenuAnchor}
          open={Boolean(assistMenuAnchor)}
          onClose={() => {
            setAssistMenuAnchor(null);
            setAssistMenuPlatform(null);
          }}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'right',
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'right',
          }}
        >
          <MenuItem
            onClick={() => {
              if (assistMenuPlatform) {
                onAssistNow(assistMenuPlatform);
              }
              setAssistMenuAnchor(null);
              setAssistMenuPlatform(null);
            }}
          >
            {t('assistNowAllActions')}
          </MenuItem>
          <Divider />
          {assistMenuPlatform && (assistMenuPlatform === 'instagram' || assistMenuPlatform === 'tiktok') && (
            <MenuItem
              onClick={() => {
                if (assistMenuPlatform === 'instagram') {
                  onOpenUploadPage('instagram');
                } else if (assistMenuPlatform === 'tiktok') {
                  onOpenUploadPage('tiktok');
                }
                setAssistMenuAnchor(null);
                setAssistMenuPlatform(null);
              }}
            >
              {t('openUploadPageWithPlatform', { platform: platformLabels[assistMenuPlatform] })}
            </MenuItem>
          )}
          {assistMenuPlatform === 'youtube' && (
            <MenuItem
              onClick={() => {
                window.api?.openExternal?.('https://www.youtube.com/upload');
                setAssistMenuAnchor(null);
                setAssistMenuPlatform(null);
              }}
            >
              {t('openUploadPageWithPlatform', { platform: platformLabels.youtube })}
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              onRevealFile();
              setAssistMenuAnchor(null);
              setAssistMenuPlatform(null);
            }}
          >
            {t('revealFile')}
          </MenuItem>
          {assistMenuPlatform && (assistMenuPlatform === 'instagram' || assistMenuPlatform === 'tiktok') && (
            <MenuItem
              onClick={() => {
                if (assistMenuPlatform === 'instagram' || assistMenuPlatform === 'tiktok') {
                  onMarkAsPosted(assistMenuPlatform);
                }
                setAssistMenuAnchor(null);
                setAssistMenuPlatform(null);
              }}
            >
              {t('markAsPostedWithPlatform', { platform: platformLabels[assistMenuPlatform] })}
            </MenuItem>
          )}
        </Menu>
      </Stack>
    );
  };

  // CRITICAL: Handle null selectedRow case
  if (!selectedRow) {
    return (
      <Paper
        sx={{
          p: 2,
          height: '100%',
          overflow: 'auto',
          bgcolor: 'background.paper',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: 'scale(1.1)', // Increase everything by 10%
          transformOrigin: 'top left',
        }}
      >
        <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>
          {t('selectRow')}
        </Typography>
      </Paper>
    );
  }

  const hasInstagram = selectedRow.targets?.instagram;
  const hasTiktok = selectedRow.targets?.tiktok;

  // NOTE: plain function (not a hook) to avoid changing hook order across renders.
  const renderPlatformScheduleLabel = (
    platform: 'youtube' | 'instagram' | 'tiktok',
    ps: { status: 'none' | 'scheduled' | 'ready' | 'processing' | 'done' | 'failed'; scheduledTime?: number },
  ): string => {
    const scheduledTime = ps?.scheduledTime;
    const hasTime = typeof scheduledTime === 'number' && Number.isFinite(scheduledTime);
    if (!hasTime || !formatForGrid) return platform === 'youtube' ? t('scheduled') : t('assistScheduled');
    const tz = timeZoneId || 'SYSTEM';
    if (platform === 'youtube') {
      return `${t('scheduled')} ${formatForGrid(scheduledTime, 'schedule', tz)}`;
    }
    // IG/TT
    const prefix = ps.status === 'ready' ? t('assistDue') : t('assistScheduled');
    return `${prefix} ${formatForGrid(scheduledTime, 'schedule', tz)}`;
  };

  return (
    <Paper
      data-testid="details-panel"
      sx={{
        p: 2,
        height: '100%',
        overflow: 'auto',
        bgcolor: 'background.paper',
        transform: 'scale(1.1)', // Increase everything by 10%
        transformOrigin: 'top left',
        width: '90.91%', // Compensate for scale (100% / 1.1)
        height: '90.91%', // Compensate for scale (100% / 1.1)
      }}
    >
      {/* Summary Section */}
      <Box sx={{ mb: 3.3 }}> {/* Increased by 10% (from 3 to 3.3) */}
        <Typography variant="h6" sx={{ mb: 1.1, fontWeight: 600 }}> {/* Increased by 10% (from 1 to 1.1) */}
          {selectedRow.filename}
        </Typography>
        <Stack direction="row" spacing={1.1} alignItems="center" sx={{ mb: 2.2 }}> {/* Increased by 10% */}
          {getStageChip()}
          {selectedRow.status === 'Processing' && (
            <LinearProgress sx={{ flex: 1, height: 6, borderRadius: 3 }} />
          )}
        </Stack>
        {getPrimaryCTA()}
      </Box>

      <Divider sx={{ my: 2 }} />

      {/* Metadata Section */}
      <Box sx={{ mb: 3.3 }}> {/* Increased by 10% (from 3 to 3.3) */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.65 }}> {/* Increased by 10% (from 1.5 to 1.65) */}
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {t('metadata')}
          </Typography>
          {hasMetadata && (
            <Stack direction="row" spacing={0.5}>
              <Button
                variant="outlined"
                size="small"
                onClick={() => onOpenEditor(previewPlatform)}
                sx={{ minWidth: 'auto', px: 1 }}
              >
                {t('openEditor')}
              </Button>
              <Tooltip title={t('savedMetadataTooltip')}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={onApplyTemplate}
                  sx={{ minWidth: 'auto', px: 1 }}
                >
                  {t('savedMetadata')}
                </Button>
              </Tooltip>
            </Stack>
          )}
        </Stack>
        
        {!hasMetadata ? (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('noMetadataGenerated')}
            </Typography>
            <Tooltip title={generateMetadataDisabled && generateMetadataBusyTooltip ? generateMetadataBusyTooltip : ''}>
              <span>
                <Button
                  variant="contained"
                  fullWidth
                  disabled={generateMetadataDisabled}
                  onClick={() => onGenerateMetadata('all')}
                  data-testid="generate-metadata-button"
                >
                  {t('generate')}
                </Button>
              </span>
            </Tooltip>
          </Box>
        ) : (
          <Stack spacing={2}>
            {/* Platform selector with Delete button */}
            <Stack direction="row" spacing={1} alignItems="center">
              <Select
                value={previewPlatform}
                onChange={(e) => setPreviewPlatform(e.target.value as MetaPlatform | 'all')}
                size="small"
                sx={{ flex: 1 }}
              >
                <MenuItem value="youtube">{platformLabelsWithEmoji.youtube}</MenuItem>
                <MenuItem value="instagram">{platformLabelsWithEmoji.instagram}</MenuItem>
                <MenuItem value="tiktok">{platformLabelsWithEmoji.tiktok}</MenuItem>
                <MenuItem value="all">{t('allPlatforms')}</MenuItem>
              </Select>
              {(() => {
                // Show delete button only if a specific platform is selected and has metadata
                if (previewPlatform !== 'all') {
                  const meta = selectedRow.meta?.byPlatform?.[previewPlatform];
                  const hasMetadata = meta && (meta.title || meta.description || meta.hashtags);
                  if (hasMetadata) {
                    return (
                      <IconButton
                        color="error"
                        onClick={() => {
                          setPlatformsToDelete(new Set([previewPlatform]));
                          setDeleteConfirmDialogOpen(true);
                        }}
                        sx={{
                          height: '40px', // Match Select height (size="small" is ~40px)
                          width: '40px',
                          p: 0.5,
                        }}
                        title={t('deletePlatformMetadata', { platform: platformLabels[previewPlatform] })}
                      >
                        <Typography variant="body1">🗑️</Typography>
                      </IconButton>
                    );
                  }
                }
                return null;
              })()}
            </Stack>

            {/* Preview for selected platform(s) */}
            {previewPlatform === 'all' ? (
              // Show all platforms
              <Stack spacing={2}>
                {(['youtube', 'instagram', 'tiktok'] as MetaPlatform[]).map((platform) => {
                  const meta = selectedRow.meta?.byPlatform?.[platform];
                  const hasMetadata = meta && (meta.title || meta.description || meta.hashtags);
                  return (
                    <Box key={platform} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                      {/* Platform name header */}
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {platformLabelsWithEmoji[platform]}
                        </Typography>
                        {hasMetadata && (
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => {
                              setPlatformsToDelete(new Set([platform]));
                              setDeleteConfirmDialogOpen(true);
                            }}
                            sx={{ p: 0.5 }}
                            title={t('deletePlatformMetadata', { platform: platformLabels[platform] })}
                          >
                            <Typography variant="caption">🗑️</Typography>
                          </IconButton>
                        )}
                      </Stack>
                      {hasMetadata ? (
                        renderEditableMetadata(platform, meta)
                      ) : (
                        <Stack spacing={1}>
                          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 2 }}>
                            {t('noMetadataGenerated')}
                          </Typography>
                          <Tooltip title={generateMetadataDisabled && generateMetadataBusyTooltip ? generateMetadataBusyTooltip : ''}>
                            <span>
                              <Button
                                variant="contained"
                                fullWidth
                                disabled={generateMetadataDisabled}
                                onClick={() => onGenerateMetadata(platform)}
                              >
                                {t('generate')}
                              </Button>
                            </span>
                          </Tooltip>
                        </Stack>
                      )}
                    </Box>
                  );
                })}
              </Stack>
            ) : (
              (() => {
                const meta = selectedRow.meta?.byPlatform?.[previewPlatform];
                const hasMetadata = meta && (meta.title || meta.description || meta.hashtags);
                return (
                  <Box>
                    {hasMetadata ? (
                      renderEditableMetadata(previewPlatform, meta)
                    ) : (
                      <Stack spacing={1}>
                        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 2 }}>
                          {t('noMetadataGenerated')}
                        </Typography>
                        <Tooltip title={generateMetadataDisabled && generateMetadataBusyTooltip ? generateMetadataBusyTooltip : ''}>
                          <span>
                            <Button
                              variant="contained"
                              fullWidth
                              disabled={generateMetadataDisabled}
                              onClick={() => onGenerateMetadata(previewPlatform)}
                            >
                              {t('generate')}
                            </Button>
                          </span>
                        </Tooltip>
                      </Stack>
                    )}
                  </Box>
                );
              })()
            )}
          </Stack>
        )}
      </Box>

      <Divider sx={{ my: 2 }} />

      {/* Publish Plan Section */}
      {/* Only show if at least one platform is set as target */}
      {(selectedRow.targets?.youtube || selectedRow.targets?.instagram || selectedRow.targets?.tiktok) && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
            {t('publishPlan')}
          </Typography>
          <Stack spacing={1.5}>
            {selectedRow.targets?.youtube && (
              <Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" color="text.secondary">
                    {platformLabels.youtube}:
                  </Typography>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Chip
                      label={
                        platformStatus?.youtube?.status === 'scheduled' || platformStatus?.youtube?.status === 'ready'
                          ? renderPlatformScheduleLabel('youtube', platformStatus.youtube)
                          : isPosted('youtube')
                          ? (() => {
                              const postedAt = platformStatus?.youtube?.postedAt;
                              if (postedAt && formatForGrid) {
                                return `${t('postedAt')}: ${formatForGrid(postedAt, 'schedule', timeZoneId || 'SYSTEM')}`;
                              }
                              return t('posted');
                            })()
                          : platformStatus?.youtube?.status === 'failed' || selectedRow.upload?.youtube?.status === 'Error'
                          ? t('failed')
                          : '—'
                      }
                      size="small"
                      color={
                        isPosted('youtube')
                          ? 'success'
                          : platformStatus?.youtube?.status === 'failed' || selectedRow.upload?.youtube?.status === 'Error'
                          ? 'error'
                          : 'default'
                      }
                    />
                    {(selectedRow.publishMode === 'schedule' && selectedRow.publishAt) || isPosted('youtube') ? (
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isPosted('youtube')) {
                            onRemovePostedPlan('youtube');
                          } else {
                            onRemovePlatformJob('youtube');
                          }
                        }}
                        sx={{ p: 0.5, minWidth: 'auto', width: 24, height: 24 }}
                        color="error"
                      >
                        <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>×</Typography>
                      </IconButton>
                    ) : null}
                  </Stack>
                </Stack>
              </Box>
            )}
            {selectedRow.targets?.instagram && (
              <Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" color="text.secondary">
                    {platformLabels.instagram}:
                  </Typography>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Chip
                      label={
                        isPosted('instagram')
                          ? (() => {
                              const postedAt = platformStatus?.instagram?.postedAt;
                              if (postedAt && formatForGrid) {
                                return `${t('postedAt')}: ${formatForGrid(postedAt, 'schedule', timeZoneId || 'SYSTEM')}`;
                              }
                              return t('posted');
                            })()
                          : platformStatus?.instagram?.status === 'scheduled' || platformStatus?.instagram?.status === 'ready'
                          ? renderPlatformScheduleLabel('instagram', platformStatus.instagram)
                          : '—'
                      }
                      size="small"
                      color={isPosted('instagram') ? 'success' : 'default'}
                    />
                    {(platformStatus?.instagram?.status === 'scheduled' || platformStatus?.instagram?.status === 'ready' || isPosted('instagram')) ? (
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isPosted('instagram')) {
                            onRemovePostedPlan('instagram');
                          } else {
                            onRemovePlatformJob('instagram');
                          }
                        }}
                        sx={{ p: 0.5, minWidth: 'auto', width: 24, height: 24 }}
                        color="error"
                      >
                        <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>×</Typography>
                      </IconButton>
                    ) : null}
                  </Stack>
                </Stack>
              </Box>
            )}
            {selectedRow.targets?.tiktok && (
              <Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" color="text.secondary">
                    {platformLabels.tiktok}:
                  </Typography>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Chip
                      label={
                        isPosted('tiktok')
                          ? (() => {
                              const postedAt = platformStatus?.tiktok?.postedAt;
                              if (postedAt && formatForGrid) {
                                return `${t('postedAt')}: ${formatForGrid(postedAt, 'schedule', timeZoneId || 'SYSTEM')}`;
                              }
                              return t('posted');
                            })()
                          : platformStatus?.tiktok?.status === 'scheduled' || platformStatus?.tiktok?.status === 'ready'
                          ? renderPlatformScheduleLabel('tiktok', platformStatus.tiktok)
                          : '—'
                      }
                      size="small"
                      color={isPosted('tiktok') ? 'success' : 'default'}
                    />
                    {(platformStatus?.tiktok?.status === 'scheduled' || platformStatus?.tiktok?.status === 'ready' || isPosted('tiktok')) ? (
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isPosted('tiktok')) {
                            onRemovePostedPlan('tiktok');
                          } else {
                            onRemovePlatformJob('tiktok');
                          }
                        }}
                        sx={{ p: 0.5, minWidth: 'auto', width: 24, height: 24 }}
                        color="error"
                      >
                        <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>×</Typography>
                      </IconButton>
                    ) : null}
                  </Stack>
                </Stack>
              </Box>
            )}
            {(selectedRow.publishMode === 'schedule' && selectedRow.publishAt) && (
              <Button
                variant="outlined"
                size="small"
                fullWidth
                onClick={onEditPlan}
              >
                {t('editPlan')}
              </Button>
            )}
          </Stack>
        </Box>
      )}


      {/* Activity / Log Section */}
      <Divider sx={{ my: 2 }} />
      <Box sx={{ mb: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {t('activity')}
          </Typography>
          <Button
            size="small"
            variant="text"
            onClick={() => setLogDialogOpen(true)}
          >
            {t('showTechnicalLog')}
          </Button>
        </Stack>
        <Stack spacing={0.5}>
          {selectedRow.status === 'Processing' && (
            <Typography variant="body2" color="text.secondary">
              • {t('processing')}...
            </Typography>
          )}
          {selectedRow.publishMode === 'schedule' && selectedRow.publishAt && (
            <>
              <Typography variant="body2" color="text.secondary">
                • {t('waitingUntilScheduledTime')}
              </Typography>
              {formatForGrid && (
                <Typography variant="body2" color="text.secondary">
                  • {t('willNotifyYouAt')} {formatForGrid(selectedRow.publishAt, 'schedule', timeZoneId || 'SYSTEM')}
                </Typography>
              )}
            </>
          )}
          {selectedRow.status === 'Error' && (
            <Typography variant="body2" color="error">
              • {t('failed')}: {selectedRow.log || t('unknownError')}
            </Typography>
          )}
          {!selectedRow.status && selectedRow.status !== 'Processing' && !selectedRow.publishAt && (
            <Typography variant="body2" color="text.secondary">
              • {t('noActivity')}
            </Typography>
          )}
        </Stack>
      </Box>

      {/* Technical Log Dialog */}
      <Dialog
        open={logDialogOpen}
        onClose={() => setLogDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {t('showTechnicalLogForFile', { file: selectedRow.filename })}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                placeholder={t('search')}
                value={logFilter}
                onChange={(e) => setLogFilter(e.target.value)}
                variant="outlined"
                sx={{ flex: 1, '& .MuiInputBase-input': { fontFamily: 'monospace' } }}
              />
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  const raw = selectedRow?.log || '';
                  const lines = raw.split(/\r?\n/).filter(Boolean);
                  let lastErrorIndex = -1;
                  for (let i = lines.length - 1; i >= 0; i--) {
                    if (lines[i].includes('[ERROR]')) {
                      lastErrorIndex = i;
                      break;
                    }
                  }
                  if (lastErrorIndex === -1) return;
                  const stackIndex =
                    lastErrorIndex + 1 < lines.length &&
                    (lines[lastErrorIndex + 1].includes('Stack') || lines[lastErrorIndex + 1].includes('trace='))
                      ? lastErrorIndex + 1
                      : -1;
                  const toCopy =
                    stackIndex >= 0
                      ? lines[lastErrorIndex] + '\n' + lines[stackIndex]
                      : lines[lastErrorIndex];
                  void navigator.clipboard.writeText(toCopy);
                }}
              >
                {t('copyLastError')}
              </Button>
            </Stack>
            <TextField
              fullWidth
              multiline
              value={(() => {
                const raw = selectedRow?.log || t('noActivity');
                const lines = raw.split(/\r?\n/);
                const q = logFilter.trim().toLowerCase();
                if (!q) return raw;
                return lines.filter((l) => l.toLowerCase().includes(q)).join('\n') || t('noActivity');
              })()}
              variant="outlined"
              InputProps={{
                readOnly: true,
                sx: {
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  maxHeight: '60vh',
                  overflow: 'auto',
                },
              }}
              sx={{
                '& .MuiInputBase-root': {
                  bgcolor: 'background.default',
                },
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLogDialogOpen(false)}>
            {t('close')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Metadata Confirmation Dialog */}
      <Dialog
        open={deleteConfirmDialogOpen}
        onClose={() => {
          setDeleteConfirmDialogOpen(false);
          setPlatformsToDelete(new Set());
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('deleteMetadataConfirmTitle')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            {t('deleteMetadataConfirmBody')}
          </Typography>
          <Stack spacing={1}>
            {(['youtube', 'instagram', 'tiktok'] as const).map((platform) => {
              const hasMetadata = selectedRow?.meta?.byPlatform?.[platform] && (
                selectedRow.meta.byPlatform[platform]?.title || 
                selectedRow.meta.byPlatform[platform]?.description || 
                selectedRow.meta.byPlatform[platform]?.hashtags
              );
              
              return (
                <FormControlLabel
                  key={platform}
                  control={
                    <Checkbox
                      checked={platformsToDelete.has(platform)}
                      onChange={(e) => {
                        const newSet = new Set(platformsToDelete);
                        if (e.target.checked) {
                          newSet.add(platform);
                        } else {
                          newSet.delete(platform);
                        }
                        setPlatformsToDelete(newSet);
                      }}
                      disabled={!hasMetadata}
                    />
                  }
                  label={platformLabelsWithEmoji[platform]}
                />
              );
            })}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDeleteConfirmDialogOpen(false);
              setPlatformsToDelete(new Set());
            }}
          >
            {t('cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={platformsToDelete.size === 0}
            onClick={() => {
              if (platformsToDelete.size > 0) {
                // Delete metadata for all selected platforms
                platformsToDelete.forEach((platform) => {
                  onDeleteMetadata(platform);
                });
                setDeleteConfirmDialogOpen(false);
                setPlatformsToDelete(new Set());
              }
            }}
          >
            {t('yes')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
