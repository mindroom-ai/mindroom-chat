export const USAGE_REQUEST = 'io.mindroom.usage.request';
export const USAGE_RESPONSE = 'io.mindroom.usage.response';
export const USAGE_TIMEOUT = 20_000;
export const LOW_QUOTA_THRESHOLD = 15;

export const UNAVAILABLE_REASONS = ['unsupported', 'not_signed_in', 'probe_failed'] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export type ProviderUsageWindow = {
  id: string;
  kind: string;
  label: string;
  used_percent: number;
  remaining_percent: number;
  window_duration_mins?: number;
  resets_at?: string;
  detail?: string;
};

export type ProviderAccountUsage = {
  id: string;
  provider: string;
  display_name: string;
  account_label?: string | null;
  plan?: string | null;
  unavailable_reason?: UnavailableReason | null;
  model_keys: string[];
  windows: ProviderUsageWindow[];
  checked_at?: string | null;
  stale: boolean;
  tokens_7d: number;
  cost_usd_7d: number | null;
  cost_estimated: boolean;
};

export type DailyAccountUsage = {
  day: string;
  by_account: Record<string, number>;
  unattributed_tokens: number;
};

export type ProviderUsageSnapshot = {
  version: 1;
  request_id: string;
  checked_at: string;
  partial: boolean;
  accounts: ProviderAccountUsage[];
  daily_7d: DailyAccountUsage[];
  unattributed_tokens_7d: number;
  unattributed_cost_usd_7d: number | null;
};

const MAX_BYTES = 65536;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isUnavailableReason = (v: unknown): v is UnavailableReason =>
  (UNAVAILABLE_REASONS as readonly unknown[]).includes(v);
const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 128): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const optNullStr = (v: unknown, max = 128): string | null | undefined | false =>
  v === undefined || v === null ? v : typeof v === 'string' && v.length <= max ? v : false;
const isoTime = (v: unknown): v is string => str(v, 128) && Number.isFinite(Date.parse(v));
const pct = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
const nonNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const bounded = (v: unknown): v is Record<string, unknown> => {
  if (!isRec(v)) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(v)).length <= MAX_BYTES;
  } catch {
    return false;
  }
};

const parseWindow = (raw: unknown): ProviderUsageWindow | undefined => {
  if (
    !isRec(raw) ||
    !str(raw.id) ||
    !str(raw.kind, 64) ||
    !str(raw.label) ||
    !pct(raw.used_percent) ||
    !pct(raw.remaining_percent)
  )
    return undefined;
  const dur = raw.window_duration_mins;
  if (
    dur !== undefined &&
    dur !== null &&
    (typeof dur !== 'number' || !Number.isFinite(dur) || dur <= 0 || dur > 525600)
  )
    return undefined;
  if (raw.resets_at !== undefined && raw.resets_at !== null && !isoTime(raw.resets_at))
    return undefined;
  if (raw.detail !== undefined && raw.detail !== null && !str(raw.detail, 256)) return undefined;
  return {
    id: raw.id,
    kind: raw.kind,
    label: raw.label,
    used_percent: Math.min(100, Math.max(0, raw.used_percent)),
    remaining_percent: Math.min(100, Math.max(0, raw.remaining_percent)),
    ...(typeof dur === 'number' ? { window_duration_mins: dur } : {}),
    ...(typeof raw.resets_at === 'string' ? { resets_at: raw.resets_at } : {}),
    ...(typeof raw.detail === 'string' ? { detail: raw.detail } : {}),
  };
};

const parseAccount = (raw: unknown): ProviderAccountUsage | undefined => {
  if (
    !isRec(raw) ||
    !str(raw.id) ||
    !str(raw.provider, 64) ||
    !str(raw.display_name) ||
    typeof raw.stale !== 'boolean' ||
    !nonNeg(raw.tokens_7d) ||
    !(raw.cost_usd_7d === null || nonNeg(raw.cost_usd_7d)) ||
    typeof raw.cost_estimated !== 'boolean' ||
    !Array.isArray(raw.model_keys) ||
    raw.model_keys.length > 256 ||
    !raw.model_keys.every((k) => str(k)) ||
    !Array.isArray(raw.windows) ||
    raw.windows.length > 16
  )
    return undefined;
  const accountLabel = optNullStr(raw.account_label);
  const plan = optNullStr(raw.plan);
  if (accountLabel === false || plan === false) return undefined;
  let unavailableReason: UnavailableReason | null | undefined;
  if (raw.unavailable_reason === undefined || raw.unavailable_reason === null) {
    unavailableReason = raw.unavailable_reason;
  } else if (isUnavailableReason(raw.unavailable_reason)) {
    unavailableReason = raw.unavailable_reason;
  } else {
    return undefined;
  }
  if (raw.checked_at !== undefined && raw.checked_at !== null && !isoTime(raw.checked_at))
    return undefined;
  const windows: ProviderUsageWindow[] = [];
  const winIds = new Set<string>();
  for (const item of raw.windows) {
    const w = parseWindow(item);
    if (!w || winIds.has(w.id)) return undefined;
    winIds.add(w.id);
    windows.push(w);
  }
  return {
    id: raw.id,
    provider: raw.provider,
    display_name: raw.display_name,
    ...(accountLabel !== undefined ? { account_label: accountLabel } : {}),
    ...(plan !== undefined ? { plan } : {}),
    ...(unavailableReason !== undefined ? { unavailable_reason: unavailableReason } : {}),
    model_keys: [...(raw.model_keys as string[])],
    windows,
    ...(raw.checked_at !== undefined ? { checked_at: raw.checked_at } : {}),
    stale: raw.stale,
    tokens_7d: raw.tokens_7d,
    cost_usd_7d: raw.cost_usd_7d,
    cost_estimated: raw.cost_estimated,
  };
};

const parseDaily = (raw: unknown): DailyAccountUsage | undefined => {
  if (
    !isRec(raw) ||
    typeof raw.day !== 'string' ||
    !ISO_DAY.test(raw.day) ||
    !isRec(raw.by_account) ||
    !nonNeg(raw.unattributed_tokens)
  )
    return undefined;
  const entries = Object.entries(raw.by_account);
  if (entries.length > 64) return undefined;
  const byAccount: Record<string, number> = {};
  for (const [id, tokens] of entries) {
    if (!str(id) || UNSAFE_KEYS.has(id) || !nonNeg(tokens)) return undefined;
    byAccount[id] = tokens;
  }
  return { day: raw.day, by_account: byAccount, unattributed_tokens: raw.unattributed_tokens };
};

export const parseProviderUsageResponse = (raw: unknown): ProviderUsageSnapshot | undefined => {
  if (
    !bounded(raw) ||
    raw.version !== 1 ||
    !str(raw.request_id) ||
    !isoTime(raw.checked_at) ||
    typeof raw.partial !== 'boolean' ||
    !Array.isArray(raw.accounts) ||
    raw.accounts.length > 64 ||
    !Array.isArray(raw.daily_7d) ||
    raw.daily_7d.length > 31 ||
    !nonNeg(raw.unattributed_tokens_7d) ||
    !(raw.unattributed_cost_usd_7d === null || nonNeg(raw.unattributed_cost_usd_7d))
  )
    return undefined;
  const accounts: ProviderAccountUsage[] = [];
  const accountIds = new Set<string>();
  for (const item of raw.accounts) {
    const account = parseAccount(item);
    if (!account || accountIds.has(account.id)) return undefined;
    accountIds.add(account.id);
    accounts.push(account);
  }
  const daily: DailyAccountUsage[] = [];
  for (const item of raw.daily_7d) {
    const day = parseDaily(item);
    if (!day) return undefined;
    daily.push(day);
  }
  return {
    version: 1,
    request_id: raw.request_id,
    checked_at: raw.checked_at,
    partial: raw.partial,
    accounts,
    daily_7d: daily,
    unattributed_tokens_7d: raw.unattributed_tokens_7d,
    unattributed_cost_usd_7d: raw.unattributed_cost_usd_7d,
  };
};

export const hasLowQuotaInSnapshot = (snapshot: ProviderUsageSnapshot): boolean =>
  snapshot.accounts.some((account) =>
    account.windows.some((window) => window.remaining_percent < LOW_QUOTA_THRESHOLD)
  );
