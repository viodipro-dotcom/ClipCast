import * as React from 'react';
import { Badge, Box } from '@mui/material';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import { useTranslation } from 'react-i18next';

export default function AssistOverlay() {
  const { t } = useTranslation();
  const [count, setCount] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');

    const prev = {
      html: {
        width: html.style.width,
        height: html.style.height,
        margin: html.style.margin,
        padding: html.style.padding,
        overflow: html.style.overflow,
        backgroundColor: html.style.backgroundColor,
      },
      body: {
        width: body.style.width,
        height: body.style.height,
        margin: body.style.margin,
        padding: body.style.padding,
        minWidth: body.style.minWidth,
        minHeight: body.style.minHeight,
        overflow: body.style.overflow,
        backgroundColor: body.style.backgroundColor,
      },
      root: root
        ? {
            width: root.style.width,
            height: root.style.height,
            overflow: root.style.overflow,
          }
        : null,
    };

    html.style.width = '100%';
    html.style.height = '100%';
    html.style.margin = '0';
    html.style.padding = '0';
    html.style.overflow = 'visible';
    html.style.backgroundColor = 'transparent';

    body.style.width = '100%';
    body.style.height = '100%';
    body.style.margin = '0';
    body.style.padding = '0';
    body.style.minWidth = '0';
    body.style.minHeight = '0';
    body.style.overflow = 'visible';
    body.style.backgroundColor = 'transparent';

    if (root) {
      root.style.width = '100%';
      root.style.height = '100%';
      root.style.overflow = 'visible';
    }

    return () => {
      html.style.width = prev.html.width;
      html.style.height = prev.html.height;
      html.style.margin = prev.html.margin;
      html.style.padding = prev.html.padding;
      html.style.overflow = prev.html.overflow;
      html.style.backgroundColor = prev.html.backgroundColor;

      body.style.width = prev.body.width;
      body.style.height = prev.body.height;
      body.style.margin = prev.body.margin;
      body.style.padding = prev.body.padding;
      body.style.minWidth = prev.body.minWidth;
      body.style.minHeight = prev.body.minHeight;
      body.style.overflow = prev.body.overflow;
      body.style.backgroundColor = prev.body.backgroundColor;

      if (root && prev.root) {
        root.style.width = prev.root.width;
        root.style.height = prev.root.height;
        root.style.overflow = prev.root.overflow;
      }
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    window.api?.assistOverlayGetCount?.()
      .then((res) => {
        if (!active) return;
        if (typeof res?.count === 'number') {
          setCount(res.count);
        }
      })
      .catch(() => {
        // ignore
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (!window.api?.onAssistOverlayCount) return undefined;
    return window.api.onAssistOverlayCount((data) => {
      if (typeof data?.count === 'number') {
        setCount(data.count);
      }
    });
  }, []);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.api?.assistOverlayNext?.();
      if (!res?.ok) {
        setError(res?.error || t('noJobsDue'));
      }
      if (typeof res?.remaining === 'number') {
        setCount(res.remaining);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        userSelect: 'none',
        overflow: 'visible',
        padding: 2,
      }}
    >
      <Badge
        color="error"
        badgeContent={count}
        invisible={count <= 1}
        sx={{
          '& .MuiBadge-badge': {
            boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.15)',
          },
        }}
      >
        <Box
          component="button"
          onClick={handleClick}
          aria-label={t('assistNext')}
          disabled={busy}
          sx={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            boxSizing: 'border-box',
            padding: 0,
            border: '1px solid rgba(255, 255, 255, 0.25)',
            background: 'rgba(99, 102, 241, 0.88)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 0,
            minHeight: 0,
            cursor: busy ? 'progress' : 'pointer',
            boxShadow: '0 6px 16px rgba(0, 0, 0, 0.35)',
            outline: 'none',
            transition: 'transform 120ms ease, box-shadow 120ms ease, background 120ms ease',
            '&:hover': {
              transform: 'scale(1.03)',
              background: 'rgba(99, 102, 241, 0.98)',
            },
            '&:active': {
              transform: 'scale(0.98)',
            },
          }}
        >
          <SkipNextIcon sx={{ fontSize: 30 }} />
        </Box>
      </Badge>
    </Box>
  );
}
