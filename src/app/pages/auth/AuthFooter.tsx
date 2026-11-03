import React, { Fragment, ReactNode } from 'react';
import { Box, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useClientConfig } from '../../hooks/useClientConfig';
import * as css from './styles.css';

type PoweredByLink = { label: string; url: string };

type AuthFooterConfig = {
  poweredBy?: PoweredByLink[];
  supportUrl?: string;
  privacyUrl?: string;
  termsUrl?: string;
};

const DEFAULT_POWERED_BY: PoweredByLink[] = [
  { label: 'MindRoom Chat', url: 'https://github.com/mindroom-ai/mindroom-chat' },
  { label: 'Matrix', url: 'https://matrix.org' },
  { label: 'the upstream client', url: 'https://upstream.invalid/source' },
];

const LINKS_PLACEHOLDER = '\u0000';

/** Joins the links the way the app language writes a list ("A, B, and C"). */
const joinLinks = (links: PoweredByLink[], language: string): ReactNode[] => {
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

/** Credits and policy links under the sign-in card. */
export function AuthFooter() {
  const { t, i18n } = useTranslation();
  const auth = (useClientConfig().auth ?? {}) as AuthFooterConfig;
  const poweredBy = auth.poweredBy ?? DEFAULT_POWERED_BY;
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  const [before, after = ''] = t('featureUi.auth.footer.poweredBy', {
    links: LINKS_PLACEHOLDER,
  }).split(LINKS_PLACEHOLDER);

  const policyLinks = [
    auth.supportUrl && { label: t('featureUi.auth.footer.support'), url: auth.supportUrl },
    auth.privacyUrl && { label: t('featureUi.auth.footer.privacy'), url: auth.privacyUrl },
    auth.termsUrl && { label: t('featureUi.auth.footer.terms'), url: auth.termsUrl },
  ].filter((link): link is PoweredByLink => !!link);

  return (
    <Box className={css.AuthFooter} justifyContent="Center" gap="400" wrap="Wrap">
      {poweredBy.length > 0 && (
        <Text size="T300">
          {before}
          {joinLinks(poweredBy, language)}
          {after}
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
