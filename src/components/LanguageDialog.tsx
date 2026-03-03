import * as React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  FormLabel,
  MenuItem,
  Select,
  Box,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { UI_LANGUAGE_OPTIONS } from '../i18n/languages';

export interface LanguageDialogProps {
  open: boolean;
  onClose: () => void;
  lang: string;
  onLangChange: (lang: string) => void;
}

export default function LanguageDialog({
  open,
  onClose,
  lang,
  onLangChange,
}: LanguageDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('language')}</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <FormControl fullWidth size="medium">
            <FormLabel sx={{ mb: 1, fontWeight: 500 }}>{t('language')}</FormLabel>
            <Select
              value={lang}
              onChange={(e) => {
                onLangChange(String(e.target.value));
              }}
              MenuProps={{
                anchorOrigin: {
                  vertical: 'bottom',
                  horizontal: 'left',
                },
                transformOrigin: {
                  vertical: 'top',
                  horizontal: 'left',
                },
                PaperProps: {
                  sx: { maxHeight: 300 },
                },
              }}
            >
              {UI_LANGUAGE_OPTIONS.map((o) => (
                <MenuItem key={o.code} value={o.code}>
                  {t(o.labelKey, { defaultValue: o.label })}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
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
