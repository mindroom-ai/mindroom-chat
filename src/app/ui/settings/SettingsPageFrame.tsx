import { ReactNode, RefObject, createContext, useContext } from 'react';
import { Box, Icon, IconButton, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { Page, PageContent, PageHeader } from '../page/Page';
import { PageScroll } from '../page/PageScroll';
import { PhoneBackButton } from '../page/PhoneBackButton';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { TitleBarLine } from './titleBar.css';

type DialogTitle = {
  label: string;
  /** Stays the same from page to page, so the dialog's label keeps pointing at the title. */
  id: string;
};

/**
 * The dialog a settings page belongs to ("Settings"): its title bar names it before the page,
 * and the dialog takes its accessible name from there. Without one the bar names the page alone.
 */
export const SettingsBreadcrumbRoot = createContext<DialogTitle | undefined>(undefined);

type SettingsPageFrameProps = {
  title: string;
  requestClose: () => void;
  children: ReactNode;
  /** The scrolling viewport, for pages with a virtual list. */
  scrollRef?: RefObject<HTMLDivElement>;
};

/** What the settings dialog hands each of its pages. */
export type SettingsPageProps = Pick<SettingsPageFrameProps, 'requestClose'>;

type FrameHeaderProps = Pick<SettingsPageFrameProps, 'title' | 'requestClose'>;

// Inline and in plain units, because the shared page header and content set their own padding
// and the unit tests of the pages load this frame with folds and styles mocked. The close button
// sits 24 px from the dialog's end edge (the right, or the left in a right-to-left language), in
// a 48 px title bar; the page's sections form a centered column of at most 680 px.
const HEADER_STYLE = { height: '3rem', paddingInlineEnd: '1.5rem' };
const CONTENT_COLUMN = {
  width: '100%',
  maxWidth: '42.5rem',
  marginInline: 'auto',
  paddingTop: '1.75rem',
  paddingInline: '1.25rem',
};
const TRAIL_STYLE = { minWidth: 0 };
const ROOT_STYLE = { flexShrink: 0 };
const PAGE_NAME_STYLE = { fontWeight: 500 };

/**
 * "Settings / Appearance": the dialog's title, quiet, then the page; pages with a title bar of
 * their own (an emoji pack) show it too.
 */
export function SettingsBreadcrumb({ title }: { title: string }) {
  const root = useContext(SettingsBreadcrumbRoot);
  return (
    <Box grow="Yes" alignItems="Center" gap="200" style={TRAIL_STYLE}>
      {root && (
        <>
          <Text
            as="h2"
            id={root.id}
            size="T300"
            priority="300"
            data-dialog-title=""
            style={ROOT_STYLE}
          >
            {root.label}
          </Text>
          <Text as="span" size="T300" priority="300" aria-hidden="true">
            /
          </Text>
        </>
      )}
      <Text as="span" size="T300" truncate style={PAGE_NAME_STYLE}>
        {title}
      </Text>
    </Box>
  );
}

/**
 * On phones a page covers the menu, so its title bar leads with the back chevron of the app's
 * other phone pages (the dialog's own close stays on the menu); wider screens show the menu
 * beside the page and close the dialog from the page.
 */
function FrameHeader({ title, requestClose }: FrameHeaderProps) {
  const { t } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;

  if (phone) {
    return (
      <PageHeader balance className={TitleBarLine}>
        <PhoneBackButton onBack={requestClose} />
        <SettingsBreadcrumb title={title} />
      </PageHeader>
    );
  }

  return (
    <PageHeader className={TitleBarLine} style={HEADER_STYLE}>
      <SettingsBreadcrumb title={title} />
      <IconButton
        size="300"
        radii="300"
        variant="Surface"
        onClick={requestClose}
        aria-label={t('featureUi.settings.emojisStickers.globalPacks.close')}
      >
        <Icon size="100" src={Icons.Cross} />
      </IconButton>
    </PageHeader>
  );
}

/** A title bar with the page's place in the dialog over the scrolling settings content. */
export function SettingsPageFrame({
  title,
  requestClose,
  children,
  scrollRef,
}: SettingsPageFrameProps) {
  return (
    <Page>
      <PageScroll
        scrollRef={scrollRef}
        header={<FrameHeader title={title} requestClose={requestClose} />}
      >
        <PageContent style={CONTENT_COLUMN} data-settings-page="">
          <Box direction="Column" gap="700">
            {children}
          </Box>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
