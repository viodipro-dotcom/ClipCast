import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type UsageSnapshot = {
  period_start: string;
  uploads_used: number;
  metadata_used: number;
  uploads_limit: number | null;
  metadata_limit: number | null;
};

export type QuotaReservation = {
  reservation_id: string;
  remaining: number | null;
  status: 'pending' | 'consumed' | 'released';
};

const requireSupabase = () => {
  if (!supabase) {
    throw new Error('supabase_unavailable');
  }
  return supabase;
};

const normalizeAmount = (amount?: number) => {
  const parsed = Math.floor(Number(amount ?? 1));
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
};

const unwrapRpc = (data: unknown, error: PostgrestError | null) => {
  if (error) throw error;
  if (!data) throw new Error('usage_snapshot_missing');
  return data as UsageSnapshot;
};

const unwrapReservation = (data: unknown, error: PostgrestError | null) => {
  if (error) throw error;
  if (!data) throw new Error('quota_reservation_missing');
  return data as QuotaReservation;
};

export async function getUsageSnapshot(): Promise<UsageSnapshot> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_usage_snapshot');
  return unwrapRpc(data, error);
}

export async function consumeUpload(amount = 1): Promise<UsageSnapshot> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('consume_quota', {
    kind: 'upload',
    amount: normalizeAmount(amount),
  });
  return unwrapRpc(data, error);
}

export async function consumeMetadata(amount = 1): Promise<UsageSnapshot> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('consume_quota', {
    kind: 'metadata',
    amount: normalizeAmount(amount),
  });
  return unwrapRpc(data, error);
}

export async function reserveUpload(requestId: string, amount = 1): Promise<QuotaReservation> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('reserve_quota', {
    kind: 'upload',
    request_id: requestId,
    amount: normalizeAmount(amount),
  });
  return unwrapReservation(data, error);
}

export async function reserveMetadata(requestId: string, amount = 1): Promise<QuotaReservation> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('reserve_quota', {
    kind: 'metadata',
    request_id: requestId,
    amount: normalizeAmount(amount),
  });
  return unwrapReservation(data, error);
}

export async function finalizeQuota(reservationId: string): Promise<UsageSnapshot> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('finalize_quota', {
    reservation_id: reservationId,
  });
  return unwrapRpc(data, error);
}

export async function releaseQuota(reservationId: string): Promise<UsageSnapshot> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('release_quota', {
    reservation_id: reservationId,
  });
  return unwrapRpc(data, error);
}
