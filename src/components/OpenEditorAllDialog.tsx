import * as React from 'react';
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import type { JobRow } from '../types';
import { baseName } from '../utils';
import { useTranslation } from 'react-i18next';

export type ExportPathsData = {
  ok: boolean;
  platforms?: Record<
    'youtube' | 'instagram' | 'tiktok',
    { folder: string; primary: string; allFiles: string[]; hasExport: boolean }
  >;
  error?: string;
};

export interface OpenEditorAllDialogProps {
  open: boolean;
  onClose: () => void;
  selectedRow: JobRow | null;
  onSnack: (message: string) => void;
}

export default function OpenEditorAllDialog({
  open,
  onClose,
  selectedRow,
  onSnack,
}: OpenEditorAllDialogProps) {
  const { t } = useTranslation();
  const [tabIndex, setTabIndex] = React.useState(0);
  const [platformsData, setPlatformsData] = React.useState<ExportPathsData | null>(null);

  React.useEffect(() => {
    if (!open || !selectedRow?.filePath) return;
    let cancelled = false;
    window.api?.getExportPathsForRow?.(selectedRow.filePath).then((res) => {
      if (!cancelled) setPlatformsData(res ?? null);
    }).catch(() => {
      if (!cancelled) setPlatformsData({ ok: false, error: 'Failed to load' });
    });
    return () => {
      cancelled = true;
    };
  }, [open, selectedRow?.filePath]);

  const platformKeys = ['youtube', 'instagram', 'tiktok'] as const;
  const tabLabels: Record<(typeof platformKeys)[number], string> = {
    youtube: t('youtube'),
    instagram: t('instagram'),
    tiktok: t('tiktok'),
  };

  const handleOpenInExplorer = async (platform: 'youtube' | 'instagram' | 'tiktok') => {
    if (!selectedRow) return;
    const result = await window.api?.openExportsForPath?.(platform, selectedRow.filePath);
    if (result?.openedFolder) {
      onSnack(t('exportFileNotFoundOpenedFolder'));
    } else if (result?.ok) {
      onSnack(t('openedMetadataFolderHint'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { minHeight: 320 } }}
    >
      <DialogTitle>{t('openEditor')}</DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        <Tabs
          value={tabIndex}
          onChange={(_, v) => setTabIndex(v)}
          sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
        >
          {platformKeys.map((p, i) => (
            <Tab
              key={p}
              label={tabLabels[p]}
              id={`open-editor-tab-${i}`}
              aria-controls={`open-editor-tabpanel-${i}`}
            />
          ))}
        </Tabs>
        {platformKeys.map((platform, i) => (
          <div
            key={platform}
            role="tabpanel"
            hidden={tabIndex !== i}
            id={`open-editor-tabpanel-${i}`}
            aria-labelledby={`open-editor-tab-${i}`}
          >
            {tabIndex === i && (
              <Stack spacing={2}>
                {!platformsData ? (
                  <Typography variant="body2" color="text.secondary">
                    {t('loading')}…
                  </Typography>
                ) : platformsData.platforms?.[platform]?.hasExport ? (
                  <>
                    <List dense sx={{ bgcolor: 'action.hover', borderRadius: 1 }}>
                      {(platformsData.platforms[platform].allFiles || []).map((filePath) => (
                        <ListItemButton
                          key={filePath}
                          selected={filePath === platformsData.platforms![platform].primary}
                          sx={{ py: 0.5 }}
                        >
                          <ListItemText
                            primary={baseName(filePath)}
                            secondary={filePath}
                            primaryTypographyProps={{ variant: 'body2' }}
                          />
                        </ListItemButton>
                      ))}
                    </List>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => handleOpenInExplorer(platform)}
                    >
                      {t('openInExplorer')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                      {t('noExportForPlatform')}
                    </Typography>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => handleOpenInExplorer(platform)}
                    >
                      {t('openInExplorer')}
                    </Button>
                  </>
                )}
              </Stack>
            )}
          </div>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
