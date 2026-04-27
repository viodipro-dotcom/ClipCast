import * as React from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

export interface SetTargetsDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (targets: { youtube: boolean; instagram: boolean; tiktok: boolean }) => void;
  selectedCount: number;
}

export default function SetTargetsDialog({
  open,
  onClose,
  onApply,
  selectedCount,
}: SetTargetsDialogProps) {
  const { t } = useTranslation();
  const [targets, setTargets] = React.useState({
    youtube: false,
    instagram: false,
    tiktok: false,
  });

  const handleApply = () => {
    onApply(targets);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {t('setTargets')} ({selectedCount} {selectedCount === 1 ? t('item') : t('items')})
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('selectTargetsDescription')}
          </Typography>
          <Box>
            <FormControlLabel
              control={
                <Checkbox
                  checked={targets.youtube}
                  onChange={(e) => setTargets({ ...targets, youtube: e.target.checked })}
                />
              }
              label={
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Typography>📺</Typography>
                  <Typography variant="body2">{t('youtube')}</Typography>
                </Stack>
              }
            />
          </Box>
          <Box>
            <FormControlLabel
              control={
                <Checkbox
                  checked={targets.instagram}
                  onChange={(e) => setTargets({ ...targets, instagram: e.target.checked })}
                />
              }
              label={
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Typography>📷</Typography>
                  <Typography variant="body2">{t('instagram')}</Typography>
                </Stack>
              }
            />
          </Box>
          <Box>
            <FormControlLabel
              control={
                <Checkbox
                  checked={targets.tiktok}
                  onChange={(e) => setTargets({ ...targets, tiktok: e.target.checked })}
                />
              }
              label={
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Typography>🎵</Typography>
                  <Typography variant="body2">{t('tiktok')}</Typography>
                </Stack>
              }
            />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button onClick={handleApply} variant="contained">
          {t('apply')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
