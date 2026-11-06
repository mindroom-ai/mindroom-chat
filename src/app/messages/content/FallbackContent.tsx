import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Icon, type IconSrc, Icons, Text, as, color, config } from 'folds';

type FallbackLineProps = {
  icon?: IconSrc;
  critical?: boolean;
  children: ReactNode;
};

/** One muted line standing in for content that cannot be shown. */
const FallbackLine = as<'div', FallbackLineProps>(
  ({ icon, critical, children, style, ...props }, ref) => (
    <Box
      as="span"
      display="InlineFlex"
      alignItems="Center"
      gap="100"
      {...props}
      style={{
        color: critical ? color.Critical.Main : undefined,
        opacity: critical ? undefined : config.opacity.P300,
        maxWidth: '100%',
        ...style,
      }}
      ref={ref}
    >
      {icon && <Icon size="50" src={icon} />}
      <Text as="span" size="T300" priority="300">
        {children}
      </Text>
    </Box>
  )
);

export function MessageDeletedContent({ reason }: { reason?: string }) {
  const { t } = useTranslation();
  return (
    <FallbackLine icon={Icons.Delete}>
      {reason
        ? t('sharedUi.fallbackContent.deletedWithReason', { reason })
        : t('sharedUi.fallbackContent.thisMessageHasBeenDeleted')}
    </FallbackLine>
  );
}

export function MessageUnsupportedContent() {
  const { t } = useTranslation();
  return (
    <FallbackLine icon={Icons.Warning}>
      {t('sharedUi.fallbackContent.unsupportedMessage')}
    </FallbackLine>
  );
}

export function MessageFailedContent() {
  const { t } = useTranslation();
  return (
    <FallbackLine icon={Icons.Warning} critical>
      {t('sharedUi.fallbackContent.failedToLoadMessage')}
    </FallbackLine>
  );
}

export function MessageBadEncryptedContent() {
  const { t } = useTranslation();
  return (
    <FallbackLine icon={Icons.Lock}>
      {t('sharedUi.fallbackContent.couldnTDecryptThisMessageTheEncryptionKeyIsnTAvailable')}
    </FallbackLine>
  );
}

export function MessageNotDecryptedContent() {
  const { t } = useTranslation();
  return (
    <FallbackLine icon={Icons.Lock}>
      {t('sharedUi.fallbackContent.thisMessageIsNotDecryptedYet')}
    </FallbackLine>
  );
}

export function MessageBrokenContent() {
  const { t } = useTranslation();
  return (
    <FallbackLine icon={Icons.Warning} critical>
      {t('sharedUi.fallbackContent.brokenMessage')}
    </FallbackLine>
  );
}

export function MessageEmptyContent() {
  const { t } = useTranslation();
  return <FallbackLine>{t('sharedUi.fallbackContent.emptyMessage')}</FallbackLine>;
}

/** The " (edited)" marker after a message body; the string carries its leading space. */
export function MessageEditedContent() {
  const { t } = useTranslation();
  return (
    <Text as="span" size="T200" priority="300">
      {t('sharedUi.fallbackContent.edited')}
    </Text>
  );
}

/** Under a message whose newest edit could not be decrypted: it shows an earlier version. */
export function MessageEditNotDecryptedContent() {
  const { t } = useTranslation();
  return (
    <FallbackLine icon={Icons.Lock} data-edit-not-decrypted>
      {t('sharedUi.fallbackContent.newerEditNotDecrypted')}
    </FallbackLine>
  );
}
