import React from 'react';
import { Box, Button, Icon, Icons, Text, config, toRem } from 'folds';
import { Page, PageHero, PageHeroSection } from '../../components/page';
import { useClientConfig } from '../../hooks/useClientConfig';
import {
  MINDROOM_APP_NAME,
  MINDROOM_DEFAULT_POWERED_BY,
  MINDROOM_DOCS_URL,
  MINDROOM_LOGO_ALT,
  MINDROOM_LOGO_SRC,
  MINDROOM_SOURCE_URL,
} from '../../mindroom/branding/branding';

const safeIcon = (icon?: (filled?: boolean) => JSX.Element) => icon ?? Icons.Info;

export function WelcomePage() {
  const { welcome } = useClientConfig();
  const title = welcome?.title ?? `Welcome to ${MINDROOM_APP_NAME}`;
  const subtitle = welcome?.subtitle ?? 'Yet another matrix client.';
  const sourceLabel = welcome?.sourceLabel ?? 'Source Code';
  const sourceUrl = welcome?.sourceUrl ?? MINDROOM_SOURCE_URL;
  const docsLabel = welcome?.docsLabel ?? 'Docs';
  const docsUrl = welcome?.docsUrl ?? MINDROOM_DOCS_URL;
  const poweredBy = welcome?.poweredBy ?? MINDROOM_DEFAULT_POWERED_BY;

  return (
    <Page>
      <Box
        grow="Yes"
        style={{ padding: config.space.S400, paddingBottom: config.space.S700 }}
        alignItems="Center"
        justifyContent="Center"
      >
        <PageHeroSection>
          <PageHero
            icon={<img width="70" height="70" src={MINDROOM_LOGO_SRC} alt={MINDROOM_LOGO_ALT} />}
            title={title}
            subTitle={<span>{subtitle}</span>}
          >
            <Box justifyContent="Center">
              <Box grow="Yes" style={{ maxWidth: toRem(360) }} direction="Column" gap="300">
                {sourceUrl && (
                  <Button
                    as="a"
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    before={<Icon size="200" src={safeIcon(Icons.Code)} />}
                  >
                    <Text as="span" size="B400" truncate>
                      {sourceLabel}
                    </Text>
                  </Button>
                )}
                {docsUrl && (
                  <Button
                    as="a"
                    href={docsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    fill="Soft"
                    before={<Icon size="200" src={safeIcon(Icons.Info)} />}
                  >
                    <Text as="span" size="B400" truncate>
                      {docsLabel}
                    </Text>
                  </Button>
                )}
                {poweredBy.length > 0 && (
                  <Text size="T300" align="Center">
                    Powered by{' '}
                    {poweredBy.map((item, index) => (
                      <React.Fragment key={item.url}>
                        <a href={item.url} target="_blank" rel="noreferrer noopener">
                          {item.label}
                        </a>
                        {index < poweredBy.length - 1 && ' \u2022 '}
                      </React.Fragment>
                    ))}
                  </Text>
                )}
              </Box>
            </Box>
          </PageHero>
        </PageHeroSection>
      </Box>
    </Page>
  );
}
