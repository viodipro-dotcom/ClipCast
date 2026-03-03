import * as React from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  List,
  ListItem,
  Typography,
  Stack,
  CircularProgress,
  Alert,
} from '@mui/material';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';

type DueJob = {
  id: string;
  filePath: string;
  filename: string;
  publishAtUtcMs: number;
  platforms: Array<{ platform: 'instagram' | 'tiktok'; status: string }>;
};

type DueJobsData = {
  dueNow: DueJob[];
  dueSoon: DueJob[];
  error?: string;
};

export default function AssistCenter() {
  const { t } = useTranslation();
  const [data, setData] = React.useState<DueJobsData>({ dueNow: [], dueSoon: [] });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(new Date());

  // Update current time every second
  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const loadDueJobs = React.useCallback(async () => {
    try {
      if (!window.api?.assistCenterGetDueJobs) {
        setError(t('apiNotAvailable'));
        setLoading(false);
        return;
      }

      const result = await window.api.assistCenterGetDueJobs();
      if (result.error) {
        setError(result.error);
      } else {
        setData(result);
        setError(null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    loadDueJobs();
    // Refresh every 30 seconds
    const interval = setInterval(loadDueJobs, 30000);
    return () => clearInterval(interval);
  }, [loadDueJobs]);

  const handleAssist = async (jobId: string, platform: 'instagram' | 'tiktok') => {
    try {
      if (!window.api?.assistCenterAssistJob) return;
      setRefreshing(true);
      const result = await window.api.assistCenterAssistJob({ jobId, platform });
      if (result.ok) {
        // Reload after a short delay
        setTimeout(loadDueJobs, 500);
      } else {
        setError(result.error || t('assistFailed'));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const handleDone = async (jobId: string, platform: 'instagram' | 'tiktok') => {
    try {
      if (!window.api?.assistCenterMarkDone) return;
      setRefreshing(true);
      const result = await window.api.assistCenterMarkDone({ jobId, platform });
      if (result.ok) {
        setTimeout(loadDueJobs, 500);
      } else {
        setError(result.error || t('markDoneFailed'));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const handleSkip = async (jobId: string, platform: 'instagram' | 'tiktok') => {
    try {
      if (!window.api?.assistCenterSkipJob) return;
      setRefreshing(true);
      const result = await window.api.assistCenterSkipJob({ jobId, platform });
      if (result.ok) {
        setTimeout(loadDueJobs, 500);
      } else {
        setError(result.error || t('skipFailed'));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const handleAssistNext = async () => {
    try {
      if (window.api?.assistOverlayNext) {
        setRefreshing(true);
        const result = await window.api.assistOverlayNext();
        if (result?.ok) {
          setTimeout(loadDueJobs, 500);
        } else {
          setError(result?.error || t('noJobsDue'));
        }
        return;
      }

      // Fallback to legacy assist + done flow
      const firstDueNow = data.dueNow[0];
      if (firstDueNow && firstDueNow.platforms.length > 0) {
        const jobId = firstDueNow.id;
        const platform = firstDueNow.platforms[0].platform;
        await handleAssist(jobId, platform);
        await handleDone(jobId, platform);
        return;
      }
      const firstDueSoon = data.dueSoon[0];
      if (firstDueSoon && firstDueSoon.platforms.length > 0) {
        const jobId = firstDueSoon.id;
        const platform = firstDueSoon.platforms[0].platform;
        await handleAssist(jobId, platform);
        await handleDone(jobId, platform);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const formatTime = (utcMs: number) => {
    try {
      return format(new Date(utcMs), 'HH:mm');
    } catch {
      return '?';
    }
  };

  const formatTimeRemaining = (utcMs: number) => {
    try {
      const now = Date.now();
      const diff = utcMs - now;
      
      if (diff <= 0) {
        return t('dueNow');
      }
      
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      
      if (days > 0) {
        return t('timeRemainingDaysHours', { days, hours: hours % 24 });
      } else if (hours > 0) {
        return t('timeRemainingHoursMinutes', { hours, minutes: minutes % 60 });
      } else {
        return t('timeRemainingMinutes', { minutes });
      }
    } catch {
      return '';
    }
  };

  const renderJobItem = (job: DueJob) => {
    return (
      <Card key={job.id} sx={{ mb: 0.5, width: '100%' }}>
        <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 'bold', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {job.filename}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
              {formatTime(job.publishAtUtcMs)}
            </Typography>
            <Typography variant="caption" color="primary.main" sx={{ flexShrink: 0, fontWeight: 600 }}>
              {formatTimeRemaining(job.publishAtUtcMs)}
            </Typography>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
              {job.platforms.map((p) => {
                const platformLabel = p.platform === 'instagram' ? 'IG' : p.platform === 'tiktok' ? 'TT' : 'YT';
                return (
                  <Chip
                    key={p.platform}
                    label={platformLabel}
                    size="small"
                    color={p.platform === 'instagram' ? 'primary' : 'secondary'}
                    sx={{ height: 20, fontSize: '0.65rem' }}
                  />
                );
              })}
            </Stack>
          </Stack>
          <Stack direction="column" spacing={0.5} sx={{ width: '100%' }}>
            {job.platforms.map((p) => {
              const platformLabel = p.platform === 'instagram' ? 'IG' : p.platform === 'tiktok' ? 'TT' : 'YT';
              return (
                <Stack key={p.platform} direction="row" spacing={0.5} sx={{ width: '100%' }}>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => handleAssist(job.id, p.platform)}
                    disabled={refreshing}
                    sx={{ flex: 1, py: 0.25, fontSize: '0.75rem', height: 28 }}
                  >
                    {t('assistPlatformShort', { platform: platformLabel })}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => handleDone(job.id, p.platform)}
                    disabled={refreshing}
                    sx={{ flex: 1, py: 0.25, fontSize: '0.75rem', height: 28 }}
                  >
                    {t('done')}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => handleSkip(job.id, p.platform)}
                    disabled={refreshing}
                    sx={{ flex: 1, py: 0.25, fontSize: '0.75rem', height: 28 }}
                  >
                    {t('skipForMinutes', { minutes: 30 })}
                  </Button>
                </Stack>
              );
            })}
          </Stack>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  const totalDue = data.dueNow.length + data.dueSoon.length;
  const hasNext = data.dueNow.length > 0;

  return (
    <Box sx={{ p: 2, width: '100%', position: 'relative' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
          {t('manualAssistCenter')}
        </Typography>
        <Chip
          label={format(currentTime, 'HH:mm:ss')}
          size="small"
          sx={{
            fontFamily: 'monospace',
            fontWeight: 600,
            fontSize: '0.875rem',
            height: 28,
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            color: 'text.primary',
            border: '1px solid rgba(99, 102, 241, 0.2)',
          }}
        />
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Button
        variant="contained"
        color="primary"
        fullWidth
        size="large"
        onClick={handleAssistNext}
        disabled={!hasNext || refreshing}
        sx={{ mb: 3 }}
      >
        {hasNext ? t('assistNext') : t('noJobsDue')}
      </Button>

      {data.dueNow.length > 0 && (
        <Box sx={{ mb: 3, width: '100%' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
            {t('dueNowCount', { count: data.dueNow.length })}
          </Typography>
          <List sx={{ width: '100%' }}>
            {data.dueNow.map((job) => (
              <ListItem key={job.id} disablePadding sx={{ width: '100%' }}>
                {renderJobItem(job)}
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      {data.dueSoon.length > 0 && (
        <Box sx={{ width: '100%' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
            {t('dueSoonCount', { count: data.dueSoon.length })}
          </Typography>
          <List sx={{ width: '100%' }}>
            {data.dueSoon.map((job) => (
              <ListItem key={job.id} disablePadding sx={{ width: '100%' }}>
                {renderJobItem(job)}
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      {totalDue === 0 && !loading && (
        <Alert severity="info">{t('noJobsDueNextHour')}</Alert>
      )}
    </Box>
  );
}
