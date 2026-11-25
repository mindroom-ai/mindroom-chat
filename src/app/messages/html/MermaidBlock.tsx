import { type ReactNode, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import * as css from '../../rich-text/CustomHtml.css';
import { subscribeAppliedTheme } from '../../theme/appliedThemeListeners';
import * as mermaidCss from './MermaidBlock.css';
import { readMermaidTheme, renderMermaidDiagram } from './lazyMermaid';

type MermaidView = 'diagram' | 'source';

type RenderState = {
  svg?: string;
  renderedSource?: string;
  failedSource?: string;
};

export type MermaidBlockProps = {
  source: string;
  searchMatch: boolean;
  wrap: boolean;
  headerLabel: ReactNode;
  sourceActions: ReactNode;
  copyAction: ReactNode;
  sourceBody: ReactNode;
};

/**
 * Renders a fenced `mermaid` block inside the standard `CodeBlock` frame with a Diagram / Source
 * toggle. Automatically switches to Source when `searchMatch` is true, follows applied theme
 * switches, and falls back to Source immediately when the current source cannot render.
 */
export function MermaidBlock({
  source,
  searchMatch,
  wrap,
  headerLabel,
  sourceActions,
  copyAction,
  sourceBody,
}: MermaidBlockProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLPreElement>(null);

  // Manual toggle applies for the current `searchMatch` state; when search starts or stops
  // matching, the block returns automatically to Source or Diagram.
  const [viewOverride, setViewOverride] = useState<{ searchMatch: boolean; view: MermaidView }>();
  const preferredView: MermaidView =
    viewOverride && viewOverride.searchMatch === searchMatch
      ? viewOverride.view
      : searchMatch
        ? 'source'
        : 'diagram';

  const [themeRevision, setThemeRevision] = useState(0);
  const [renderState, setRenderState] = useState<RenderState>({});

  useEffect(() => subscribeAppliedTheme(() => setThemeRevision((rev) => rev + 1)), []);

  const trimmedSource = source.trim();

  useEffect(() => {
    if (preferredView !== 'diagram' || !trimmedSource) return undefined;

    const signal = { cancelled: false };
    const theme = readMermaidTheme(containerRef.current);

    renderMermaidDiagram(trimmedSource, theme, signal).then(
      (svg) => {
        if (!signal.cancelled && svg !== null) {
          setRenderState({ svg, renderedSource: trimmedSource });
        }
      },
      () => {
        if (!signal.cancelled) {
          setRenderState({
            svg: undefined,
            renderedSource: undefined,
            failedSource: trimmedSource,
          });
        }
      }
    );

    return () => {
      signal.cancelled = true;
    };
  }, [preferredView, trimmedSource, themeRevision]);

  const hasCurrentSvg =
    renderState.svg !== undefined && renderState.renderedSource === trimmedSource;
  const showingDiagram = preferredView === 'diagram' && trimmedSource.length > 0 && hasCurrentSvg;
  const failed = !hasCurrentSvg && renderState.failedSource === trimmedSource;
  const showToggle = trimmedSource.length > 0 && (showingDiagram || !failed);
  const toggleLabel = showingDiagram
    ? t('messageCodeBlock.showSource')
    : t('messageCodeBlock.showDiagram');

  return (
    <pre
      ref={containerRef}
      className={classNames(css.CodeBlock, css.MarginSpaced)}
      data-wrap={wrap}
      data-mermaid-view={showingDiagram ? 'diagram' : 'source'}
    >
      <div className={css.CodeBlockHeader}>
        {headerLabel}
        <div
          className={css.CodeBlockActions}
          role="group"
          aria-label={t('messageCodeBlock.actions')}
          data-code-block-actions=""
        >
          {failed && preferredView === 'diagram' && (
            <span className={mermaidCss.MermaidStatus}>
              {t('messageCodeBlock.diagramUnavailable')}
            </span>
          )}
          {showToggle && (
            <button
              type="button"
              className={classNames(css.CodeBlockAction, mermaidCss.MermaidToggle)}
              aria-label={toggleLabel}
              title={toggleLabel}
              onClick={() =>
                setViewOverride({ searchMatch, view: showingDiagram ? 'source' : 'diagram' })
              }
            >
              {showingDiagram ? t('messageCodeBlock.source') : t('messageCodeBlock.diagram')}
            </button>
          )}
          {!showingDiagram && sourceActions}
          {copyAction}
        </div>
      </div>
      {showingDiagram ? (
        /* Native scroll areas need a tab stop for keyboard scrolling. */
        /* eslint-disable jsx-a11y/no-noninteractive-tabindex */
        <div
          className={mermaidCss.MermaidViewport}
          role="region"
          aria-label={t('messageCodeBlock.mermaidDiagram')}
          tabIndex={0}
        >
          <div
            className={mermaidCss.MermaidSvg}
            // Output passed through CSP-sandboxed Mermaid strict mode and sanitizeMermaidSvg().
            dangerouslySetInnerHTML={{ __html: renderState.svg ?? '' }}
          />
        </div>
      ) : (
        /* eslint-enable jsx-a11y/no-noninteractive-tabindex */
        sourceBody
      )}
    </pre>
  );
}
