import { Fragment } from 'react';
import { color } from 'folds';
import { useTranslation } from 'react-i18next';
import { toSupportedLanguageCode } from '../i18n/i18nLanguages';
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

const FALLBACK_PALETTE = [
  '#3b82f6',
  '#f59e0b',
  '#ec4899',
  '#14b8a6',
  '#8b5cf6',
  '#06b6d4',
  '#84cc16',
  '#f97316',
];

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
  usedColors: Set<string>
): string => {
  const base = PROVIDER_ACCENTS[account.provider.toLowerCase()];
  if (base && !usedColors.has(base)) {
    usedColors.add(base);
    return base;
  }
  const unused = FALLBACK_PALETTE.find((candidate) => !usedColors.has(candidate));
  const chosen = unused ?? FALLBACK_PALETTE[index % FALLBACK_PALETTE.length] ?? color.Primary.Main;
  usedColors.add(chosen);
  return chosen;
};

export const formatWholePercent = (percent: number, language: string): string =>
  new Intl.NumberFormat(language, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(Math.round(percent) / 100);

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

const shortWindowTag = (window: ProviderUsageWindow, language: string): string => {
  const mins = window.window_duration_mins;
  if (typeof mins === 'number' && mins > 0) {
    if (mins >= 1440 && mins % 1440 === 0) return formatCompactUnit(mins / 1440, 'day', language);
    if (mins >= 60 && mins % 60 === 0) return formatCompactUnit(mins / 60, 'hour', language);
    return formatCompactUnit(mins, 'minute', language);
  }
  return window.label;
};

const idSuffix = (id: string): string => {
  const colon = id.indexOf(':');
  return colon >= 0 ? id.slice(colon + 1) : id;
};

/**
 * Disambiguates accounts that share the same display_name across cards, chart legend, and tables.
 */
export const accountDisplayTitle = (
  account: Pick<ProviderAccountUsage, 'id' | 'display_name' | 'account_label'>,
  allAccounts: readonly Pick<ProviderAccountUsage, 'id' | 'display_name' | 'account_label'>[]
): string => {
  const colliding = allAccounts.filter((other) => other.display_name === account.display_name);
  if (colliding.length <= 1) return account.display_name;
  const label = account.account_label?.trim();
  if (label && colliding.filter((other) => other.account_label?.trim() === label).length === 1) {
    return `${account.display_name} · ${label}`;
  }
  const suffix = idSuffix(account.id);
  const uniqueSuffix = colliding.filter((other) => idSuffix(other.id) === suffix).length === 1;
  if (suffix && uniqueSuffix) {
    return /^\d+$/.test(suffix)
      ? `${account.display_name} · #${suffix}`
      : `${account.display_name} · ${suffix}`;
  }
  return `${account.display_name} (${account.id})`;
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

export function InlineQuotaSummary({
  account,
  id,
}: {
  account: ProviderAccountUsage;
  id?: string;
}) {
  const { t, i18n } = useTranslation();
  const language = toSupportedLanguageCode(i18n?.resolvedLanguage ?? i18n?.language);
  if (account.windows.length === 0) return null;

  const shown = account.windows.slice(0, 2);
  const tightestRemaining = Math.min(...shown.map((w) => clampPercent(w.remaining_percent)));
  const barTone = quotaTone(tightestRemaining);
  const barColor =
    barTone === 'critical'
      ? color.Critical.Main
      : barTone === 'warning'
      ? color.Warning.Main
      : providerAccentColor(account.provider);
  const accessibleLabel = shown
    .map((window) =>
      t('mindroomUi.usage.quotaAria', {
        label: window.label,
        percent: Math.round(clampPercent(window.remaining_percent)),
      })
    )
    .join(', ');

  const meterBar = (
    <span className={css.InlineBarTrack} data-inline-quota-bar="" aria-hidden="true">
      <span
        className={css.InlineBarFill}
        style={{ inlineSize: `${tightestRemaining}%`, backgroundColor: barColor }}
      />
    </span>
  );

  if (shown.length === 1) {
    const [single] = shown;
    if (!single) return null;
    const remaining = clampPercent(single.remaining_percent);
    const rounded = Math.round(remaining);
    return (
      <span
        id={id}
        role="img"
        aria-label={accessibleLabel}
        className={css.InlineRoot}
        data-inline-quota={account.id}
      >
        {meterBar}
        <span className={css.InlineItem} data-tone={quotaTone(remaining)} aria-hidden="true">
          {t('mindroomUi.usage.percentLeft', { percent: rounded })}
        </span>
      </span>
    );
  }

  return (
    <span
      id={id}
      role="img"
      aria-label={accessibleLabel}
      className={css.InlineRoot}
      data-inline-quota={account.id}
    >
      {meterBar}
      {shown.map((window, index) => {
        const remaining = clampPercent(window.remaining_percent);
        return (
          <Fragment key={window.id}>
            {index > 0 && (
              <span className={css.InlineDot} aria-hidden="true">
                ·
              </span>
            )}
            <span className={css.InlineItem} data-tone={quotaTone(remaining)} aria-hidden="true">
              {shortWindowTag(window, language)} {formatWholePercent(remaining, language)}
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}
