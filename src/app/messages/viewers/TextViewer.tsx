import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Icon, Icons, Text, as } from 'folds';
import { DialogCloseButton } from '../../ui/DialogChrome';
import { Chip, Header } from '../../ui/glass/GlassPrimitives';
import { PageScroll } from '../../ui/page/PageScroll';
import { copyToClipboard } from '../../lib/dom';
import { revealDirectionControls } from '../../ui/directional';
import { PrismCode } from '../../rich-text/code/ReactPrism';
import * as css from './TextViewer.css';

/** How long the copy chip shows its check mark. */
const COPIED_FEEDBACK_MS = 2000;

/** Upper length for Prism tokenization so very large files stay responsive. */
export const MAX_TEXT_HIGHLIGHT_LENGTH = 200_000;

const PLAIN_LANGUAGES = new Set(['', 'text', 'plaintext']);

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
    const revealedText = useMemo(() => revealDirectionControls(text), [text]);
    const safeLangName = typeof langName === 'string' ? langName.trim() : '';
    const shouldHighlight =
      !PLAIN_LANGUAGES.has(safeLangName.toLowerCase()) &&
      revealedText.length <= MAX_TEXT_HIGHLIGHT_LENGTH;

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
        <Header size="400" appearance="inherit" className={css.TextViewerHeader}>
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
          <DialogCloseButton label={t('sharedUi.textViewer.close')} onClick={requestClose} />
        </Header>
        <PageScroll className={css.TextViewerContent}>
          <pre
            className={classNames(css.TextViewerPre, safeLangName && `language-${safeLangName}`)}
          >
            {shouldHighlight ? (
              <PrismCode code={revealedText} language={safeLangName} />
            ) : (
              <code>{revealedText}</code>
            )}
          </pre>
        </PageScroll>
      </Box>
    );
  }
);
