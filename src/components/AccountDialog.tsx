import * as React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Typography,
  Divider,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { User } from '@supabase/supabase-js';
import { supabase as supabaseClient } from '../lib/supabase';
import type { UsageSnapshot } from '../billing/usage';
import type { NetworkStatus } from '../lib/networkStatus';
import { isNetworkError } from '../lib/networkStatus';

export interface AccountDialogProps {
  open: boolean;
  onClose: () => void;
  onSnack: (message: string) => void;
  onRequireOnline?: () => boolean;
  onNetworkError?: (err: unknown) => void;
  /** Current Supabase user when signed in via deep link / PKCE */
  supabaseUser?: User | null;
  networkStatus?: NetworkStatus;
  entitlement?: {
    plan: string;
    status: string;
    trial_ends_at?: string | null;
    trial_used?: boolean | null;
  } | null;
  subscription?: {
    id?: string;
    customer_id?: string | null;
    status?: string | null;
    current_period_end?: string | number | null;
    cancel_at_period_end?: boolean | null;
    ended_at?: string | number | null;
  } | null;
  usageSnapshot?: UsageSnapshot | null;
  usageLoading?: boolean;
  /** Called after sign-out so parent can clear user state */
  onSignOut?: () => void;
}

const DEEP_LINK_CALLBACK = 'clipcast://auth/callback';

declare global {
  interface Window {
    clipcast?: {
      openExternal: (url: string) => Promise<{ ok?: boolean; error?: string }>;
    };
    api?: { openExternal?: (url: string) => Promise<{ ok?: boolean; error?: string }> };
  }
}

export default function AccountDialog({
  open,
  onClose,
  onSnack,
  onRequireOnline,
  onNetworkError,
  supabaseUser = null,
  networkStatus = 'online',
  entitlement = null,
  subscription = null,
  usageSnapshot = null,
  usageLoading = false,
  onSignOut,
}: AccountDialogProps) {
  const { t } = useTranslation();
  const [signInLoading, setSignInLoading] = React.useState(false);
  const [waitingForLogin, setWaitingForLogin] = React.useState(false);

  const handleSignOut = React.useCallback(async () => {
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
      try {
        await window.api?.secretsClearYouTubeTokens?.();
      } catch (e) {
        console.error('Failed to clear YouTube tokens on sign-out:', e);
      }
      onSignOut?.();
    }
  }, [onSignOut]);

  const openExternal = window.clipcast?.openExternal ?? window.api?.openExternal;
  const BILLING_URL = 'https://getclipcast.app/account';
  const PRICING_URL = 'https://getclipcast.app/pricing';

  const prettyPlan = React.useCallback((planId?: string) => {
    const value = String(planId || 'try_free');
    if (value === 'starter') return 'Basic';
    if (value === 'try_free') return 'Try Free';
    if (value === 'pro_plus') return 'Pro+';
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }, []);

  const prettyStatus = React.useCallback((status?: string, cancelAtPeriodEnd?: boolean) => {
    const value = String(status || 'inactive').toLowerCase();
    if (value === 'active' && cancelAtPeriodEnd) return 'Active (cancels at period end)';
    if (value === 'active') return 'Active';
    if (value === 'trialing' || value === 'trial') return 'Trial';
    if (value === 'canceled') return 'Canceled';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }, []);

  const fmtDate = React.useCallback((d?: string | number | null) => {
    if (d == null) return '—';
    const normalized = typeof d === 'number' ? (d > 1_000_000_000_000 ? d : d * 1000) : d;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(parsed);
  }, []);

  const displayPlan = prettyPlan(entitlement?.plan);
  const statusValue = entitlement?.status ?? subscription?.status ?? 'inactive';
  const cancelAtPeriodEnd = Boolean(subscription?.cancel_at_period_end);
  const dateLabel = cancelAtPeriodEnd ? t('endsOn') : t('renewsOn');
  const dateValue = subscription?.current_period_end ?? subscription?.ended_at ?? null;
  const canManageBilling = Boolean(subscription?.customer_id || subscription?.id);
  const planActionLabel = t('changePlan');

  const uploadsUsed = usageSnapshot?.uploads_used ?? 0;
  const uploadsLimit = usageSnapshot?.uploads_limit ?? null;
  const metadataUsed = usageSnapshot?.metadata_used ?? 0;
  const metadataLimit = usageSnapshot?.metadata_limit ?? null;
  const formatLimit = (value: number | null) => (value == null ? 'Unlimited' : String(value));
  const formatRemaining = (used: number, limit: number | null) => (
    limit == null ? 'Unlimited' : String(Math.max(limit - used, 0))
  );

  const handleOpenExternal = React.useCallback(
    async (url: string) => {
      if (!openExternal) {
        onSnack(t('signInNotConfigured'));
        return;
      }
      if (networkStatus === 'offline') {
        onSnack('You are offline. The billing page may not load.');
      }
      const result = await openExternal(url);
      if (result?.ok !== true && result?.error) {
        onSnack(result.error ?? t('signInError', { message: 'Failed to open browser' }));
      }
    },
    [networkStatus, openExternal, onSnack, t],
  );

  const handleManageBilling = React.useCallback(() => {
    void handleOpenExternal(BILLING_URL);
  }, [handleOpenExternal]);

  const handleUpgrade = React.useCallback(() => {
    void handleOpenExternal(PRICING_URL);
  }, [handleOpenExternal]);

  React.useEffect(() => {
    if (supabaseUser) setWaitingForLogin(false);
  }, [supabaseUser]);

  // Clear "Waiting for login…" and close when auth succeeds (modal close is done by App; we clear local state)
  // or when auth fails so user can try again without stale waiting state
  React.useEffect(() => {
    const onSignedIn = () => setWaitingForLogin(false);
    const onFailed = () => setWaitingForLogin(false);
    window.addEventListener('auth:signed-in', onSignedIn);
    window.addEventListener('auth:sign-in-failed', onFailed);
    return () => {
      window.removeEventListener('auth:signed-in', onSignedIn);
      window.removeEventListener('auth:sign-in-failed', onFailed);
    };
  }, []);

  const handleSignIn = React.useCallback(async () => {
    if (onRequireOnline && !onRequireOnline()) {
      return;
    }
    if (!supabaseClient) {
      onSnack(t('authMissingEnv'));
      return;
    }
    setSignInLoading(true);
    setWaitingForLogin(false);
    try {
      const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: DEEP_LINK_CALLBACK,
          skipBrowserRedirect: true,
        },
      });
      if (error) {
        if (isNetworkError(error)) {
          onNetworkError?.(error);
        }
        onSnack(t('signInError', { message: error.message }));
        return;
      }
      if (data?.url) {
        if (openExternal) {
          const result = await openExternal(data.url);
          if (result?.ok !== true && result?.error) {
            onSnack(result.error ?? t('signInError', { message: 'Failed to open browser' }));
            return;
          }
          setWaitingForLogin(true);
        } else {
          onSnack(t('signInNotConfigured'));
        }
      }
    } catch (err) {
      if (isNetworkError(err)) {
        onNetworkError?.(err);
      }
      onSnack(t('signInError', { message: String(err) }));
    } finally {
      setSignInLoading(false);
    }
  }, [onNetworkError, onRequireOnline, onSnack, openExternal, t]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('account')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1, minWidth: 420 }}>
          {supabaseUser?.email ? (
            <>
              <Stack spacing={0.5}>
                <Typography variant="subtitle2" color="text.secondary">
                  {t('signedInAsLabel')}
                </Typography>
                <Typography variant="body1" fontWeight={700}>
                  {supabaseUser.email ?? '—'}
                </Typography>
              </Stack>

              <Divider />

              <Stack spacing={1}>
                <Typography variant="subtitle1" fontWeight={700}>
                  {t('subscription')}
                </Typography>
                <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
                  <Stack spacing={0.25}>
                    <Typography variant="caption" color="text.secondary">
                      {t('plan')}
                    </Typography>
                    <Typography variant="body2">{displayPlan}</Typography>
                  </Stack>
                  <Stack spacing={0.25}>
                    <Typography variant="caption" color="text.secondary">
                      {t('status')}
                    </Typography>
                    <Typography variant="body2">{prettyStatus(statusValue, cancelAtPeriodEnd)}</Typography>
                  </Stack>
                  <Stack spacing={0.25}>
                    <Typography variant="caption" color="text.secondary">
                      {dateLabel}
                    </Typography>
                    <Typography variant="body2">{fmtDate(dateValue)}</Typography>
                  </Stack>
                </Stack>
              </Stack>

              <Divider />

              <Stack spacing={1}>
                <Typography variant="subtitle1" fontWeight={700}>
                  Usage this period
                </Typography>
                {usageLoading ? (
                  <Typography variant="body2" color="text.secondary">
                    Loading usage…
                  </Typography>
                ) : usageSnapshot ? (
                  <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
                    <Stack spacing={0.25}>
                      <Typography variant="caption" color="text.secondary">
                        Uploads remaining
                      </Typography>
                      <Typography variant="body2">
                        {formatRemaining(uploadsUsed, uploadsLimit)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {uploadsUsed} / {formatLimit(uploadsLimit)} used
                      </Typography>
                    </Stack>
                    <Stack spacing={0.25}>
                      <Typography variant="caption" color="text.secondary">
                        Metadata remaining
                      </Typography>
                      <Typography variant="body2">
                        {formatRemaining(metadataUsed, metadataLimit)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {metadataUsed} / {formatLimit(metadataLimit)} used
                      </Typography>
                    </Stack>
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Usage unavailable.
                  </Typography>
                )}
              </Stack>

              <Divider />

              <Stack direction="row" spacing={1} justifyContent="space-between">
                <Button variant="contained" onClick={handleManageBilling} disabled={!canManageBilling}>
                  {t('manageBilling')}
                </Button>
                <Button variant="outlined" onClick={handleUpgrade} disabled={!supabaseUser?.email}>
                  {planActionLabel}
                </Button>
              </Stack>
            </>
          ) : (
            <>
              <Button
                fullWidth
                variant="contained"
                onClick={handleSignIn}
                disabled={signInLoading}
              >
                {signInLoading ? '…' : t('signInWithGoogle')}
              </Button>
              {waitingForLogin && (
                <Typography variant="body2" color="text.secondary">
                  {t('authWaitingForLogin')}
                </Typography>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
        <Button
          onClick={handleSignOut}
          color="error"
          variant="text"
          disabled={!supabaseUser?.email || !onSignOut}
        >
          {t('signOut')}
        </Button>
        <Button onClick={onClose} variant="outlined">
          {t('close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
