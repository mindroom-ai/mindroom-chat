import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from 'react-error-boundary';
import { copyToClipboard } from '../../lib/dom';
import { useRevealOnOpen } from '../../ui/disclosureReveal';
import { revealDirectionControls } from '../../ui/directional';
import * as css from '../CustomHtml.css';
import {
  CheckIcon,
  CodeBlockLanguageIcon,
  CollapseIcon,
  CopyIcon,
  ExpandIcon,
  WrapTextIcon,
} from './CodeBlockIcons';
import { getCodeBlockLanguageIconToken } from './codeBlockLanguage';
import { MAX_TEXT_HIGHLIGHT_LENGTH } from './codeHighlightLimits';
import { PrismCode } from './ReactPrism';

// A code block longer than this many lines, as shown, starts collapsed to `COLLAPSED_LINES`.
const LONG_CODE_BLOCK_LINES = 16;
const COLLAPSED_LINES = 12;
// Wrapped lines are estimated from their length; message columns fit about this many characters.
const WRAPPED_LINE_CHARACTERS = 80;
const COPIED_FEEDBACK_MS = 2000;
// The code element of every block; the id repeats per block, so look it up inside its <pre>.
const CODE_BLOCK_CONTENT_ID = 'code-block-content';

const countShownLines = (code: string, wrap: boolean): number =>
  code
    .split('\n')
    .reduce(
      (lines, line) =>
        lines + (wrap ? Math.max(1, Math.ceil(line.length / WRAPPED_LINE_CHARACTERS)) : 1),
      0
    );

type CodeBlockLayout = {
  wrap: boolean;
  headerLabel: ReactNode;
  sourceActions: ReactNode;
  copyAction: ReactNode;
  sourceBody: ReactNode;
};

type CodeBlockViewProps = {
  source: string;
  language?: string;
  label?: string;
  collapsedLines?: number;
  longLinesThreshold?: number;
  embedded?: boolean;
  headerExtraActions?: ReactNode;
  /** Formatted or search-marked source, instead of syntax colors. */
  customBody?: ReactNode;
  /** Replace the frame, keeping the source controls and scroll area available. */
  renderLayout?: (layout: CodeBlockLayout) => ReactNode;
};

const DIFF_META =
  /^(?:@@|---|\+\+\+|\\|diff --(?:git|cc|combined) |index |(?:old|new|deleted file|new file) mode |(?:dis)?similarity index |(?:rename|copy) (?:from|to) |Binary files |GIT binary patch\r?$)/;

const diffTone = (line: string) => {
  if (DIFF_META.test(line)) return css.DiffMeta;
  if (line.startsWith('+')) return css.DiffAdded;
  if (line.startsWith('-')) return css.DiffRemoved;
  return undefined;
};

const renderDiffLines = (code: string) =>
  code.split('\n').map((line, index, lines) => (
    // eslint-disable-next-line react/no-array-index-key
    <span key={index} className={classNames(css.DiffLine, diffTone(line))}>
      {line}
      {index < lines.length - 1 ? '\n' : ''}
    </span>
  ));

/** A read-only code block for message fences and embedded file previews. */
export function CodeBlockView({
  source,
  language,
  label,
  collapsedLines = COLLAPSED_LINES,
  longLinesThreshold = LONG_CODE_BLOCK_LINES,
  embedded = false,
  headerExtraActions,
  customBody,
  renderLayout,
}: CodeBlockViewProps) {
  const { t } = useTranslation();
  const [wrap, setWrap] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const codeScrollRef = useRef<HTMLDivElement>(null);
  const armReveal = useRevealOnOpen(expanded, expandButtonRef, codeScrollRef);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  // The view (collapse, wrap, code length) whose last line the reader scrolled to, if any.
  const [endView, setEndView] = useState<string>();

  const labelExtension = label?.includes('.') ? label.split('.').pop() : undefined;
  const iconToken =
    (language && getCodeBlockLanguageIconToken(language)) ||
    (labelExtension && getCodeBlockLanguageIconToken(labelExtension)) ||
    undefined;
  // The block shows its direction controls as code points; Copy copies the code as it is.
  const code = useMemo(() => revealDirectionControls(source), [source]);
  const hasCustomBody = customBody !== undefined;
  const isDiffLanguage = language?.toLowerCase() === 'diff';
  const diff = !hasCustomBody && isDiffLanguage && source.length <= MAX_TEXT_HIGHLIGHT_LENGTH;
  const diffLines = useMemo(() => (diff ? renderDiffLines(code) : undefined), [code, diff]);

  const shownLines = useMemo(() => countShownLines(code, wrap), [code, wrap]);
  const long = shownLines > longLinesThreshold;
  const collapsed = long && !expanded;
  // Collapsed, the code overflows its box; unwrapped, its lines may overflow sideways. Neither
  // is measured: mounting a block reads no layout.
  const scrollable = collapsed || !wrap;
  const view = `${collapsed}:${wrap}:${code.length}`;
  const atEnd = endView === view;
  const onScroll = (event: SyntheticEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    // At fractional zoom the native maximum sits just below scrollHeight - clientHeight.
    setEndView(scrollTop >= scrollHeight - clientHeight - 1 ? view : undefined);
  };

  const copy = async () => {
    const done = await copyToClipboard(source);
    setCopied(done);
    clearTimeout(copiedTimer.current);
    if (done) copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  };

  const codeProps = {
    id: CODE_BLOCK_CONTENT_ID,
    className: diff ? css.CodeBlockDiff : css.CodeBlockInternal,
    style: {
      display: 'block',
      whiteSpace: wrap ? 'pre-wrap' : 'pre',
      overflowWrap: wrap ? 'anywhere' : 'normal',
    } satisfies CSSProperties,
  };
  const plainBody = (
    <code {...codeProps} dir={isDiffLanguage ? 'ltr' : undefined}>
      {hasCustomBody ? customBody : (diffLines ?? code)}
    </code>
  );
  const body =
    hasCustomBody || diff || code.length > MAX_TEXT_HIGHLIGHT_LENGTH ? (
      plainBody
    ) : (
      <ErrorBoundary fallback={plainBody}>
        <PrismCode {...codeProps} code={code} language={language} />
      </ErrorBoundary>
    );

  const headerLabel = (
    <div className={css.CodeBlockLabel}>
      {iconToken && (
        <span
          role="img"
          aria-label={t('messageCodeBlock.language', {
            language: revealDirectionControls(language ?? labelExtension ?? ''),
          })}
        >
          <CodeBlockLanguageIcon token={iconToken} />
        </span>
      )}
      {(label || !iconToken) && (
        <span className={css.CodeBlockLabelText}>
          {revealDirectionControls(label ?? language ?? 'text')}
        </span>
      )}
    </div>
  );

  const sourceActions = (
    <>
      <button
        type="button"
        className={css.CodeBlockAction}
        aria-label={t('messageCodeBlock.wrap')}
        title={t('messageCodeBlock.wrap')}
        aria-pressed={wrap}
        onClick={() => setWrap((value) => !value)}
      >
        <WrapTextIcon />
      </button>
      {long && (
        <button
          ref={expandButtonRef}
          type="button"
          className={css.CodeBlockAction}
          aria-label={expanded ? t('messageCodeBlock.collapse') : t('messageCodeBlock.expand')}
          aria-expanded={expanded}
          onClick={() => {
            if (!expanded) armReveal();
            setExpanded((value) => !value);
          }}
        >
          {expanded ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      )}
    </>
  );

  const copyAction = (
    <button
      type="button"
      className={css.CodeBlockAction}
      aria-label={copied ? t('messageCodeBlock.copied') : t('messageCodeBlock.copy')}
      onClick={() => void copy()}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );

  const sourceBody = (
    <>
      {/* Native scroll areas need a tab stop for keyboard scrolling. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-tabindex */}
      <div
        ref={codeScrollRef}
        className={css.CodeBlockScroll}
        // Collapsed, the block shows its first lines and scrolls through the rest in place.
        style={collapsed ? { maxHeight: `${collapsedLines * 1.5}em` } : undefined}
        role={scrollable ? 'region' : undefined}
        aria-label={scrollable ? t('messageCodeBlock.code') : undefined}
        tabIndex={scrollable ? 0 : undefined}
        onScroll={onScroll}
      >
        {body}
        {collapsed && !atEnd && <div className={css.CodeBlockBottomShadow} />}
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
    </>
  );

  if (renderLayout) {
    return renderLayout({ wrap, headerLabel, sourceActions, copyAction, sourceBody });
  }

  return (
    <pre
      className={classNames(css.CodeBlock, !embedded && css.MarginSpaced)}
      data-wrap={wrap}
      data-code-block-embedded={embedded ? '' : undefined}
    >
      <div className={css.CodeBlockHeader}>
        {headerLabel}
        <div
          className={css.CodeBlockActions}
          role="group"
          aria-label={t('messageCodeBlock.actions')}
          data-code-block-actions=""
        >
          {sourceActions}
          {copyAction}
          {headerExtraActions}
        </div>
      </div>
      {sourceBody}
    </pre>
  );
}
