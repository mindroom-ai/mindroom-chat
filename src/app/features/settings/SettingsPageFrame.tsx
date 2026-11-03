import React, { ReactNode } from 'react';
import { Box, Icon, IconButton, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { Page, PageContent, PageHeader, PageScroll } from '../../components/page';

type SettingsPageFrameProps = {
  title: string;
  requestClose: () => void;
  children: ReactNode;
};

/** Header with the page title and a close button over the scrolling settings content. */
export function SettingsPageFrame({ title, requestClose, children }: SettingsPageFrameProps) {













              variant="Surface"
              aria-label={t('featureUi.settings.close')}
            >
              <Icon src={Icons.Cross} />
            </IconButton>
          </PageHeader>
        }
      >
        <PageContent>
          <Box direction="Column" gap="700">
            {children}
          </Box>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
