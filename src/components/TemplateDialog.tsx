import * as React from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Stack,
  Typography,
  Divider,
  Alert,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import type { MetadataTemplate, MetaPlatform } from '../types';
import { useTranslation } from 'react-i18next';

export interface TemplateDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (template: MetadataTemplate) => void;
  onSave: (name: string, platforms: Partial<Record<MetaPlatform, { title?: string; description?: string; hashtags?: string }>>) => Promise<void>;
  onDelete: (templateId: string) => Promise<void>;
  templates: MetadataTemplate[];
  currentMetadata?: Partial<Record<MetaPlatform, { title?: string; description?: string; hashtags?: string }>>;
}

export default function TemplateDialog({
  open,
  onClose,
  onApply,
  onSave,
  onDelete,
  templates,
  currentMetadata,
}: TemplateDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = React.useState<'select' | 'save'>('select');
  const [templateName, setTemplateName] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setMode('select');
      setTemplateName('');
      setError(null);
    }
  }, [open]);

  const handleSave = async () => {
    if (!templateName.trim()) {
      setError(t('templateNameRequired'));
      return;
    }
    if (!currentMetadata || Object.keys(currentMetadata).length === 0) {
      setError(t('noMetadataToSave'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(templateName.trim(), currentMetadata);
      setMode('select');
      setTemplateName('');
    } catch (e: any) {
      setError(e?.message || t('templateSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(t('deleteTemplateConfirm'))) {
      try {
        await onDelete(templateId);
      } catch (e: any) {
        setError(e?.message || t('templateDeleteFailed'));
      }
    }
  };

  const handleApply = (template: MetadataTemplate) => {
    onApply(template);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {mode === 'select' ? t('selectTemplate') : t('saveAsTemplate')}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {mode === 'select' ? (
          <Box>
            {templates.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                {t('noTemplates')}
              </Typography>
            ) : (
              <List>
                {templates.map((template, idx) => (
                  <React.Fragment key={template.id}>
                    <ListItem disablePadding>
                      <ListItemButton onClick={() => handleApply(template)}>
                        <ListItemText
                          primary={template.name}
                          secondary={
                    <Typography variant="caption" color="text.secondary">
                      {t('platformCount', { count: Object.keys(template.platforms || {}).length })} •{' '}
                      {new Date(template.updatedAt).toLocaleDateString()}
                    </Typography>
                          }
                        />
                        <ListItemSecondaryAction>
                          <IconButton
                            edge="end"
                            onClick={(e) => handleDelete(template.id, e)}
                            size="small"
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItemButton>
                    </ListItem>
                    {idx < templates.length - 1 && <Divider />}
                  </React.Fragment>
                ))}
              </List>
            )}
            {currentMetadata && Object.keys(currentMetadata).length > 0 && (
              <>
                <Divider sx={{ my: 2 }} />
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={() => setMode('save')}
                >
                  {t('createFromCurrent')}
                </Button>
              </>
            )}
          </Box>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t('templateName')}
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              fullWidth
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSave();
                }
              }}
            />
            <Typography variant="body2" color="text.secondary">
              {t('createFromCurrent')}
            </Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => mode === 'save' ? setMode('select') : onClose()}>
          {mode === 'save' ? t('cancel') : t('close')}
        </Button>
        {mode === 'save' && (
          <Button onClick={handleSave} variant="contained" disabled={saving || !templateName.trim()}>
            {t('save')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
