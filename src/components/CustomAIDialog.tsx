import * as React from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  Tabs,
  Tab,
  Stack,
  FormControl,
  MenuItem,
  Select,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { CustomAiPlatformMap, CustomAiPreset, CustomAiPresetSummary, CustomAiSettings } from '../types';

export interface CustomAIDialogProps {
  open: boolean;
  onClose: () => void;
  customInstructions: string | CustomAiPlatformMap;
  onCustomInstructionsChange: (instructions: string | CustomAiPlatformMap) => void;
  onSnack: (message: string) => void;
}

const MAX_CHARACTERS = 1000;
const DEFAULT_TEMPLATE_PLACEHOLDER = '{DESCRIPTION}\n\n{CTA}\n{LINKS}\n{DISCLAIMER}\n{HASHTAGS}';

const createEmptyPlatformMap = (): CustomAiPlatformMap => ({
  all: '',
  youtube: '',
  instagram: '',
  tiktok: '',
});

const createEmptyBlocks = () => ({
  cta: createEmptyPlatformMap(),
  links: createEmptyPlatformMap(),
  disclaimer: createEmptyPlatformMap(),
});

const normalizePlatformMap = (value?: Partial<CustomAiPlatformMap> | null): CustomAiPlatformMap => ({
  all: value?.all ?? '',
  youtube: value?.youtube ?? '',
  instagram: value?.instagram ?? '',
  tiktok: value?.tiktok ?? '',
});

const normalizeBlocks = (value?: Partial<CustomAiSettings['blocks']> | null) => ({
  cta: normalizePlatformMap(value?.cta),
  links: normalizePlatformMap(value?.links),
  disclaimer: normalizePlatformMap(value?.disclaimer),
});

const platformMapEqual = (a?: Partial<CustomAiPlatformMap> | null, b?: Partial<CustomAiPlatformMap> | null) => {
  const left = normalizePlatformMap(a);
  const right = normalizePlatformMap(b);
  return (
    left.all === right.all
    && left.youtube === right.youtube
    && left.instagram === right.instagram
    && left.tiktok === right.tiktok
  );
};

const blocksEqual = (a?: Partial<CustomAiSettings['blocks']> | null, b?: Partial<CustomAiSettings['blocks']> | null) => (
  platformMapEqual(a?.cta, b?.cta)
  && platformMapEqual(a?.links, b?.links)
  && platformMapEqual(a?.disclaimer, b?.disclaimer)
);

type AppliedState = {
  activePresetId: string | null;
  instructions: CustomAiPlatformMap;
  template: CustomAiPlatformMap;
  blocks: CustomAiSettings['blocks'];
};

type TabPanelProps = {
  value: number;
  index: number;
  children: React.ReactNode;
};

function TabPanel({ value, index, children }: TabPanelProps) {
  if (value !== index) return null;
  return (
    <Box role="tabpanel" sx={{ pt: 2 }}>
      {children}
    </Box>
  );
}

export default function CustomAIDialog({
  open,
  onClose,
  customInstructions,
  onCustomInstructionsChange,
  onSnack,
}: CustomAIDialogProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = React.useState(0);
  const [selectedPlatform, setSelectedPlatform] = React.useState<'all' | 'youtube' | 'instagram' | 'tiktok'>('all');
  const [selectedTemplatePlatform, setSelectedTemplatePlatform] = React.useState<'all' | 'youtube' | 'instagram' | 'tiktok'>('all');
  const [selectedBlocksPlatform, setSelectedBlocksPlatform] = React.useState<'all' | 'youtube' | 'instagram' | 'tiktok'>('all');

  // Convert old format (string) to new format (Record<string, string>)
  const instructionsObj = React.useMemo<CustomAiPlatformMap>(() => {
    if (typeof customInstructions === 'string') {
      return { all: customInstructions, youtube: '', instagram: '', tiktok: '' };
    }
    return customInstructions || createEmptyPlatformMap();
  }, [customInstructions]);

  const [localInstructions, setLocalInstructions] = React.useState<CustomAiPlatformMap>(instructionsObj);
  const [localTemplate, setLocalTemplate] = React.useState<CustomAiPlatformMap>(createEmptyPlatformMap());
  const [localBlocks, setLocalBlocks] = React.useState(() => createEmptyBlocks());

  const [presets, setPresets] = React.useState<CustomAiPresetSummary[]>([]);
  const [activePresetId, setActivePresetId] = React.useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = React.useState<string>('');
  const [selectedPreset, setSelectedPreset] = React.useState<CustomAiPreset | null>(null);
  const [newPresetName, setNewPresetName] = React.useState('');
  const [appliedState, setAppliedState] = React.useState<AppliedState | null>(null);

  const applyCustomSettingsToState = React.useCallback((settings: CustomAiSettings) => {
    setLocalInstructions(normalizePlatformMap(settings.customInstructions));
    setLocalTemplate(normalizePlatformMap(settings.descriptionTemplate));
    setLocalBlocks(normalizeBlocks(settings.blocks));
    setSelectedTemplatePlatform('all');
    setSelectedBlocksPlatform('all');
  }, []);

  const applyPresetToState = React.useCallback((preset: CustomAiPreset) => {
    setSelectedPreset(preset);
    setNewPresetName(preset?.name || '');
    setLocalInstructions(normalizePlatformMap(preset.instructions));
    setLocalTemplate(normalizePlatformMap(preset.descriptionTemplate));
    setLocalBlocks(normalizeBlocks(preset.blocks));
    setSelectedPlatform('all');
    setSelectedTemplatePlatform('all');
    setSelectedBlocksPlatform('all');
  }, []);

  const buildAppliedStateFromPreset = React.useCallback((preset: CustomAiPreset, presetId: string): AppliedState => ({
    activePresetId: presetId,
    instructions: normalizePlatformMap(preset.instructions),
    template: normalizePlatformMap(preset.descriptionTemplate),
    blocks: normalizeBlocks(preset.blocks),
  }), []);

  const buildAppliedStateFromSettings = React.useCallback((settings: CustomAiSettings): AppliedState => ({
    activePresetId: null,
    instructions: normalizePlatformMap(settings.customInstructions),
    template: normalizePlatformMap(settings.descriptionTemplate),
    blocks: normalizeBlocks(settings.blocks),
  }), []);

  const loadCustomAiSettings = React.useCallback(async (): Promise<CustomAiSettings> => {
    if (window.api?.metadataGetCustomAiSettings) {
      const settings = await window.api.metadataGetCustomAiSettings();
      return {
        customInstructions: normalizePlatformMap(settings?.customInstructions),
        descriptionTemplate: normalizePlatformMap(settings?.descriptionTemplate),
        blocks: normalizeBlocks(settings?.blocks),
      };
    }
    return {
      customInstructions: normalizePlatformMap(instructionsObj),
      descriptionTemplate: createEmptyPlatformMap(),
      blocks: createEmptyBlocks(),
    };
  }, [instructionsObj]);

  const refreshPresets = React.useCallback(async () => {
    try {
      const res = await window.api?.presetsList?.();
      const nextPresets = res?.presets || [];
      setPresets(nextPresets);
      setActivePresetId(res?.activePresetId ?? null);

      if (selectedPresetId) {
        const stillExists = nextPresets.some((preset) => preset.id === selectedPresetId);
        if (!stillExists) {
          setSelectedPresetId('');
          setSelectedPreset(null);
          setNewPresetName('');
          const settings = await loadCustomAiSettings();
          applyCustomSettingsToState(settings);
          setAppliedState(buildAppliedStateFromSettings(settings));
        }
      }
    } catch (e) {
      console.error('Failed to load presets:', e);
    }
  }, [
    applyCustomSettingsToState,
    buildAppliedStateFromSettings,
    loadCustomAiSettings,
    selectedPresetId,
  ]);

  const wasOpenRef = React.useRef(false);

  React.useEffect(() => {
    if (open && !wasOpenRef.current) {
      setSelectedPlatform('all');
      setNewPresetName('');
      setActiveTab(0);
      const loadInitialState = async () => {
        try {
          const listRes = await window.api?.presetsList?.();
          const nextPresets = listRes?.presets || [];
          const nextActivePresetId = listRes?.activePresetId ?? null;
          setPresets(nextPresets);
          setActivePresetId(nextActivePresetId);

          if (nextActivePresetId) {
            setSelectedPresetId(nextActivePresetId);
            const preset = await window.api?.presetsGet?.(nextActivePresetId);
            if (preset) {
              applyPresetToState(preset);
              setAppliedState(buildAppliedStateFromPreset(preset, nextActivePresetId));
              return;
            }
          }

          setSelectedPresetId('');
          setSelectedPreset(null);
          const settings = await loadCustomAiSettings();
          applyCustomSettingsToState(settings);
          setAppliedState(buildAppliedStateFromSettings(settings));
        } catch (e) {
          console.error('Failed to load custom AI state:', e);
          setSelectedPresetId('');
          setSelectedPreset(null);
          const settings = await loadCustomAiSettings();
          applyCustomSettingsToState(settings);
          setAppliedState(buildAppliedStateFromSettings(settings));
        }
      };
      void loadInitialState();
    }
    wasOpenRef.current = open;
  }, [
    open,
    applyCustomSettingsToState,
    applyPresetToState,
    buildAppliedStateFromPreset,
    buildAppliedStateFromSettings,
    loadCustomAiSettings,
  ]);

  const ensureInstructionsWithinLimit = () => {
    const exceedsLimit = Object.values(localInstructions).some(v => v.length > MAX_CHARACTERS);
    if (exceedsLimit) {
      onSnack(`Cannot save: One or more instructions exceed the ${MAX_CHARACTERS} character limit.`);
      return false;
    }
    return true;
  };

  const handlePresetSelect = async (presetId: string) => {
    setSelectedPresetId(presetId);
    if (!presetId) {
      setSelectedPreset(null);
      setNewPresetName('');
      const settings = await loadCustomAiSettings();
      applyCustomSettingsToState(settings);
      return;
    }

    try {
      const preset = await window.api?.presetsGet?.(presetId);
      if (!preset) {
        onSnack('Preset not found');
        const stillExists = presets.some((item) => item.id === presetId);
        if (!stillExists) {
          setSelectedPresetId('');
          setSelectedPreset(null);
          setNewPresetName('');
          const settings = await loadCustomAiSettings();
          applyCustomSettingsToState(settings);
        }
        return;
      }
      applyPresetToState(preset);
    } catch (e) {
      console.error('Failed to load preset:', e);
      onSnack('Failed to load preset');
    }
  };

  const handleSavePresetAsNew = async () => {
    console.log('[presetsSave] CLICKED Save as new');
    if (!ensureInstructionsWithinLimit()) return;
    const name = newPresetName.trim();
    if (!name) {
      onSnack('Preset name is required');
      return;
    }
    try {
      const payload = {
        name,
        instructions: localInstructions,
        descriptionTemplate: localTemplate,
        blocks: localBlocks,
      };
      const api = window.api;
      if (!api || typeof api.presetsSave !== 'function') {
        console.error('[presetsSave] window.api.presetsSave missing', api);
        alert('ERROR: presetsSave API not available');
        return;
      }
      console.log('[presetsSave] typeof window.api.presetsSave', typeof api.presetsSave);
      console.log('[presetsSave] payload', payload);
      console.log('[presetsSave] calling window.api.presetsSave...');
      const res = await api.presetsSave(payload);
      console.log('[presetsSave] result', res);
      if (!res) {
        console.error('[CustomAIDialog] presetsSave returned no response');
        onSnack('Failed to save preset');
        return;
      }
      if (!res?.ok || !res?.preset) {
        if (res && !res.ok) {
          console.error('[CustomAIDialog] presetsSave failed:', res?.error);
        }
        onSnack(res?.error || 'Failed to save preset');
        return;
      }
      if (typeof api.presetsList === 'function') {
        const listRes = await api.presetsList();
        setPresets(listRes?.presets || []);
        setActivePresetId(listRes?.activePresetId ?? null);
      }
      setSelectedPresetId(res.preset.id);
      setSelectedPreset(res.preset);
      if (typeof api.presetsSetActive === 'function') {
        const activeRes = await api.presetsSetActive(res.preset.id);
        if (activeRes?.ok) {
          setActivePresetId(activeRes.activePresetId ?? res.preset.id);
          onCustomInstructionsChange(localInstructions);
          setAppliedState(buildAppliedStateFromPreset(res.preset, res.preset.id));
        }
      }
      onSnack('Preset saved');
    } catch (e) {
      console.error('Failed to save preset:', e);
      onSnack('Failed to save preset');
    }
  };

  const handleDebugPresetsList = async () => {
    const api = window.api;
    if (!api || typeof api.presetsList !== 'function') {
      console.error('[presetsList] window.api.presetsList missing', api);
      alert('ERROR: presetsList API not available');
      return;
    }
    const res = await api.presetsList();
    console.log('[presetsList]', res);
  };

  const handleUpdatePreset = async () => {
    if (!selectedPresetId) return;
    if (!ensureInstructionsWithinLimit()) return;
    const name = selectedPreset?.name?.trim();
    if (!name) {
      onSnack('Preset name is required');
      return;
    }
    try {
      const payload = {
        id: selectedPresetId,
        name,
        createdAt: selectedPreset?.createdAt,
        instructions: localInstructions,
        descriptionTemplate: localTemplate,
        blocks: localBlocks,
      };
      console.log('[presetsSave] typeof window.api.presetsSave', typeof window.api?.presetsSave);
      console.log('[presetsSave] payload', payload);
      console.log('[presetsSave] calling window.api.presetsSave...');
      if (!window.api?.presetsSave) {
        console.error('[CustomAIDialog] presetsSave is not available on window.api');
        onSnack('Failed to update preset');
        return;
      }
      const res = await window.api?.presetsSave?.(payload);
      console.log('[presetsSave] result', res);
      if (!res) {
        console.error('[CustomAIDialog] presetsSave returned no response');
        onSnack('Failed to update preset');
        return;
      }
      if (!res?.ok || !res?.preset) {
        if (res && !res.ok) {
          console.error('[CustomAIDialog] presetsSave failed:', res?.error);
        }
        onSnack(res?.error || 'Failed to update preset');
        return;
      }
      await refreshPresets();
      setSelectedPreset(res.preset);
      if (activePresetId === selectedPresetId) {
        onCustomInstructionsChange(localInstructions);
        setAppliedState(buildAppliedStateFromPreset(res.preset, selectedPresetId));
      }
      onSnack('Preset updated');
    } catch (e) {
      console.error('Failed to update preset:', e);
      onSnack('Failed to update preset');
    }
  };

  const handleDeletePreset = async () => {
    if (!selectedPresetId) return;
    if (!window.confirm(`Delete preset "${selectedPreset?.name || 'this preset'}"?`)) {
      return;
    }
    try {
      const res = await window.api?.presetsDelete?.(selectedPresetId);
      if (!res?.ok) {
        onSnack(res?.error || 'Failed to delete preset');
        return;
      }
      await refreshPresets();
      setSelectedPresetId('');
      setSelectedPreset(null);
      const settings = await loadCustomAiSettings();
      applyCustomSettingsToState(settings);
      onSnack('Preset deleted');
    } catch (e) {
      console.error('Failed to delete preset:', e);
      onSnack('Failed to delete preset');
    }
  };

  const handleApply = async () => {
    if (!ensureInstructionsWithinLimit()) return;

    const nextAppliedState: AppliedState = {
      activePresetId: null,
      instructions: normalizePlatformMap(localInstructions),
      template: normalizePlatformMap(localTemplate),
      blocks: normalizeBlocks(localBlocks),
    };

    try {
      if (window.api?.metadataSetCustomAiSettings) {
        await window.api.metadataSetCustomAiSettings({
          customInstructions: localInstructions,
          descriptionTemplate: localTemplate,
          blocks: localBlocks,
        });
      } else {
        await window.api?.metadataSetCustomInstructions?.(localInstructions);
      }
      onCustomInstructionsChange(localInstructions);
    } catch (e) {
      console.error('Failed to apply custom AI settings:', e);
      onSnack('Failed to apply custom AI settings');
      return;
    }

    const presetMatchesDraft = Boolean(
      selectedPresetId
      && selectedPreset
      && platformMapEqual(localInstructions, selectedPreset.instructions)
      && platformMapEqual(localTemplate, selectedPreset.descriptionTemplate)
      && blocksEqual(localBlocks, selectedPreset.blocks)
    );

    if (presetMatchesDraft && selectedPresetId) {
      try {
        const res = await window.api?.presetsSetActive?.(selectedPresetId);
        if (res?.ok) {
          const nextActivePresetId = res.activePresetId ?? selectedPresetId;
          setActivePresetId(nextActivePresetId);
          nextAppliedState.activePresetId = nextActivePresetId;
        }
      } catch (e) {
        console.error('Failed to set active preset:', e);
      }
    } else {
      try {
        const res = await window.api?.presetsSetActive?.(null);
        if (res?.ok) {
          setActivePresetId(null);
        }
      } catch (e) {
        console.error('Failed to clear active preset:', e);
      }
    }

    setAppliedState(nextAppliedState);
    onSnack(t('applied'));
  };

  const handleReset = () => {
    const emptyInstructions = createEmptyPlatformMap();
    const emptyTemplate = createEmptyPlatformMap();
    const emptyBlocks = createEmptyBlocks();
    setLocalInstructions(emptyInstructions);
    setLocalTemplate(emptyTemplate);
    setLocalBlocks(emptyBlocks);
    setSelectedPlatform('all');
    setSelectedTemplatePlatform('all');
    setSelectedBlocksPlatform('all');
    onSnack(t('resetToDefault'));
  };

  const currentValue = localInstructions[selectedPlatform] || '';
  const templateValue = localTemplate[selectedTemplatePlatform] || '';
  const ctaValue = localBlocks.cta[selectedBlocksPlatform] || '';
  const linksValue = localBlocks.links[selectedBlocksPlatform] || '';
  const disclaimerValue = localBlocks.disclaimer[selectedBlocksPlatform] || '';
  const characterCount = currentValue.length;
  const isOverLimit = characterCount > MAX_CHARACTERS;
  const canSaveAsNew = newPresetName.trim().length > 0;
  const isDirty = React.useMemo(() => {
    if (!appliedState) return true;
    if (!platformMapEqual(localInstructions, appliedState.instructions)) return true;
    if (!platformMapEqual(localTemplate, appliedState.template)) return true;
    if (!blocksEqual(localBlocks, appliedState.blocks)) return true;
    return false;
  }, [appliedState, localBlocks, localInstructions, localTemplate]);
  const canApply = isDirty;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth data-testid="custom-ai-dialog">
      <DialogTitle>{t('customAI')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack
            direction="row"
            alignItems="flex-end"
            spacing={1}
            sx={{ width: '100%', flexWrap: 'nowrap' }}
          >
            <FormControl size="small" sx={{ minWidth: 180, flexShrink: 0 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', mb: 0.5, display: 'block' }}>
                {t('preset') || 'Preset'}
              </Typography>
              <Select
                value={selectedPresetId}
                onChange={(e) => handlePresetSelect(e.target.value as string)}
                displayEmpty
                size="small"
                sx={{
                  minWidth: 180,
                  height: 36,
                  '& .MuiSelect-select': {
                    display: 'flex',
                    alignItems: 'center',
                    height: '100%',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                }}
              >
                <MenuItem value="">
                  <em>{t('none')}</em>
                </MenuItem>
                {presets.map((preset) => (
                  <MenuItem key={preset.id} value={preset.id}>
                    {preset.name}
                    {preset.id === activePresetId ? ' (active)' : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              label={t('presetName') || 'Preset name'}
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              sx={{
                width: 220,
                flexShrink: 0,
                '& .MuiInputBase-root': { height: 36 },
                '& .MuiInputBase-input': {
                  height: '100%',
                  paddingTop: 0,
                  paddingBottom: 0,
                },
              }}
            />
            <Button
              size="small"
              variant="outlined"
              sx={{
                height: 36,
                minWidth: 96,
                maxWidth: 140,
                px: 1.5,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                lineHeight: 1,
                flexShrink: 0,
              }}
              disabled={!canSaveAsNew}
              onClick={() => {
                console.log('[presetsSave] onClick Save as new');
                void handleSavePresetAsNew();
              }}
            >
              {t('saveAsNew')}
            </Button>
            <Button
              size="small"
              variant="outlined"
              sx={{
                height: 36,
                minWidth: 96,
                maxWidth: 140,
                px: 1.5,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                lineHeight: 1,
                flexShrink: 0,
              }}
              onClick={handleUpdatePreset}
              disabled={!selectedPresetId}
            >
              {t('updatePreset')}
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              sx={{
                height: 36,
                minWidth: 84,
                maxWidth: 120,
                px: 1.5,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                lineHeight: 1,
                flexShrink: 0,
              }}
              onClick={handleDeletePreset}
              disabled={!selectedPresetId}
            >
              {t('delete')}
            </Button>
            <Button
              size="small"
              variant="outlined"
              sx={{
                height: 36,
                minWidth: 96,
                maxWidth: 140,
                px: 1.5,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                lineHeight: 1,
                flexShrink: 0,
              }}
              onClick={() => {
                void handleDebugPresetsList();
              }}
            >
              {t('debugList')}
            </Button>
          </Stack>

          <Tabs
            value={activeTab}
            onChange={(_e, next) => setActiveTab(next)}
            variant="scrollable"
            scrollButtons="auto"
          >
            <Tab label={t('aiInstructions')} />
            <Tab label={t('descriptionTemplate')} />
            <Tab label={t('blocks')} />
          </Tabs>

          <TabPanel value={activeTab} index={0}>
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {t('customInstructionsDescription')}
              </Typography>
              
              <FormControl fullWidth size="small">
                <Typography variant="caption" sx={{ color: 'text.secondary', mb: 0.5, display: 'block' }}>
                  {t('platform')}
                </Typography>
                <Select
                  value={selectedPlatform}
                  onChange={(e) => setSelectedPlatform(e.target.value as 'all' | 'youtube' | 'instagram' | 'tiktok')}
                >
                  <MenuItem value="all">{t('allPlatforms')}</MenuItem>
                  <MenuItem value="youtube">📺 {t('youtube')}</MenuItem>
                  <MenuItem value="instagram">📷 {t('instagram')}</MenuItem>
                  <MenuItem value="tiktok">🎵 {t('tiktok')}</MenuItem>
                </Select>
              </FormControl>
              
              <TextField
                fullWidth
                multiline
                minRows={4}
                maxRows={12}
                value={currentValue}
                onChange={(e) => {
                  const newValue = e.target.value;
                  // Prevent typing beyond limit
                  if (newValue.length <= MAX_CHARACTERS) {
                    setLocalInstructions(prev => ({
                      ...prev,
                      [selectedPlatform]: newValue,
                    }));
                  }
                }}
                placeholder={t('customInstructionsPlaceholder')}
                error={isOverLimit}
                helperText={
                  isOverLimit 
                    ? `Character limit exceeded (${characterCount}/${MAX_CHARACTERS})`
                    : `${characterCount}/${MAX_CHARACTERS} characters`
                }
                sx={{
                  '& .MuiInputBase-root': {
                    fontSize: '0.875rem',
                  },
                }}
              />

              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                {t('customInstructionsHint')}
              </Typography>
            </Stack>
          </TabPanel>

          <TabPanel value={activeTab} index={1}>
            <Stack spacing={2}>
              <FormControl fullWidth size="small">
                <Typography variant="caption" sx={{ color: 'text.secondary', mb: 0.5, display: 'block' }}>
                  {t('platform')}
                </Typography>
                <Select
                  value={selectedTemplatePlatform}
                  onChange={(e) => setSelectedTemplatePlatform(e.target.value as 'all' | 'youtube' | 'instagram' | 'tiktok')}
                >
                  <MenuItem value="all">{t('allPlatforms')}</MenuItem>
                  <MenuItem value="youtube">📺 {t('youtube')}</MenuItem>
                  <MenuItem value="instagram">📷 {t('instagram')}</MenuItem>
                  <MenuItem value="tiktok">🎵 {t('tiktok')}</MenuItem>
                </Select>
              </FormControl>
              <TextField
                fullWidth
                multiline
                minRows={3}
                maxRows={8}
                value={templateValue}
                onChange={(e) => {
                  const newValue = e.target.value;
                  setLocalTemplate((prev) => ({
                    ...prev,
                    [selectedTemplatePlatform]: newValue,
                  }));
                }}
                placeholder={DEFAULT_TEMPLATE_PLACEHOLDER}
                sx={{
                  '& .MuiInputBase-root': {
                    fontSize: '0.875rem',
                  },
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {t('templatePlaceholders')}
              </Typography>
            </Stack>
          </TabPanel>

          <TabPanel value={activeTab} index={2}>
            <Stack spacing={2}>
              <FormControl fullWidth size="small">
                <Typography variant="caption" sx={{ color: 'text.secondary', mb: 0.5, display: 'block' }}>
                  {t('platform')}
                </Typography>
                <Select
                  value={selectedBlocksPlatform}
                  onChange={(e) => setSelectedBlocksPlatform(e.target.value as 'all' | 'youtube' | 'instagram' | 'tiktok')}
                >
                  <MenuItem value="all">{t('allPlatforms')}</MenuItem>
                  <MenuItem value="youtube">📺 {t('youtube')}</MenuItem>
                  <MenuItem value="instagram">📷 {t('instagram')}</MenuItem>
                  <MenuItem value="tiktok">🎵 {t('tiktok')}</MenuItem>
                </Select>
              </FormControl>
              <TextField
                fullWidth
                multiline
                minRows={2}
                maxRows={6}
                label={t('ctaBlock')}
                value={ctaValue}
                onChange={(e) => {
                  const newValue = e.target.value;
                  setLocalBlocks((prev) => ({
                    ...prev,
                    cta: {
                      ...prev.cta,
                      [selectedBlocksPlatform]: newValue,
                    },
                  }));
                }}
              />
              <TextField
                fullWidth
                multiline
                minRows={2}
                maxRows={6}
                label={t('linksBlock')}
                value={linksValue}
                onChange={(e) => {
                  const newValue = e.target.value;
                  setLocalBlocks((prev) => ({
                    ...prev,
                    links: {
                      ...prev.links,
                      [selectedBlocksPlatform]: newValue,
                    },
                  }));
                }}
              />
              <TextField
                fullWidth
                multiline
                minRows={2}
                maxRows={6}
                label={t('disclaimerBlock')}
                value={disclaimerValue}
                onChange={(e) => {
                  const newValue = e.target.value;
                  setLocalBlocks((prev) => ({
                    ...prev,
                    disclaimer: {
                      ...prev.disclaimer,
                      [selectedBlocksPlatform]: newValue,
                    },
                  }));
                }}
              />
            </Stack>
          </TabPanel>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleReset} color="secondary">
          {t('resetToDefault')}
        </Button>
        <Button onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button onClick={handleApply} variant="contained" disabled={!canApply}>
          {t('apply')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
