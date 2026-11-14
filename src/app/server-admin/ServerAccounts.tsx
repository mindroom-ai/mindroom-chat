import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, Icon, Icons, Input, Spinner, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useAlive } from '../lib/hooks/useAlive';
import { describeError } from '../lib/describeError';
import { timeDayMonthYear } from '../lib/time';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { SettingTile } from '../ui/SettingTile';
import { SettingsCard } from '../ui/settings/SettingsCard';
import { SettingsPageFrame, type SettingsPageProps } from '../ui/settings/SettingsPageFrame';
import { AccountBadges } from './AccountBadges';
import { RegistrationInvites } from './RegistrationInvites';
import * as css from './ServerAccounts.css';
import { ServerAccountDetail } from './ServerAccountDetail';
import {
  ACCOUNT_FILTERS,
  filterAccounts,
  listServerAccounts,
  type AccountFilter,
  type ServerAccount,
} from './accounts';
import { supportsRegistrationInvites } from './invites';

/** How many more accounts each "Show more" adds. */
const STEP = 100;

type AccountRowProps = {
  account: ServerAccount;
  onOpen: () => void;
};

function AccountRow({ account, onOpen }: AccountRowProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const { userId, displayName, lastSeenTs } = account;
  const lastSeen =
    lastSeenTs !== undefined &&
    t('serverAccounts.lastSeen', { date: timeDayMonthYear(lastSeenTs, language) });

  return (
    <button type="button" className={css.AccountRow} data-account={userId} onClick={onOpen}>
      <SettingTile
        title={displayName ?? userId}
        description={[displayName !== undefined && userId, lastSeen].filter(Boolean).join(' · ')}
        after={
          <Box alignItems="Center" gap="200">
            <AccountBadges account={account} />
            <Icon size="100" src={Icons.ChevronRight} data-directional aria-hidden />
          </Box>
        }
      />
    </button>
  );
}

/**
 * Settings → Server accounts, for the homeserver's administrators: every local account with a
 * search and filters, and each account's state, rooms and actions behind its row. On a
 * homeserver with registration invites, those come first.
 */
export function ServerAccounts({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const alive = useAlive();
  const [accounts, setAccounts] = useState<ServerAccount[]>();
  const [error, setError] = useState<unknown>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AccountFilter>('all');
  const [limit, setLimit] = useState(STEP);
  const [openId, setOpenId] = useState<string>();

  const latestLoad = useRef(0);
  const load = useCallback(() => {
    latestLoad.current += 1;
    const request = latestLoad.current;
    // Only the latest load counts: an earlier one may answer last, with older accounts.
    const current = () => alive() && request === latestLoad.current;
    setError(undefined);
    listServerAccounts(mx).then(
      (loaded) => current() && setAccounts(loaded),
      (reason: unknown) => current() && setError(reason ?? new Error('unknown'))
    );
  }, [mx, alive]);
  useEffect(load, [load]);

  // A homeserver without registration invites, or one that cannot be asked, shows none.
  const [hasInvites, setHasInvites] = useState(false);
  useEffect(() => {
    void supportsRegistrationInvites(mx).then((supported) => alive() && setHasInvites(supported));
  }, [mx, alive]);

  const open = accounts?.find((account) => account.userId === openId);
  if (open) {
    return (
      <SettingsPageFrame title={t('serverAccounts.title')} requestClose={requestClose}>
        <ServerAccountDetail account={open} onBack={() => setOpenId(undefined)} onChanged={load} />
      </SettingsPageFrame>
    );
  }

  // Without an external account the server does not mark them, or has none: nothing to tell apart.
  const marksExternal = accounts?.some((account) => account.external) ?? false;
  const filters = ACCOUNT_FILTERS.filter(
    (entry) => marksExternal || (entry !== 'internal' && entry !== 'external')
  );
  const matches = filterAccounts(accounts ?? [], filter, query);

  return (
    <SettingsPageFrame title={t('serverAccounts.title')} requestClose={requestClose}>
      <Box direction="Column" gap="300">
        <Text size="T300" priority="300">
          {t('serverAccounts.description')}
        </Text>
        {hasInvites && <RegistrationInvites />}
        {hasInvites && (
          <Text size="L400" data-settings-heading="">
            {t('serverAccounts.accounts')}
          </Text>
        )}
        <Input
          aria-label={t('serverAccounts.search')}
          placeholder={t('serverAccounts.search')}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setLimit(STEP);
          }}
          variant="Background"
          size="300"
          radii="300"
          autoComplete="off"
          spellCheck={false}
        />
        <Box gap="200" wrap="Wrap" alignItems="Center">
          {filters.map((entry) => (
            <Chip
              key={entry}
              type="button"
              variant={entry === filter ? 'Primary' : 'SurfaceVariant'}
              radii="Pill"
              aria-pressed={entry === filter}
              onClick={() => {
                setFilter(entry);
                setLimit(STEP);
              }}
            >
              <Text size="T200">{t(`serverAccounts.filters.${entry}`)}</Text>
            </Chip>
          ))}
          {accounts && (
            <Text size="T200" priority="300" aria-live="polite">
              {t('serverAccounts.count', { shown: matches.length, total: accounts.length })}
            </Text>
          )}
        </Box>
        {error !== undefined && (
          <Box alignItems="Center" gap="300">
            <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
              {t('serverAccounts.loadFailed')} {describeError(t, error)}
            </Text>
            <Button size="300" variant="Secondary" fill="Soft" radii="300" onClick={load}>
              <Text size="B300">{t('sharedUi.roomCard.retry')}</Text>
            </Button>
          </Box>
        )}
        {!accounts && error === undefined && <Spinner size="200" />}
        {accounts && (
          <SettingsCard>
            {matches.length === 0 ? (
              <SettingTile title={t('serverAccounts.noMatches')} />
            ) : (
              matches
                .slice(0, limit)
                .map((account) => (
                  <AccountRow
                    key={account.userId}
                    account={account}
                    onOpen={() => setOpenId(account.userId)}
                  />
                ))
            )}
          </SettingsCard>
        )}
        {matches.length > limit && (
          <Box justifyContent="Center">
            <Button
              size="300"
              variant="Secondary"
              fill="Soft"
              radii="300"
              onClick={() => setLimit(limit + STEP)}
            >
              <Text size="B300">{t('threadsPage.showMore')}</Text>
            </Button>
          </Box>
        )}
      </Box>
    </SettingsPageFrame>
  );
}
