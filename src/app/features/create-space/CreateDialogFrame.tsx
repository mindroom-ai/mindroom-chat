import React, { ReactNode } from 'react';
import { Box, Icon, IconButton, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { Modal500 } from '../../components/Modal500';
import { Page, PageContent, PageHeader, PageScroll } from '../../components/page';

type CreateDialogFrameProps = {
  title: string;
  requestClose: () => void;
  children: ReactNode;
  /** Stays below the scrolling content, such as the bar that applies a selection. */
  footer?: ReactNode;
};

// The form keeps the same inset from the close button side as from the title side.
const FORM_INSET = { paddingInline: '1.5rem', paddingBottom: '1.5rem' };

/**
 * The dialog that creation forms (a room, a space) and pickers open in: their title and a close
 * button stay on top while the content scrolls beneath them.
 */
export function CreateDialogFrame({
  title,
  requestClose,
  children,
  footer,
}: CreateDialogFrameProps) {
  const { t } = useTranslation();
  const heading = (
    <PageHeader outlined={false}>
      <Box grow="Yes" alignItems="Center" style={{ minWidth: 0 }}>
        <Text as="h2" size="H4" truncate>
          {title}
        </Text>
      </Box>
      <IconButton
        variant="Surface"
        onClick={requestClose}
        aria-label={t('featureUi.settings.emojisStickers.globalPacks.close')}
      >
        <Icon src={Icons.Cross} />
      </IconButton>
    </PageHeader>
  );

  return (
    <Modal500 requestClose={requestClose} fillPhoneScreen>
      {/* Modal500 is the dialog, named by the title's heading. */}
      <Page>
        <PageScroll header={heading}>
          <PageContent style={FORM_INSET}>{children}</PageContent>
        </PageScroll>
        {footer}
      </Page>
    </Modal500>
  );
}
