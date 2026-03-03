import * as React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItemButton,
  ListItemText,
  Box,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

export interface AccountDialogProps {
  open: boolean;
  onClose: () => void;
  onSnack: (message: string) => void;
}

export default function AccountDialog({
  open,
  onClose,
  onSnack,
}: AccountDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('account')}</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <List dense disablePadding>
            <ListItemButton
              onClick={() => onSnack(t('comingSoon'))}
              sx={{ borderRadius: 1 }}
            >
              <ListItemText primary={t('manageBilling')} />
            </ListItemButton>
            <ListItemButton
              onClick={() => onSnack(t('comingSoon'))}
              sx={{ borderRadius: 1 }}
            >
              <ListItemText primary={t('subscription')} />
            </ListItemButton>
          </List>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          {t('close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
