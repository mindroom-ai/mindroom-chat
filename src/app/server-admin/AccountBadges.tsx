import { Badge, Box, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { ServerAccount } from './serverAccounts';

type AccountBadgesProps = {
  account: ServerAccount;
  /** Also says "Active" for an account nothing else is to say about. */
  showActive?: boolean;
};

/** An account's marks: administrator, external, and what keeps it from signing in or acting. */
export function AccountBadges({ account, showActive = false }: AccountBadgesProps) {
  const { t } = useTranslation();
  const { admin, external, deactivated, locked, suspended } = account;
  const restricted = deactivated || locked || suspended === true;
  const badges = [
    admin && (['Primary', t('sharedUi.powerLevels.admin')] as const),
    external && (['Warning', t('serverAccounts.filters.external')] as const),
    !deactivated && locked && (['Critical', t('serverAccounts.status.locked')] as const),
    !deactivated &&
      suspended === true &&
      (['Critical', t('serverAccounts.status.suspended')] as const),
    deactivated && (['Critical', t('serverAccounts.filters.deactivated')] as const),
    showActive && !restricted && (['Success', t('serverAccounts.status.active')] as const),
  ].filter((badge): badge is readonly ['Primary' | 'Warning' | 'Critical' | 'Success', string] =>
    Array.isArray(badge)
  );

  return (
    <Box gap="100" wrap="Wrap" alignItems="Center">
      {badges.map(([variant, label]) => (
        <Badge key={label} variant={variant} fill="Soft" radii="Pill" size="500">
          <Text as="span" size="L400">
            {label}
          </Text>
        </Badge>
      ))}
    </Box>
  );
}
