import { Fragment } from 'react';
import { color } from 'folds';
import { useTranslation } from 'react-i18next';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { dateTimeFormat } from '../lib/time';
import type { ProviderAccountUsage, ProviderUsageWindow } from './providerUsageProtocol';
import * as css from './QuotaBar.css';

type QuotaTone = 'healthy' | 'warning' | 'critical';

const PROVIDER_ACCENTS: Readonly<Record<string, string>> = {
  claude_code: '#d97757',
  anthropic: '#d97757',
  codex: '#10a37f',
  openai: '#10a37f',
  openrouter: '#7c6af7',
  google: '#4285f4',
  gemini: '#4285f4',
};

const FALLBACK_PALETTE = ['#3b82f6', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

export const quotaTone = (remainingPercent: number): QuotaTone => {
  if (remainingPercent <= 10) return 'critical';
  if (remainingPercent <= 20) return 'warning';
  return 'healthy';
};

export const providerAccentColor = (provider?: string): string => {
  const key = provider?.toLowerCase() ?? '';
  return PROVIDER_ACCENTS[key] ?? color.Primary.Main;
};

export const accountChartColor = (
  account: Pick<ProviderAccountUsage, 'provider'>,
  index: number,
  seenProviders: Set<string>
): string => {
  const key = account.provider.toLowerCase();
  const base = PROVIDER_ACCENTS[key];
  if (base && !seenProviders.has(key)) {
    seenProviders.add(key);
    return base;
  }
  return FALLBACK_PALETTE[index % FALLBACK_PALETTE.length] ?? color.Primary.Main;
};

export const computePacePercent = (
  resetsAt: string | undefined,
  windowDurationMins: number | undefined,
  now: number
): number | undefined => {
  if (!resetsAt || !windowDurationMins || windowDurationMins <= 0) return undefined;
  const resetMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetMs)) return undefined;
  const raw = ((resetMs - now) / (windowDurationMins * 60_000)) * 100;
  return clampPercent(raw);
};

const formatCompactUnit = (
  value: number,
  unit: 'day' | 'hour' | 'minute',
  language: string
): string =>
  new Intl.NumberFormat(language, {
    style: 'unit',
    unit,
    unitDisplay: 'narrow',
  }).format(value);

export const formatResetCountdown = (
  resetsAt: string | undefined,
  now: number,
  language: string,
  t: (
    key: 'mindroomUi.usage.resetsSoon' | 'mindroomUi.usage.resetsIn' | 'mindroomUi.usage.resetsAt',
    options?: Record<string, string>
  ) => string
): string | undefined => {
  if (!resetsAt) return undefined;
  const resetMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetMs)) return undefined;
  const diffMs = resetMs - now;
  if (diffMs <= 0) return t('mindroomUi.usage.resetsSoon');

  if (diffMs < 48 * 3_600_000) {
    const totalMinutes = Math.max(1, Math.ceil(diffMs / 60_000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];
    if (days > 0) {
      parts.push(formatCompactUnit(days, 'day', language));
      if (hours > 0) parts.push(formatCompactUnit(hours, 'hour', language));
    } else if (hours > 0) {
      parts.push(formatCompactUnit(hours, 'hour', language));
      if (minutes > 0) parts.push(formatCompactUnit(minutes, 'minute', language));
    } else {
      parts.push(formatCompactUnit(minutes, 'minute', language));
    }
    const duration = new Intl.ListFormat(language, { type: 'unit', style: 'narrow' }).format(parts);
    return t('mindroomUi.usage.resetsIn', { duration });
  }

  const time = dateTimeFormat(language, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(resetMs);
  return t('mindroomUi.usage.resetsAt', { time });
};

const shortWindowTag = (window: ProviderUsageWindow): string => {
  const mins = window.window_duration_mins;
  if (typeof mins === 'number' && mins > 0) {
    if (mins >= 1440 && mins % 1440 === 0) return `${mins / 1440}d`;
    if (mins >= 60 && mins % 60 === 0) return `${mins / 60}h`;
    return `${mins}m`;
  }
  return window.label;
};

/**
 * Returns the single matching account only when every model key belongs exclusively to that
 * account; returns undefined when empty, unmatched, or spanning multiple accounts.
 */
export const singleAccountForModels = (
  accounts: readonly ProviderAccountUsage[],
  modelKeys: readonly string[]
): ProviderAccountUsage | undefined => {
  if (modelKeys.length === 0) return undefined;
  let matched: ProviderAccountUsage | undefined;
  for (const key of modelKeys) {
    const owners = accounts.filter((account) => account.model_keys.includes(key));
    if (owners.length !== 1) return undefined;
    const [owner] = owners;
    if (!owner) return undefined;
    if (!matched) matched = owner;
    else if (matched.id !== owner.id) return undefined;
  }
  return matched;
};

export function QuotaBar({
  window,
  provider,
  now = Date.now(),
}: {
  window: ProviderUsageWindow;
  provider?: string;
  now?: number;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const remaining = clampPercent(window.remaining_percent);
  const rounded = Math.round(remaining);
  const tone = quotaTone(remaining);
  const fillColor =
    tone === 'critical'
      ? color.Critical.Main
      : tone === 'warning'
      ? color.Warning.Main
      : providerAccentColor(provider);
  const pacePercent = computePacePercent(window.resets_at, window.window_duration_mins, now);
  const resetText = formatResetCountdown(window.resets_at, now, language, (key, options) =>
    t(key, options)
  );
  const ariaLabel = resetText
    ? t('mindroomUi.usage.quotaAriaWithReset', {
        label: window.label,
        percent: rounded,
        reset: resetText,
      })
    : t('mindroomUi.usage.quotaAria', { label: window.label, percent: rounded });

  return (
    <div className={css.Root}>
      <div className={css.Header}>
        <span className={css.Label}>{window.label}</span>
        <span className={css.Percent} data-tone={tone}>
          {t('mindroomUi.usage.percentLeft', { percent: rounded })}
        </span>
      </div>
      <div className={css.Track} role="img" aria-label={ariaLabel}>
        <div
          className={css.Fill}
          style={{ inlineSize: `${remaining}%`, backgroundColor: fillColor }}
        />
        {pacePercent !== undefined && (
          <div
            className={css.PaceTick}
            data-pace-tick=""
            style={{ insetInlineStart: `${pacePercent}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      {(window.detail || resetText) && (
        <div className={css.Meta}>
          {window.detail && <span>{window.detail}</span>}
          {resetText && <span>{resetText}</span>}
        </div>
      )}
    </div>
  );
}

export function InlineQuotaSummary({ account }: { account: ProviderAccountUsage }) {
  const { t } = useTranslation();
  if (account.windows.length === 0) return null;

  if (account.windows.length === 1) {
    const [single] = account.windows;
    if (!single) return null;
    const remaining = clampPercent(single.remaining_percent);
    const rounded = Math.round(remaining);
    return (
      <span className={css.InlineRoot} data-inline-quota={account.id}>
        <span className={css.InlineItem} data-tone={quotaTone(remaining)}>
          {t('mindroomUi.usage.percentLeft', { percent: rounded })}
        </span>
      </span>
    );
  }

  const shown = account.windows.slice(0, 2);
  return (
    <span className={css.InlineRoot} data-inline-quota={account.id}>
      {shown.map((window, index) => {
        const remaining = clampPercent(window.remaining_percent);
        return (
          <Fragment key={window.id}>
            {index > 0 && (
              <span className={css.InlineDot} aria-hidden="true">
                ·
              </span>
            )}
            <span className={css.InlineItem} data-tone={quotaTone(remaining)}>
              {shortWindowTag(window)} {Math.round(remaining)}%
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}
