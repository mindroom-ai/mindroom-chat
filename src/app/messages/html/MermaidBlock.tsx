import { type ReactNode, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import * as css from '../../rich-text/CustomHtml.css';
import * as mermaidCss from './MermaidBlock.css';
import { readMermaidTheme, renderMermaidDiagram } from './lazyMermaid';

type MermaidView = 'diagram' | 'source';

type RenderState = {
  svg: string | null;
  failedSource: string | null;
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

const documentThemeSignature = (): string => {
  if (typeof document === 'undefined') return '';
  const { documentElement: html, body } = document;
  return `${html?.className ?? ''}|${html?.dataset?.themeKind ?? ''}|${body?.className ?? ''}`;
};

/**
 * Renders a fenced `mermaid` block inside the standard `CodeBlock` frame with a Diagram / Source
 * toggle. Automatically switches to Source when `searchMatch` is true, follows theme changes via
 * `MutationObserver`, and retains the last valid SVG (or falls back to Source) on parse errors.
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
  const [renderState, setRenderState] = useState<RenderState>({ svg: null, failedSource: null });

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return undefined;
    }
    let last = documentThemeSignature();
    const observer = new MutationObserver(() => {
      const next = documentThemeSignature();
      if (next === last) return;
      last = next;
      setThemeRevision((rev) => rev + 1);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme-kind'],
    });
    if (document.body) {
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    return () => observer.disconnect();
  }, []);

  const trimmedSource = source.trim();

  useEffect(() => {
    if (preferredView !== 'diagram' || !trimmedSource) return undefined;

    const signal = { cancelled: false };
    const theme = readMermaidTheme(containerRef.current);

    renderMermaidDiagram(trimmedSource, theme, signal).then(
      (svg) => {
        if (!signal.cancelled && svg !== null) setRenderState({ svg, failedSource: null });
      },
      () => {
        if (!signal.cancelled) {
          setRenderState((prev) => ({ svg: prev.svg, failedSource: trimmedSource }));
        }
      }
    );

    return () => {
      signal.cancelled = true;
    };
  }, [preferredView, trimmedSource, themeRevision]);

  const showingDiagram = preferredView === 'diagram' && renderState.svg !== null;
  const failedWithoutSvg = renderState.svg === null && renderState.failedSource === trimmedSource;
  const showToggle = trimmedSource.length > 0 && (showingDiagram || !failedWithoutSvg);
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
          {failedWithoutSvg && preferredView === 'diagram' && (
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
        <div
          className={mermaidCss.MermaidViewport}
          role="region"
          aria-label={t('messageCodeBlock.mermaidDiagram')}
        >
          <div
            className={mermaidCss.MermaidSvg}
            // Output passed through Mermaid strict mode and sanitizeMermaidSvg().
            dangerouslySetInnerHTML={{ __html: renderState.svg ?? '' }}
          />
        </div>
      ) : (
        sourceBody
      )}
    </pre>
  );
}
