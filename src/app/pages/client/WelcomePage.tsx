import React from 'react';
import { Box, Button, Icon, Icons, Text, config, toRem } from 'folds';
import { Page, PageHero, PageHeroSection } from '../../components/page';
import { useClientConfig } from '../../hooks/useClientConfig';
import MindRoomSVG from '../../../../public/res/svg/mindroom.svg';

const safeIcon = (icon?: (filled?: boolean) => JSX.Element) => icon ?? Icons.Info;

export function WelcomePage() {
  const { welcome } = useClientConfig();
  const title = welcome?.title ?? 'Welcome to MindRoom';
  const subtitle = welcome?.subtitle ?? 'Yet another matrix client.';
  const sourceLabel = welcome?.sourceLabel ?? 'Source Code';
  const sourceUrl = welcome?.sourceUrl ?? 'https://github.com/mindroom-ai/mindroom';
  const docsLabel = welcome?.docsLabel ?? 'Docs';
  const docsUrl = welcome?.docsUrl ?? 'https://docs.mindroom.chat/';
  const poweredBy =
    welcome?.poweredBy ?? [
      { label: 'MindRoom', url: 'https://github.com/mindroom-ai/mindroom' },
      { label: 'Matrix', url: 'https://matrix.org' },
      { label: 'Cinny', url: 'https://github.com/cinnyapp/cinny' },
      { label: 'MindRoom Cinny Fork', url: 'https://github.com/mindroom-ai/mindroom-cinny' },
    ];

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
            icon={<img width="70" height="70" src={MindRoomSVG} alt="MindRoom Logo" />}
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
