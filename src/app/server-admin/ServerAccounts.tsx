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
  // Deactivated accounts outnumber the others on an old server; they show when asked for.
  const [showDeactivated, setShowDeactivated] = useState(false);
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

  // A server that invites people can make external accounts, before it has any; a server that
  // neither invites nor marks one has nothing to tell apart.
  const marksExternal = hasInvites || (accounts?.some((account) => account.external) ?? false);
  const filters = marksExternal ? ACCOUNT_FILTERS : [];
  const type = marksExternal ? filter : 'all';
  const matches = filterAccounts(accounts ?? [], { type, query, deactivated: showDeactivated });
  // The deactivated accounts of this kind and search, whether they show or not.
  const deactivated = filterAccounts(accounts ?? [], { type, query, deactivated: true }).filter(
    (account) => account.deactivated
  ).length;
  const hidden = showDeactivated ? 0 : deactivated;

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
          {accounts && accounts.some((account) => account.deactivated) && (
            <Chip
              type="button"
              variant={showDeactivated ? 'Primary' : 'SurfaceVariant'}
              radii="Pill"
              aria-pressed={showDeactivated}
              // A switch among the kinds of account, which are one choice: a check says it is on.
              before={showDeactivated && <Icon size="50" src={Icons.Check} aria-hidden />}
              data-show-deactivated=""
              onClick={() => {
                setShowDeactivated(!showDeactivated);
                setLimit(STEP);
              }}
            >
              <Text size="T200">{t('serverAccounts.showDeactivated', { count: deactivated })}</Text>
            </Chip>
          )}
          {accounts && (
            <Text size="T200" priority="300" aria-live="polite">
              {t('serverAccounts.count', { shown: matches.length, total: accounts.length })}
              {hidden > 0 && ` · ${t('serverAccounts.hiddenDeactivated', { count: hidden })}`}
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
              <SettingTile
                title={t('serverAccounts.noMatches')}
                description={hidden > 0 && t('serverAccounts.hiddenDeactivated', { count: hidden })}
                after={
                  hidden > 0 && (
                    <Button
                      size="300"
                      variant="Secondary"
                      fill="Soft"
                      radii="300"
                      data-show-hidden=""
                      onClick={() => setShowDeactivated(true)}
                    >
                      <Text size="B300">
                        {t('serverAccounts.showDeactivated', { count: hidden })}
                      </Text>
                    </Button>
                  )
                }
              />
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
