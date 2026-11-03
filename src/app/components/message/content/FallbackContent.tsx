import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Icon, IconSrc, Icons, Text, as, color, config } from 'folds';

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
        : t('sharedUi.fallbackContent.deleted')}
    </FallbackLine>
  );
}

export function MessageUnsupportedContent() {
  const { t } = useTranslation();
  return (
    <FallbackLine icon={Icons.Warning}>{t('sharedUi.fallbackContent.unsupported')}</FallbackLine>
  );
}

export function MessageFailedContent() {
  const { t } = useTranslation();
  return (
    <FallbackLine icon={Icons.Warning} critical>
      {t('sharedUi.fallbackContent.failed')}
    </FallbackLine>
  );
}

export function MessageBadEncryptedContent() {
  const { t } = useTranslation();
  return (
    <FallbackLine icon={Icons.Lock}>{t('sharedUi.fallbackContent.badEncrypted')}</FallbackLine>
  );
}

export function MessageNotDecryptedContent() {
  const { t } = useTranslation();
  return (
    <FallbackLine icon={Icons.Lock}>{t('sharedUi.fallbackContent.notDecrypted')}</FallbackLine>
  );
}

export function MessageBrokenContent() {
  const { t } = useTranslation();
  return (
    <FallbackLine icon={Icons.Warning} critical>
      {t('sharedUi.fallbackContent.broken')}
    </FallbackLine>
  );
}

export function MessageEmptyContent() {
  const { t } = useTranslation();
  return <FallbackLine>{t('sharedUi.fallbackContent.empty')}</FallbackLine>;
}

/** The "(edited)" marker after a message body. */
export function MessageEditedContent() {
  const { t } = useTranslation();
  return (
    <Text as="span" size="T200" priority="300" style={{ marginInlineStart: config.space.S100 }}>
      {t('sharedUi.fallbackContent.edited')}
    </Text>
  );
}
