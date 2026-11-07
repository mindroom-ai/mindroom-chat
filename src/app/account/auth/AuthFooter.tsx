import { Fragment, ReactNode } from 'react';
import { Box, Text } from 'folds';
import { Trans, useTranslation } from 'react-i18next';
import { useDeploymentBranding } from '../../ui/branding/deploymentBranding';
import { ParticleTextBackdrop } from '../../ui/particle-background/ParticleTextBackdrop.css';
import * as css from './styles.css';

type PoweredByLink = { readonly label: string; readonly url: string };

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
    <Text size="T300" className={ParticleTextBackdrop}>
      <a href={url} target="_blank" rel="noreferrer">
        {label}
      </a>
    </Text>
  );
}

/**
 * Under the sign-in card: the deployment's footer text, the credits, then support, privacy and
 * terms and the deployment's own links. `useDeploymentBranding` has checked every value.
 */
export function AuthFooter() {
  const { t, i18n } = useTranslation();
  const branding = useDeploymentBranding();
  const credited = branding.poweredBy;
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  // Support, privacy and terms, in that order; a page without a configured URL is left out.
  const policyPages: PoweredByLink[] = [];
  const addPolicyPage = (label: string, url: string | undefined) => {
    if (url) policyPages.push({ label, url });
  };
  addPolicyPage(t('sharedUi.authFooter.support'), branding.supportUrl);
  addPolicyPage(t('sharedUi.authFooter.privacy'), branding.privacyUrl);
  addPolicyPage(t('sharedUi.authFooter.terms'), branding.termsUrl);
  const links = [...policyPages, ...branding.footerLinks];

  const creditLine =
    credited.length === 0 ? null : (
      <Text size="T300" className={ParticleTextBackdrop}>
        <Trans
          i18nKey="sharedUi.authFooter.poweredBy"
          components={{ links: <PoweredByLinks links={credited} language={language} /> }}
        />
      </Text>
    );

  return (
    <Box as="footer" className={css.AuthFooter} justifyContent="Center" gap="400" wrap="Wrap">
      {branding.footerText !== undefined && (
        // Shown as written, in its own direction, never as markup; its links open in a new tab.
        <Text size="T300" align="Center" dir="auto" className={ParticleTextBackdrop}>
          {branding.footerText.map((part, index) =>
            typeof part === 'string' ? (
              // The parts never change order, so their places are their keys.
              // eslint-disable-next-line react/no-array-index-key
              <Fragment key={index}>{part}</Fragment>
            ) : (
              // eslint-disable-next-line react/no-array-index-key
              <a key={index} href={part.url} target="_blank" rel="noreferrer">
                {part.label}
              </a>
            )
          )}
        </Text>
      )}
      {creditLine}
      {links.map((page) => (
        <PolicyLink key={`${page.label} ${page.url}`} label={page.label} url={page.url} />
      ))}
    </Box>
  );
}
