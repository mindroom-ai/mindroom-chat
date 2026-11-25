import { dateTimeFormat } from '../lib/time';
import type {
  DailyAccountUsage,
  ProviderAccountUsage,
  ProviderUsageSnapshot,
  TokenMix,
} from './providerUsageProtocol';
import { formatWholePercent } from './QuotaBar';

export const CALENDAR_DAYS = 7;
const DAY_MS = 86_400_000;

export type CalendarDaySlot = DailyAccountUsage;

export const sum = (values: Iterable<number>): number => {
  let total = 0;
  for (const v of values) total += v;
  return total;
};

const utcDayFromMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const utcMsFromDay = (isoDay: string): number => Date.parse(`${isoDay}T00:00:00Z`);

/**
 * Builds 7 consecutive UTC calendar days anchored at max(checked_at UTC date, latest daily_7d day),
 * filling missing days with 0 tokens and unknown (null) cost.
 */
export const buildUsageCalendar7d = (snapshot: ProviderUsageSnapshot): CalendarDaySlot[] => {
  const checkedMs = Date.parse(snapshot.checked_at);
  let anchorDay = Number.isFinite(checkedMs) ? utcDayFromMs(checkedMs) : '';
  for (const entry of snapshot.daily_7d) {
    if (entry.day > anchorDay) anchorDay = entry.day;
  }
  if (!anchorDay) return [];

  const anchorMs = utcMsFromDay(anchorDay);
  const byDay = new Map<string, DailyAccountUsage>(snapshot.daily_7d.map((d) => [d.day, d]));
  const slots: CalendarDaySlot[] = [];

  for (let offset = CALENDAR_DAYS - 1; offset >= 0; offset -= 1) {
    const day = utcDayFromMs(anchorMs - offset * DAY_MS);
    const existing = byDay.get(day);
    slots.push(
      existing ?? {
        day,
        by_account: {},
        unattributed_tokens: 0,
        unattributed_cost_usd: null,
      }
    );
  }
  return slots;
};

export const dayTotalTokens = (slot: CalendarDaySlot): number =>
  sum(Object.values(slot.by_account)) + slot.unattributed_tokens;

export const visibleDayTokens = (
  slot: CalendarDaySlot,
  visibleAccounts: readonly Pick<ProviderAccountUsage, 'id'>[]
): number => sum(visibleAccounts.map((a) => slot.by_account[a.id] ?? 0)) + slot.unattributed_tokens;

/**
 * Returns reported cost for visible accounts + unattributed cost, or `null` when no cost was
 * reported for this day (preserving unknown cost separately from `$0.00`).
 */
export const visibleDayCost = (
  slot: CalendarDaySlot,
  visibleAccounts: readonly Pick<ProviderAccountUsage, 'id'>[]
): number | null => {
  let total = 0;
  let hasKnown = false;

  if (slot.cost_by_account) {
    for (const account of visibleAccounts) {
      if (Object.prototype.hasOwnProperty.call(slot.cost_by_account, account.id)) {
        total += slot.cost_by_account[account.id] ?? 0;
        hasKnown = true;
      }
    }
  }

  const unattrCost = slot.unattributed_cost_usd;
  if (
    unattrCost !== undefined &&
    unattrCost !== null &&
    (unattrCost > 0 || slot.unattributed_tokens > 0)
  ) {
    total += unattrCost;
    hasKnown = true;
  }

  return hasKnown ? total : null;
};

/**
 * Compares the last 3 calendar days (slots 4..6) against the preceding 3 calendar days (slots 1..3).
 * Returns undefined if prior 3 days spend <= 0 or any active day in slots 1..6 has unknown cost.
 */
export const computeSpendTrend3d = (
  snapshot: ProviderUsageSnapshot,
  calendar: readonly CalendarDaySlot[]
): number | undefined => {
  if (calendar.length < CALENDAR_DAYS) return undefined;
  const window6 = calendar.slice(1, 7);
  for (const slot of window6) {
    if (dayTotalTokens(slot) > 0 && visibleDayCost(slot, snapshot.accounts) === null) {
      return undefined;
    }
  }
  const prior3 = sum(
    calendar.slice(1, 4).map((slot) => visibleDayCost(slot, snapshot.accounts) ?? 0)
  );
  if (prior3 <= 0) return undefined;
  const last3 = sum(
    calendar.slice(4, 7).map((slot) => visibleDayCost(slot, snapshot.accounts) ?? 0)
  );
  return (last3 - prior3) / prior3;
};

export const snapshotTotals = (snapshot: ProviderUsageSnapshot) => {
  const totalTokens =
    sum(snapshot.accounts.map((a) => a.tokens_7d)) + snapshot.unattributed_tokens_7d;
  const knownCosts = [
    ...snapshot.accounts.map((a) => a.cost_usd_7d),
    snapshot.unattributed_cost_usd_7d,
  ].filter((c): c is number => c !== null);
  return { totalTokens, totalCost: knownCosts.length > 0 ? sum(knownCosts) : null };
};

export const tokenMixTotal = (mix: TokenMix | undefined): number =>
  mix ? mix.cache_read_tokens + mix.cache_write_tokens + mix.input_tokens + mix.output_tokens : 0;

export const accountSubtitle = (
  account: Pick<ProviderAccountUsage, 'plan' | 'account_label'>,
  displayTitle: string
): string | undefined => {
  const raw = account.plan || account.account_label || undefined;
  return raw && !displayTitle.endsWith(`· ${raw.trim()}`) ? raw : undefined;
};

export const formatCompactTokens = (tokens: number, language: string): string =>
  new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(tokens);

export const formatExactInt = (value: number, language: string): string =>
  new Intl.NumberFormat(language).format(Math.round(value));

export const formatUsd = (amount: number, language: string): string =>
  new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

export const formatShortUsd = (amount: number, language: string): string =>
  new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    ...(amount >= 1000
      ? { notation: 'compact' as const, maximumFractionDigits: 1 }
      : { maximumFractionDigits: amount === 0 || amount >= 10 ? 0 : 1 }),
  }).format(amount);

export const formatSignedPercent = (ratio: number, language: string): string =>
  new Intl.NumberFormat(language, {
    style: 'percent',
    signDisplay: 'exceptZero',
    maximumFractionDigits: 0,
  }).format(Math.round(ratio * 100) / 100);

export const formatShare = (value: number, total: number, language: string): string => {
  const pct = total > 0 ? (value / total) * 100 : 0;
  if (pct <= 0) return formatWholePercent(0, language);
  return pct < 1 ? `<${formatWholePercent(1, language)}` : formatWholePercent(pct, language);
};

export const formatDay = (
  isoDay: string,
  language: string,
  mode: 'short' | 'full' | 'dayOnly' = 'short'
): string => {
  const parsed = utcMsFromDay(isoDay);
  if (!Number.isFinite(parsed)) return isoDay;
  if (mode === 'dayOnly') {
    return dateTimeFormat(language, { day: 'numeric', timeZone: 'UTC' }).format(parsed);
  }
  return dateTimeFormat(language, {
    ...(mode === 'full' ? { weekday: 'short' } : {}),
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
};
