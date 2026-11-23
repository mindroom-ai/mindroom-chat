import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Box, Icon, Icons, Text, as } from 'folds';
import '../../theme/codeTokenStyles.css';
import { Chip, Header, IconButton } from '../../ui/glass/GlassPrimitives';
import { PageScroll } from '../../ui/page/PageScroll';
import { copyToClipboard } from '../../lib/dom';
import { revealDirectionControls } from '../../ui/directional';
import { dateTimeFormat } from '../../lib/time';
import { PrismCode } from '../../rich-text/code/ReactPrism';
import {
  buildEventSourceBundle,
  extractEventSummary,
  type EventSourceDoc,
  type EventSourceDocKind,
} from './eventSourceDocuments';
import {
  LONG_STRING_THRESHOLD,
  MAX_RAW_HIGHLIGHT_LENGTH,
  MAX_TREE_NODES,
  analyzeTreeStructure,
  computeTreeFilter,
  countTreeNodes,
  formatCopyValue,
  getContainerEntries,
  isJsonContainer,
  isTimestampField,
  joinPointer,
  makeStringSnippet,
  splitHighlightSegments,
  type TreeFilterResult,
} from './jsonSourceTree';
import * as css from './EventSourceViewer.css';

const COPIED_ALL_FEEDBACK_MS = 2000;
const COPIED_ITEM_FEEDBACK_MS = 1500;

type EventSourceViewerProps = {
  name: string;
  mEvent: MatrixEvent;
  requestClose: () => void;
};

function CopyMiniIcon() {
  return (
    <svg
      className={css.RowCopyIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckMiniIcon() {
  return (
    <svg
      className={css.RowCopyIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const segments = splitHighlightSegments(text, query);
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark key={`${index}-m`} className={css.MatchMark}>
            {segment.text}
          </mark>
        ) : (
          <React.Fragment key={`${index}-t`}>{segment.text}</React.Fragment>
        )
      )}
    </>
  );
}

type JsonNodeRenderProps = {
  value: unknown;
  path: string;
  keyName: string | undefined;
  depth: number;
  hasTrailingComma: boolean;
  ancestors: ReadonlySet<object>;
  collapsedPaths: ReadonlySet<string>;
  foldStrings: boolean;
  stringOverrides: Readonly<Record<string, boolean>>;
  filterResult: TreeFilterResult | null;
  copiedRowPath: string | null;
  onToggleContainer: (path: string) => void;
  onToggleString: (path: string) => void;
  onCopyRow: (path: string, value: unknown) => void;
  formatTimestamp: (ts: number) => string;
};

function JsonTreeNode({
  value,
  path,
  keyName,
  depth,
  hasTrailingComma,
  ancestors,
  collapsedPaths,
  foldStrings,
  stringOverrides,
  filterResult,
  copiedRowPath,
  onToggleContainer,
  onToggleString,
  onCopyRow,
  formatTimestamp,
}: JsonNodeRenderProps) {
  const { t } = useTranslation();

  if (filterResult && !filterResult.visiblePaths.has(path)) {
    return null;
  }

  const highlightQuery = filterResult?.query ?? '';
  const shownKey = keyName !== undefined ? revealDirectionControls(keyName) : undefined;
  const comma = hasTrailingComma ? <span className="token punctuation">,</span> : null;
  const showRowCopy = depth >= 1;
  const isRowCopied = copiedRowPath === path;

  const renderKeyPrefix = () =>
    shownKey !== undefined ? (
      <>
        <span className="token property">
          &quot;
          <HighlightedText text={shownKey} query={highlightQuery} />
          &quot;
        </span>
        <span className="token punctuation">: </span>
      </>
    ) : null;

  const renderRowCopyButton = () =>
    showRowCopy ? (
      <button
        type="button"
        className={classNames(css.RowCopyBtn, isRowCopied && css.RowCopyBtnCopied)}
        onClick={() => onCopyRow(path, value)}
        aria-label={
          shownKey !== undefined
            ? t('sharedUi.eventSourceViewer.copyField', { field: shownKey })
            : t('sharedUi.eventSourceViewer.copyValue')
        }
      >
        {isRowCopied ? <CheckMiniIcon /> : <CopyMiniIcon />}
      </button>
    ) : null;

  // Container (object or array), guarding against circular references.
  if (isJsonContainer(value) && !ancestors.has(value)) {
    const isArray = Array.isArray(value);
    const entries = getContainerEntries(value);
    const openBrace = isArray ? '[' : '{';
    const closeBrace = isArray ? ']' : '}';

    if (entries.length === 0) {
      return (
        <div className={css.TreeNode}>
          <div className={css.TreeLine}>
            <span className={css.TreeGutter} aria-hidden="true" />
            <span className={css.TreeText}>
              {renderKeyPrefix()}
              <span className="token punctuation">{`${openBrace}${closeBrace}`}</span>
              {comma}
            </span>
            {renderRowCopyButton()}
          </div>
        </div>
      );
    }

    const forceExpanded = filterResult?.autoExpandPaths.has(path) ?? false;
    const isCollapsed = !forceExpanded && collapsedPaths.has(path);
    const displayLabel = shownKey ?? (isArray ? '[]' : '{}');
    const summaryPill = isArray
      ? t('sharedUi.eventSourceViewer.itemCount', { count: entries.length })
      : t('sharedUi.eventSourceViewer.keyCount', { count: entries.length });

    if (isCollapsed) {
      return (
        <div className={css.TreeNode}>
          <div className={css.TreeLine}>
            <span className={css.TreeGutter}>
              <button
                type="button"
                className={css.FoldButton}
                aria-expanded={false}
                aria-label={t('sharedUi.eventSourceViewer.expandNode', { name: displayLabel })}
                onClick={() => onToggleContainer(path)}
              >
                <Icon src={Icons.ChevronRight} size="50" />
              </button>
            </span>
            <span className={css.TreeText}>
              {renderKeyPrefix()}
              <span className="token punctuation">{openBrace}</span>
              <button
                type="button"
                className={css.FoldPill}
                onClick={() => onToggleContainer(path)}
              >
                {summaryPill}
              </button>
              <span className="token punctuation">{closeBrace}</span>
              {comma}
            </span>
            {renderRowCopyButton()}
          </div>
        </div>
      );
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);
    const visibleEntries = filterResult
      ? entries.filter((entry) => filterResult.visiblePaths.has(joinPointer(path, entry.segment)))
      : entries;

    return (
      <div className={css.TreeNode}>
        <div className={css.TreeLine}>
          <span className={css.TreeGutter}>
            <button
              type="button"
              className={css.FoldButton}
              aria-expanded
              aria-label={t('sharedUi.eventSourceViewer.collapseNode', { name: displayLabel })}
              onClick={() => onToggleContainer(path)}
            >
              <Icon src={Icons.ChevronBottom} size="50" />
            </button>
          </span>
          <span className={css.TreeText}>
            {renderKeyPrefix()}
            <span className="token punctuation">{openBrace}</span>
          </span>
          {renderRowCopyButton()}
        </div>
        <div className={css.TreeChildren}>
          {visibleEntries.map((entry, index) => (
            <JsonTreeNode
              key={entry.segment}
              value={entry.value}
              path={joinPointer(path, entry.segment)}
              keyName={entry.key}
              depth={depth + 1}
              hasTrailingComma={index < visibleEntries.length - 1}
              ancestors={nextAncestors}
              collapsedPaths={collapsedPaths}
              foldStrings={foldStrings}
              stringOverrides={stringOverrides}
              filterResult={filterResult}
              copiedRowPath={copiedRowPath}
              onToggleContainer={onToggleContainer}
              onToggleString={onToggleString}
              onCopyRow={onCopyRow}
              formatTimestamp={formatTimestamp}
            />
          ))}
        </div>
        <div className={css.TreeLine}>
          <span className={css.TreeGutter} aria-hidden="true" />
          <span className={css.TreeText}>
            <span className="token punctuation">{closeBrace}</span>
            {comma}
          </span>
        </div>
      </div>
    );
  }

  // Primitive or circular placeholder leaf.
  const renderPrimitiveValue = () => {
    if (isJsonContainer(value)) {
      return (
        <>
          <span className="token string">&quot;[Circular]&quot;</span>
          {comma}
        </>
      );
    }

    if (typeof value === 'string') {
      const revealed = revealDirectionControls(value);
      const isLong = value.length > LONG_STRING_THRESHOLD;
      const matchedInFilter = filterResult?.matchedValuePaths.has(path) ?? false;
      const isFolded = isLong && !matchedInFilter && (stringOverrides[path] ?? foldStrings);

      if (isFolded) {
        const snippet = makeStringSnippet(revealed);
        return (
          <>
            <button
              type="button"
              className={css.StringPreviewBtn}
              onClick={() => onToggleString(path)}
              aria-expanded={false}
            >
              <span className="token string">{`"${snippet}"`}</span>
            </button>
            <span className={css.NoWrap}>
              {' '}
              <button
                type="button"
                className={css.StringLenPill}
                onClick={() => onToggleString(path)}
                aria-label={t('sharedUi.eventSourceViewer.expandString')}
              >
                {t('sharedUi.eventSourceViewer.charCount', { count: value.length })}
              </button>
              {comma}
            </span>
          </>
        );
      }

      if (isLong) {
        return (
          <>
            <span className="token string">
              &quot;
              <HighlightedText text={revealed} query={highlightQuery} />
              &quot;
            </span>
            <span className={css.NoWrap}>
              {' '}
              <button
                type="button"
                className={css.StringLenPill}
                onClick={() => onToggleString(path)}
                aria-expanded
                aria-label={t('sharedUi.eventSourceViewer.collapseString')}
              >
                {t('sharedUi.eventSourceViewer.collapseAll')}
              </button>
              {comma}
            </span>
          </>
        );
      }

      return (
        <>
          <span className="token string">
            &quot;
            <HighlightedText text={revealed} query={highlightQuery} />
            &quot;
          </span>
          {comma}
        </>
      );
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
      const numText = typeof value === 'bigint' ? value.toString() : String(value);
      const timestampHint = isTimestampField(keyName, value) ? formatTimestamp(value) : undefined;
      return (
        <>
          <span className="token number">
            <HighlightedText text={numText} query={highlightQuery} />
          </span>
          {comma}
          {timestampHint && (
            <span className={classNames('token comment', css.TimestampHint)}>
              {` // ${timestampHint}`}
            </span>
          )}
        </>
      );
    }

    if (typeof value === 'boolean') {
      return (
        <>
          <span className="token keyword">
            <HighlightedText text={String(value)} query={highlightQuery} />
          </span>
          {comma}
        </>
      );
    }

    if (value === null) {
      return (
        <>
          <span className="token tag">
            <HighlightedText text="null" query={highlightQuery} />
          </span>
          {comma}
        </>
      );
    }

    return (
      <>
        <span className="token string">
          &quot;
          <HighlightedText text={revealDirectionControls(String(value))} query={highlightQuery} />
          &quot;
        </span>
        {comma}
      </>
    );
  };

  return (
    <div className={css.TreeNode}>
      <div className={css.TreeLine}>
        <span className={css.TreeGutter} aria-hidden="true" />
        <span className={css.TreeText}>
          {renderKeyPrefix()}
          {renderPrimitiveValue()}
        </span>
        {renderRowCopyButton()}
      </div>
    </div>
  );
}

const getDocTabLabelKey = (kind: EventSourceDocKind) => {
  switch (kind) {
    case 'original':
      return 'sharedUi.eventSourceViewer.tabOriginal';
    case 'latestEdit':
      return 'sharedUi.eventSourceViewer.tabLatestEdit';
    case 'decrypted':
      return 'sharedUi.eventSourceViewer.tabDecrypted';
    case 'encrypted':
      return 'sharedUi.eventSourceViewer.tabEncrypted';
    case 'event':
      return 'sharedUi.eventSourceViewer.tabEvent';
  }
};

/**
 * Interactive Matrix event source viewer with a quick-copy metadata strip, version tabs, foldable
 * Prism-highlighted JSON tree, string folding, live filter, and raw JSON toggle.
 */
export const EventSourceViewer = as<'div', EventSourceViewerProps>(
  ({ className, mEvent, name, requestClose, ...props }, ref) => {
    const { t, i18n } = useTranslation();
    const shownName = revealDirectionControls(name);

    const bundle = useMemo(() => buildEventSourceBundle(mEvent), [mEvent]);
    const [selectedDocId, setSelectedDocId] = useState<string>(bundle.docs[0]?.id ?? 'event');
    const activeDoc: EventSourceDoc = bundle.docs.find((doc) => doc.id === selectedDocId) ??
      bundle.docs[0] ?? { id: 'event', kind: 'event', data: {}, rawJson: '{}' };

    const summary = useMemo(() => extractEventSummary(activeDoc.data), [activeDoc.data]);
    const { eventId, type: eventType, sender, timestamp } = summary;
    const treeExceedsLimit = useMemo(
      () => countTreeNodes(activeDoc.data, MAX_TREE_NODES + 1) > MAX_TREE_NODES,
      [activeDoc.data]
    );
    const structure = useMemo(() => analyzeTreeStructure(activeDoc.data), [activeDoc.data]);

    const [collapsedByDoc, setCollapsedByDoc] = useState<Record<string, Set<string>>>({});
    const [stringOverridesByDoc, setStringOverridesByDoc] = useState<
      Record<string, Record<string, boolean>>
    >({});
    const [foldStrings, setFoldStrings] = useState(true);
    const [rawModeOverride, setRawModeOverride] = useState<boolean | null>(null);
    const [filterQuery, setFilterQuery] = useState('');

    const [copiedAll, setCopiedAll] = useState(false);
    const [copiedMetaKey, setCopiedMetaKey] = useState<string | null>(null);
    const [copiedRowPath, setCopiedRowPath] = useState<string | null>(null);

    const isRaw = rawModeOverride ?? treeExceedsLimit;
    const collapsedPaths = collapsedByDoc[activeDoc.id] ?? structure.defaultCollapsed;
    const stringOverrides = stringOverridesByDoc[activeDoc.id] ?? {};

    const filterResult = useMemo(
      () => (isRaw ? null : computeTreeFilter(activeDoc.data, filterQuery)),
      [activeDoc.data, filterQuery, isRaw]
    );

    const timestampFormatter = useMemo(
      () => dateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'medium' }),
      [i18n.language]
    );
    const formatTimestamp = (ts: number): string => timestampFormatter.format(ts);

    useEffect(() => {
      if (!copiedAll) return undefined;
      const timer = setTimeout(setCopiedAll, COPIED_ALL_FEEDBACK_MS, false);
      return () => clearTimeout(timer);
    }, [copiedAll]);

    useEffect(() => {
      if (!copiedMetaKey) return undefined;
      const timer = setTimeout(setCopiedMetaKey, COPIED_ITEM_FEEDBACK_MS, null);
      return () => clearTimeout(timer);
    }, [copiedMetaKey]);

    useEffect(() => {
      if (!copiedRowPath) return undefined;
      const timer = setTimeout(setCopiedRowPath, COPIED_ITEM_FEEDBACK_MS, null);
      return () => clearTimeout(timer);
    }, [copiedRowPath]);

    const handleCopyAll = () => {
      copyToClipboard(activeDoc.rawJson).then(setCopiedAll, () => undefined);
    };

    const handleCopyMeta = (metaKey: string, rawValue: string) => {
      copyToClipboard(rawValue).then(
        (ok) => {
          if (ok) setCopiedMetaKey(metaKey);
        },
        () => undefined
      );
    };

    const handleCopyRow = (path: string, rowValue: unknown) => {
      copyToClipboard(formatCopyValue(rowValue)).then(
        (ok) => {
          if (ok) setCopiedRowPath(path);
        },
        () => undefined
      );
    };

    const handleToggleContainer = (path: string) => {
      setCollapsedByDoc((prev) => {
        const current = prev[activeDoc.id] ?? structure.defaultCollapsed;
        const next = new Set(current);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return { ...prev, [activeDoc.id]: next };
      });
    };

    const handleToggleString = (path: string) => {
      setStringOverridesByDoc((prev) => {
        const docOverrides = prev[activeDoc.id] ?? {};
        const currentFolded = docOverrides[path] ?? foldStrings;
        return {
          ...prev,
          [activeDoc.id]: { ...docOverrides, [path]: !currentFolded },
        };
      });
    };

    const handleCollapseAll = () => {
      setCollapsedByDoc((prev) => ({
        ...prev,
        [activeDoc.id]: new Set(structure.allCollapsibleAtDepthGte1),
      }));
      setFoldStrings(true);
      setStringOverridesByDoc((prev) => ({ ...prev, [activeDoc.id]: {} }));
    };

    const handleExpandAll = () => {
      setCollapsedByDoc((prev) => ({ ...prev, [activeDoc.id]: new Set() }));
      setFoldStrings(false);
      setStringOverridesByDoc((prev) => ({ ...prev, [activeDoc.id]: {} }));
    };

    const handleToggleFoldStrings = () => {
      setFoldStrings((prev) => !prev);
      setStringOverridesByDoc((prev) => ({ ...prev, [activeDoc.id]: {} }));
    };

    const handleFilterKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape' && filterQuery.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        setFilterQuery('');
      }
    };

    const hasMetaStrip =
      Boolean(eventId) ||
      Boolean(eventType) ||
      Boolean(sender) ||
      timestamp !== undefined ||
      bundle.isEdited ||
      bundle.isEncrypted;

    const revealedRaw = useMemo(
      () => (isRaw ? revealDirectionControls(activeDoc.rawJson) : ''),
      [activeDoc.rawJson, isRaw]
    );

    const rootClassName = classNames(css.EventSourceViewer, className);

    return (
      <Box direction="Column" className={rootClassName} {...props} ref={ref}>
        <Header size="400" className={css.ViewerHeader}>
          <Box grow="Yes" style={{ minWidth: 0 }}>
            <Text title={shownName} truncate size="H4">
              {shownName}
            </Text>
          </Box>
          <Chip
            before={copiedAll ? <Icon src={Icons.Check} size="50" /> : undefined}
            onClick={handleCopyAll}
            variant={copiedAll ? 'Success' : 'Primary'}
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

        {hasMetaStrip && (
          <div className={css.MetaStrip}>
            {eventId && (
              <button
                type="button"
                className={classNames(
                  css.MetaChip,
                  copiedMetaKey === 'event_id' && css.MetaChipCopied
                )}
                title={revealDirectionControls(eventId)}
                aria-label={t('sharedUi.eventSourceViewer.copyField', { field: 'event_id' })}
                onClick={() => handleCopyMeta('event_id', eventId)}
              >
                <span className={css.MetaChipLabel}>
                  {t('sharedUi.eventSourceViewer.metaEventId')}
                </span>
                <span className={css.MetaChipValue}>{revealDirectionControls(eventId)}</span>
                {copiedMetaKey === 'event_id' && <CheckMiniIcon />}
              </button>
            )}
            {eventType && (
              <button
                type="button"
                className={classNames(css.MetaChip, copiedMetaKey === 'type' && css.MetaChipCopied)}
                title={revealDirectionControls(eventType)}
                aria-label={t('sharedUi.eventSourceViewer.copyField', { field: 'type' })}
                onClick={() => handleCopyMeta('type', eventType)}
              >
                <span className={css.MetaChipLabel}>
                  {t('sharedUi.eventSourceViewer.metaType')}
                </span>
                <span className={css.MetaChipValue}>{revealDirectionControls(eventType)}</span>
                {copiedMetaKey === 'type' && <CheckMiniIcon />}
              </button>
            )}
            {sender && (
              <button
                type="button"
                className={classNames(
                  css.MetaChip,
                  copiedMetaKey === 'sender' && css.MetaChipCopied
                )}
                title={revealDirectionControls(sender)}
                aria-label={t('sharedUi.eventSourceViewer.copyField', { field: 'sender' })}
                onClick={() => handleCopyMeta('sender', sender)}
              >
                <span className={css.MetaChipLabel}>
                  {t('sharedUi.eventSourceViewer.metaSender')}
                </span>
                <span className={css.MetaChipValue}>{revealDirectionControls(sender)}</span>
                {copiedMetaKey === 'sender' && <CheckMiniIcon />}
              </button>
            )}
            {timestamp !== undefined && (
              <button
                type="button"
                className={classNames(
                  css.MetaChip,
                  copiedMetaKey === 'origin_server_ts' && css.MetaChipCopied
                )}
                title={String(timestamp)}
                aria-label={t('sharedUi.eventSourceViewer.copyField', {
                  field: 'origin_server_ts',
                })}
                onClick={() => handleCopyMeta('origin_server_ts', String(timestamp))}
              >
                <span className={css.MetaChipLabel}>
                  {t('sharedUi.eventSourceViewer.metaTime')}
                </span>
                <span className={css.MetaChipValue}>{formatTimestamp(timestamp)}</span>
                {copiedMetaKey === 'origin_server_ts' && <CheckMiniIcon />}
              </button>
            )}
            {bundle.isEdited && (
              <span className={css.MetaBadgeEdited}>
                {t('sharedUi.eventSourceViewer.badgeEdited')}
              </span>
            )}
            {bundle.isEncrypted && (
              <span className={css.MetaBadgeEncrypted}>
                {t('sharedUi.eventSourceViewer.badgeEncrypted')}
              </span>
            )}
          </div>
        )}

        <div className={css.SubToolbar}>
          {bundle.docs.length > 1 && (
            <div
              role="tablist"
              aria-label={t('sharedUi.eventSourceViewer.documentTabsLabel')}
              className={css.DocTabs}
            >
              {bundle.docs.map((doc) => {
                const selected = doc.id === activeDoc.id;
                return (
                  <button
                    key={doc.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={classNames(css.DocTab, selected && css.DocTabActive)}
                    onClick={() => setSelectedDocId(doc.id)}
                  >
                    {t(getDocTabLabelKey(doc.kind))}
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            className={css.ToolbarButton}
            disabled={isRaw}
            onClick={handleCollapseAll}
          >
            {t('sharedUi.eventSourceViewer.collapseAll')}
          </button>
          <button
            type="button"
            className={css.ToolbarButton}
            disabled={isRaw}
            onClick={handleExpandAll}
          >
            {t('sharedUi.eventSourceViewer.expandAll')}
          </button>
          <button
            type="button"
            className={css.ToolbarButton}
            aria-pressed={foldStrings}
            disabled={isRaw}
            onClick={handleToggleFoldStrings}
          >
            {t('sharedUi.eventSourceViewer.foldStrings')}
          </button>
          <button
            type="button"
            className={css.ToolbarButton}
            aria-pressed={isRaw}
            onClick={() => setRawModeOverride(!isRaw)}
          >
            {t('sharedUi.eventSourceViewer.rawJson')}
          </button>

          <div className={css.FilterGroup}>
            <input
              type="search"
              className={css.FilterInput}
              value={filterQuery}
              disabled={isRaw}
              placeholder={t('sharedUi.eventSourceViewer.filterPlaceholder')}
              aria-label={t('sharedUi.eventSourceViewer.filterPlaceholder')}
              onChange={(event) => setFilterQuery(event.target.value)}
              onKeyDown={handleFilterKeyDown}
            />
            {filterResult && (
              <span className={css.FilterCount} aria-live="polite">
                {t('sharedUi.eventSourceViewer.matchCount', { count: filterResult.matchCount })}
              </span>
            )}
          </div>
        </div>

        <PageScroll className={css.ViewerContent}>
          {isRaw ? (
            <pre className={classNames(css.RawPre, 'language-json')}>
              {revealedRaw.length <= MAX_RAW_HIGHLIGHT_LENGTH ? (
                <PrismCode code={revealedRaw} language="json" />
              ) : (
                <code>{revealedRaw}</code>
              )}
            </pre>
          ) : filterResult && filterResult.matchCount === 0 ? (
            <div className={css.EmptyFilter}>
              {t('sharedUi.eventSourceViewer.noMatches', { query: filterResult.query })}
            </div>
          ) : (
            <div className={css.TreeRoot}>
              <JsonTreeNode
                value={activeDoc.data}
                path=""
                keyName={undefined}
                depth={0}
                hasTrailingComma={false}
                ancestors={new Set()}
                collapsedPaths={collapsedPaths}
                foldStrings={foldStrings}
                stringOverrides={stringOverrides}
                filterResult={filterResult}
                copiedRowPath={copiedRowPath}
                onToggleContainer={handleToggleContainer}
                onToggleString={handleToggleString}
                onCopyRow={handleCopyRow}
                formatTimestamp={formatTimestamp}
              />
            </div>
          )}
        </PageScroll>
      </Box>
    );
  }
);
