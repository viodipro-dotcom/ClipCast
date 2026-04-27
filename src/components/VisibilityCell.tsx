import * as React from 'react';
import { Chip, Menu, MenuItem } from '@mui/material';
import type { Visibility } from '../types';

export interface VisibilityCellProps {
  value: Visibility;
  onChange: (next: Visibility) => void;
}

function labelForVisibility(v: Visibility) {
  if (v === 'private') return 'Private';
  if (v === 'unlisted') return 'Unlisted';
  return 'Public';
}

export default function VisibilityCell({ value, onChange }: VisibilityCellProps) {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  return (
    <>
      <Chip
        clickable
        size="small"
        label={labelForVisibility(value)}
        variant="outlined"
        onClick={(e) => {
          e.stopPropagation();
          setAnchorEl(e.currentTarget);
        }}
        sx={{ cursor: 'pointer' }}
      />
      <Menu
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        onClick={(e) => e.stopPropagation()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {(['private', 'unlisted', 'public'] as const).map((v) => (
          <MenuItem
            key={v}
            selected={v === value}
            onClick={() => {
              onChange(v);
              setAnchorEl(null);
            }}
          >
            {labelForVisibility(v)}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

