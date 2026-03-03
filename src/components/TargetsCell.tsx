import { Chip, Stack } from '@mui/material';
import type { MetaPlatform } from '../types';

export type Targets = { youtube: boolean; instagram: boolean; tiktok: boolean };

export interface TargetsCellProps {
  targets: Targets;
  onChange: (next: Targets) => void;
}

const PLATFORM_ORDER: MetaPlatform[] = ['youtube', 'instagram', 'tiktok'];

function nextTargets(targets: Targets, platform: MetaPlatform): Targets {
  return { ...targets, [platform]: !targets[platform] };
}

export default function TargetsCell({ targets, onChange }: TargetsCellProps) {
  return (
    <Stack
      className="targets-cell-root"
      direction="row"
      spacing={0.5}
      sx={{ minWidth: 0, height: '100%', alignItems: 'stretch' }}
    >
      {PLATFORM_ORDER.map((platform) => {
        const enabled = targets[platform];
        const label = platform === 'youtube' ? 'YT' : platform === 'instagram' ? 'IG' : 'TT';
        const color = platform === 'youtube' ? 'error' : platform === 'instagram' ? 'primary' : 'default';

        return (
          <Chip
            key={platform}
            size="small"
            clickable
            label={label}
            variant={enabled ? 'filled' : 'outlined'}
            color={enabled ? (color as any) : 'default'}
            onClick={(e) => {
              e.stopPropagation();
              onChange(nextTargets(targets, platform));
            }}
            sx={{
              height: '100%',
              minHeight: 34,
              minWidth: 44,
              borderRadius: 2,
              opacity: enabled ? 1 : 0.55,
              '& .MuiChip-label': {
                px: 1,
                fontSize: '0.75rem',
                fontWeight: 700,
              },
            }}
          />
        );
      })}
    </Stack>
  );
}

