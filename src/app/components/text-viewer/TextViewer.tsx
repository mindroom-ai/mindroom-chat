import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Icon, Icons, Text, as } from 'folds';
import { Chip, Header, IconButton } from '../glass/GlassPrimitives';
import { PageScroll } from '../page';
import { copyToClipboard } from '../../utils/dom';
import * as css from './TextViewer.css';















    const [copied, setCopied] = useState(false);

    useEffect(() => {
      if (!copied) return undefined;
      const timeout = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
      return () => clearTimeout(timeout);
    }, [copied]);

    const handleCopy = async () => {



















              radii="300"
              onClick={handleCopy}
              before={copied ? <Icon size="50" src={Icons.Check} /> : undefined}
            >
              <Text size="B300">
                {copied ? t('sharedUi.textViewer.copied') : t('sharedUi.textViewer.copyAll')}
              </Text>
            </Chip>
            <IconButton
              size="300"
              radii="300"
              onClick={requestClose}
              aria-label={t('sharedUi.textViewer.close')}
            >
              <Icon size="50" src={Icons.Cross} />
            </IconButton>
          </Box>
        </Header>
        <PageScroll className={css.TextViewerContent}>
          <pre className={classNames(css.TextViewerPre, `language-${langName}`)}>
            <code>{text}</code>
          </pre>
        </PageScroll>
      </Box>
    );
  }
);
