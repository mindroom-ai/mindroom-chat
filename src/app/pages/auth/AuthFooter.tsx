import React, { Fragment, ReactNode } from 'react';
import { Box, Text } from 'folds';
import { Trans, useTranslation } from 'react-i18next';
import { useClientConfig } from '../../hooks/useClientConfig';
import { MINDROOM_AUTH_BRANDING } from '../../mindroom/auth/authUi';
import * as css from './styles.css';

type PoweredByLink = { readonly label: string; readonly url: string };

type AuthFooterConfig = {
  poweredBy?: readonly PoweredByLink[];
  supportUrl?: string;
  privacyUrl?: string;
  termsUrl?: string;
};

/** Joins the links the way the app language writes a list ("A, B, and C"). */
const joinLinks = (links: readonly PoweredByLink[], language: string): ReactNode[] => {
  const anchors = links.map((link) => (
    <a key={link.url} href={link.url} target="_blank" rel="noreferrer" dir="auto">
      {link.label}
    </a>
  ));
  let parts: ReturnType<Intl.ListFormat['formatToParts']>;
  try {
    parts = new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).formatToParts(
      links.map((link) => link.label)
    );
  } catch {
    return anchors;
  }
  let index = 0;
  return parts.map((part, partIndex) => {
    if (part.type === 'element') {
      const anchor = anchors[index];
      index += 1;
      return anchor;
    }
    // eslint-disable-next-line react/no-array-index-key
    return <Fragment key={`literal-${partIndex}`}>{part.value}</Fragment>;
  });
};

/** The credited links; ignores the (empty) children `Trans` gives its `<links />` slot. */
function PoweredByLinks({
  links,
  language,
}: {
  links: readonly PoweredByLink[];
  language: string;
  children?: ReactNode;
}) {
  return <>{joinLinks(links, language)}</>;
}

/** Credits and policy links under the sign-in card. */
export function AuthFooter() {
  const { t, i18n } = useTranslation();
  const auth = (useClientConfig().auth ?? {}) as AuthFooterConfig;
  const poweredBy = auth.poweredBy ?? MINDROOM_AUTH_BRANDING.poweredBy;
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  const policyLinks = [
    auth.supportUrl && { label: t('sharedUi.authFooter.support'), url: auth.supportUrl },
    auth.privacyUrl && { label: t('sharedUi.authFooter.privacy'), url: auth.privacyUrl },
    auth.termsUrl && { label: t('sharedUi.authFooter.terms'), url: auth.termsUrl },
  ].filter((link): link is PoweredByLink => !!link);

  return (
    <Box className={css.AuthFooter} justifyContent="Center" gap="400" wrap="Wrap">
      {poweredBy.length > 0 && (
        <Text size="T300">
          <Trans
            i18nKey="sharedUi.authFooter.poweredBy"
            components={{ links: <PoweredByLinks links={poweredBy} language={language} /> }}
          />
        </Text>
      )}
      {policyLinks.map((link) => (
        <Text key={link.url} size="T300">
          <a href={link.url} target="_blank" rel="noreferrer">
            {link.label}
          </a>
        </Text>
      ))}
    </Box>
  );
}
