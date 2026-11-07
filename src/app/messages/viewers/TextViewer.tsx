import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Icon, Icons, Text, as } from 'folds';
import { Chip, Header, IconButton } from '../../ui/glass/GlassPrimitives';
import { PageScroll } from '../../ui/page/PageScroll';
import { copyToClipboard } from '../../lib/dom';
import { revealDirectionControls } from '../../ui/directional';
import * as css from './TextViewer.css';

/** How long the copy chip shows its check mark. */
const COPIED_FEEDBACK_MS = 2000;

/** The title (file name), the content, and its language (a `language-<langName>` class on the `pre`). */
type TextSource = { name: string; langName: string; text: string };

type TextViewerProps = TextSource & { requestClose: () => void };

/**
 * Full-height read-only view of a text file or event source, with copy and close actions. The name
 * and the text show their bidirectional controls as code points (`<U+202E>`), so both read in the
 * order they hold; Copy All copies the text as it is.
 */
export const TextViewer = as<'div', TextViewerProps>(
  ({ className, langName, name, requestClose, text, ...props }, ref) => {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);
    const shownName = revealDirectionControls(name);

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
            <Text title={shownName} truncate size="H4">
              {shownName}
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
            <code>{revealDirectionControls(text)}</code>
          </pre>
        </PageScroll>
      </Box>
    );
  }
);
