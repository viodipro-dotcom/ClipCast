import * as React from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

interface AddDialogProps {
  open: boolean;
  onClose: () => void;
  onAddFiles: () => void;
  onAddFolder: () => void;
}

export default function AddDialog({ open, onClose, onAddFiles, onAddFolder }: AddDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          borderRadius: 3,
          minWidth: 400,
        },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Typography variant="h5">📁</Typography>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t('addVideos')}
          </Typography>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
          {t('addVideosDescription')}
        </Typography>
        <Alert
          severity="info"
          icon={<Typography>💡</Typography>}
          sx={{
            borderRadius: 2,
            '& .MuiAlert-message': { width: '100%' },
          }}
        >
          <Typography variant="caption">
            <strong>{t('tipLabel')}:</strong> {t('addVideosTip')}
          </Typography>
        </Alert>
      </DialogContent>
      <DialogActions sx={{ p: 2.5, pt: 1 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          {t('cancel')}
        </Button>
        <Button variant="outlined" onClick={onAddFolder} startIcon={<Typography>📂</Typography>} sx={{ textTransform: 'none' }}>
          {t('folder')}
        </Button>
        <Button variant="contained" onClick={onAddFiles} startIcon={<Typography>📄</Typography>} sx={{ textTransform: 'none' }}>
          {t('files')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
