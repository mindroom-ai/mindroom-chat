import React, { ReactNode } from 'react';
import { Box, Icon, IconButton, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { Page, PageContent, PageHeader, PageScroll } from '../../components/page';

type SettingsPageFrameProps = {
  title: string;
  requestClose: () => void;
  children: ReactNode;
};

/** What the settings dialog hands each of its pages. */
export type SettingsPageProps = Pick<SettingsPageFrameProps, 'requestClose'>;

type FrameHeaderProps = Pick<SettingsPageFrameProps, 'title' | 'requestClose'>;

// settings.png: the close button sits 24 px from the dialog's right edge and the cards end 28 px
// from it. Inline and in plain units, because the shared page header and content set their own
// padding and the unit tests of the pages load this frame with folds and styles mocked.
const HEADER_INSET = { paddingRight: '1.5rem' };
const CONTENT_INSET = { paddingRight: '1.75rem' };

function FrameHeader({ title, requestClose }: FrameHeaderProps) {
  const { t } = useTranslation();
  const closeLabel = t('featureUi.settings.emojisStickers.globalPacks.close');

  return (
    <PageHeader outlined={false} style={HEADER_INSET}>
      <Box grow="Yes" alignItems="Center">
        <Text size="H3" truncate>
          {title}
        </Text>
      </Box>
      <IconButton variant="Surface" onClick={requestClose} aria-label={closeLabel}>
        <Icon src={Icons.Cross} />
      </IconButton>
    </PageHeader>
  );
}

/** Header with the page title and a close button over the scrolling settings content. */
export function SettingsPageFrame({ title, requestClose, children }: SettingsPageFrameProps) {
  return (
    <Page>
      <PageScroll header={<FrameHeader title={title} requestClose={requestClose} />}>
        <PageContent style={CONTENT_INSET}>
          <Box direction="Column" gap="700">
            {children}
          </Box>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
