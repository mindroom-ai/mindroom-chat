import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Icon, Icons, Text, as } from 'folds';
import { Chip, Header, IconButton } from '../glass/GlassPrimitives';
import { PageScroll } from '../page';
import { copyToClipboard } from '../../utils/dom';
import * as css from './TextViewer.css';

/** How long the copy chip shows its check mark. */
const COPIED_FEEDBACK_MS = 2000;












  ({ text, name, langName, requestClose, className, ...props }, ref) => {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);

    // The check mark clears itself a moment after a successful copy.
    useEffect(() => {
      if (!copied) return undefined;
      const reset = setTimeout(setCopied, COPIED_FEEDBACK_MS, false);
      return () => clearTimeout(reset);
    }, [copied]);

    const copyAll = () => {
      copyToClipboard(text).then(setCopied, () => undefined);
    };
    const rootClassName = classNames(css.TextViewer, className);

    return (
      <Box direction="Column" className={rootClassName} {...props} ref={ref}>
        <Header size="400" className={css.TextViewerHeader}>
          <Box grow="Yes" style={{ minWidth: 0 }}>
            <Text title={name} truncate size="H4">
              {name}
            </Text>
          </Box>
          <Chip
            before={copied ? <Icon src={Icons.Check} size="50" /> : undefined}
            onClick={copyAll}
            variant={copied ? 'Success' : 'Primary'}
            radii="300"
            style={{ flexShrink: 0 }}
          >
            <Text size="B300">{t('sharedUi.textViewer.copyAll')}</Text>
          </Chip>
          <IconButton
            aria-label={t('sharedUi.textViewer.close')}
            onClick={requestClose}
            radii="300"
            size="300"
          >
            <Icon src={Icons.Cross} size="50" />
          </IconButton>
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
