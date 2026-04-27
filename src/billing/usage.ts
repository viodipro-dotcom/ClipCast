/**
 * Local stubs: no server-side quota. Preserves call sites in App (finalize/release/reserve).
 */

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

const nowPeriodStart = () => new Date().toISOString().slice(0, 7) + '-01';

const UNLIMITED: UsageSnapshot = {
  get period_start() {
    return nowPeriodStart();
  },
  uploads_used: 0,
  metadata_used: 0,
  uploads_limit: null,
  metadata_limit: null,
};

const normalizeAmount = (amount?: number) => {
  const parsed = Math.floor(Number(amount ?? 1));
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
};

function newReservationId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function getUsageSnapshot(): Promise<UsageSnapshot> {
  return { ...UNLIMITED, period_start: nowPeriodStart() };
}

export async function consumeUpload(amount = 1): Promise<UsageSnapshot> {
  void normalizeAmount(amount);
  return getUsageSnapshot();
}

export async function consumeMetadata(amount = 1): Promise<UsageSnapshot> {
  void normalizeAmount(amount);
  return getUsageSnapshot();
}

export async function reserveUpload(_requestId: string, _amount = 1): Promise<QuotaReservation> {
  return {
    reservation_id: newReservationId(),
    remaining: null,
    status: 'pending',
  };
}

export async function reserveMetadata(_requestId: string, _amount = 1): Promise<QuotaReservation> {
  return {
    reservation_id: newReservationId(),
    remaining: null,
    status: 'pending',
  };
}

export async function finalizeQuota(_reservationId: string): Promise<UsageSnapshot> {
  return getUsageSnapshot();
}

export async function releaseQuota(_reservationId: string): Promise<UsageSnapshot> {
  return getUsageSnapshot();
}
