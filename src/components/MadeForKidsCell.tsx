import * as React from 'react';
import { Chip, Menu, MenuItem, Tooltip } from '@mui/material';

export interface MadeForKidsCellProps {
  value: boolean;
  onChange: (next: boolean) => void;
  labels?: { yes: string; no: string };
  tooltipLabel?: string;
}

function labelForValue(v: boolean, labels?: { yes: string; no: string }) {
  if (v) return labels?.yes ?? 'Yes';
  return labels?.no ?? 'No';
}

export default function MadeForKidsCell({ value, onChange, labels, tooltipLabel }: MadeForKidsCellProps) {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  return (
    <>
      <Tooltip title={tooltipLabel || ''} disableHoverListener={!tooltipLabel}>
        <Chip
          clickable
          size="small"
          label={labelForValue(value, labels)}
          variant="outlined"
          onClick={(e) => {
            e.stopPropagation();
            setAnchorEl(e.currentTarget);
          }}
          sx={{ cursor: 'pointer' }}
        />
      </Tooltip>
      <Menu
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        onClick={(e) => e.stopPropagation()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {[true, false].map((next) => (
          <MenuItem
            key={String(next)}
            selected={next === value}
            onClick={() => {
              onChange(next);
              setAnchorEl(null);
            }}
          >
            {labelForValue(next, labels)}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
