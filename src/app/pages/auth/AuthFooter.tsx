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

/** One support or policy page, opened in a new tab. */
function PolicyLink({ label, url }: PoweredByLink) {
  return (
    <Text size="T300">
      <a href={url} target="_blank" rel="noreferrer">
        {label}
      </a>
    </Text>
  );
}

/** Credits and policy links under the sign-in card. */
export function AuthFooter() {
  const { t, i18n } = useTranslation();
  const auth = (useClientConfig().auth ?? {}) as AuthFooterConfig;
  const credited = auth.poweredBy ?? MINDROOM_AUTH_BRANDING.poweredBy;
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  // Support, privacy and terms, in that order; a page without a configured URL is left out.
  const policyPages: PoweredByLink[] = [];
  const addPolicyPage = (label: string, url: string | undefined) => {
    if (url) policyPages.push({ label, url });
  };
  addPolicyPage(t('sharedUi.authFooter.support'), auth.supportUrl);
  addPolicyPage(t('sharedUi.authFooter.privacy'), auth.privacyUrl);
  addPolicyPage(t('sharedUi.authFooter.terms'), auth.termsUrl);

  const creditLine =
    credited.length === 0 ? null : (
      <Text size="T300">
        <Trans
          i18nKey="sharedUi.authFooter.poweredBy"
          components={{ links: <PoweredByLinks links={credited} language={language} /> }}
        />
      </Text>
    );

  return (
    <Box className={css.AuthFooter} justifyContent="Center" gap="400" wrap="Wrap">
      {creditLine}
      {policyPages.map((page) => (
        <PolicyLink key={page.url} label={page.label} url={page.url} />
      ))}
    </Box>
  );
}
