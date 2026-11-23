import React, { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { MatrixEventEvent, type MatrixEvent } from 'matrix-js-sdk';
import { Box, Icon, Icons, Text, as } from 'folds';
import '../../theme/codeTokenStyles.css';
import { Chip, Header, IconButton } from '../../ui/glass/GlassPrimitives';
import { PageScroll } from '../../ui/page/PageScroll';
import { copyToClipboard } from '../../lib/dom';
import { revealDirectionControls } from '../../ui/directional';
import { PrismCode } from '../../rich-text/code/ReactPrism';
import {
  buildEventSourceBundle,
  extractEventSummary,
  type EventSourceDoc,
  type EventSourceDocKind,
} from './eventSourceDocuments';
import {
  EMPTY_TREE_STRUCTURE,
  LONG_STRING_THRESHOLD,
  MAX_RAW_HIGHLIGHT_LENGTH,
  MAX_TREE_NODES,
  analyzeTreeStructure,
  computeTreeFilter,
  exceedsTreeNodeLimit,
  formatCopyValue,
  formatJsonStringInner,
  formatTimestampHint,
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
const MAX_INDENT_DEPTH = 6;

const eventInstanceIds = new WeakMap<MatrixEvent, number>();
let nextEventInstanceId = 1;

const getEventIdentityKey = (mEvent: MatrixEvent): string => {
  let id = eventInstanceIds.get(mEvent);
  if (id === undefined) {
    id = nextEventInstanceId;
    nextEventInstanceId += 1;
    eventInstanceIds.set(mEvent, id);
  }
  return String(id);
};

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

type JsonTreeContextValue = {
  docKey: string;
  collapsedPaths: ReadonlySet<string>;
  foldStrings: boolean;
  stringOverrides: Readonly<Record<string, boolean>>;
  filterResult: TreeFilterResult | null;
  copiedRowKey: string | null;
  language: string;
  onToggleContainer: (path: string) => void;
  onToggleString: (path: string) => void;
  onCopyRow: (path: string, value: unknown) => void;
};

const JsonTreeContext = React.createContext<JsonTreeContextValue | null>(null);

type JsonNodeRenderProps = {
  value: unknown;
  path: string;
  keyName: string | undefined;
  depth: number;
  hasTrailingComma: boolean;
};

function JsonTreeNode({ value, path, keyName, depth, hasTrailingComma }: JsonNodeRenderProps) {
  const { t } = useTranslation();
  const ctx = useContext(JsonTreeContext);
  if (!ctx) return null;

  const {
    docKey,
    collapsedPaths,
    foldStrings,
    stringOverrides,
    filterResult,
    copiedRowKey,
    language,
    onToggleContainer,
    onToggleString,
    onCopyRow,
  } = ctx;

  if (filterResult && !filterResult.visiblePaths.has(path)) {
    return null;
  }

  const highlightQuery = filterResult?.query ?? '';
  const shownKey = keyName !== undefined ? revealDirectionControls(keyName) : undefined;
  const escapedKey = keyName !== undefined ? formatJsonStringInner(keyName) : undefined;
  const comma = hasTrailingComma ? <span className="token punctuation">,</span> : null;
  const isRowCopied = copiedRowKey === `${docKey}:${path}`;

  const renderKeyPrefix = () =>
    escapedKey !== undefined ? (
      <>
        <span className="token property">
          &quot;
          <HighlightedText text={escapedKey} query={highlightQuery} />
          &quot;
        </span>
        <span className="token punctuation">: </span>
      </>
    ) : null;

  const renderRowCopyButton = () => (
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
  );

  // Container (object or array) — `doc.data` is already sanitized and cycle-free.
  if (isJsonContainer(value)) {
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
                aria-expanded={false}
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
              disabled={forceExpanded}
              aria-expanded
              aria-label={t('sharedUi.eventSourceViewer.collapseNode', { name: displayLabel })}
              onClick={forceExpanded ? undefined : () => onToggleContainer(path)}
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
        <div className={depth < MAX_INDENT_DEPTH ? css.TreeChildren : css.TreeChildrenFlat}>
          {visibleEntries.map((entry, index) => (
            <JsonTreeNode
              key={entry.segment}
              value={entry.value}
              path={joinPointer(path, entry.segment)}
              keyName={entry.key}
              depth={depth + 1}
              hasTrailingComma={index < visibleEntries.length - 1}
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

  // Primitive leaf.
  const isLongString = typeof value === 'string' && value.length > LONG_STRING_THRESHOLD;
  const matchedInFilter = filterResult?.matchedValuePaths.has(path) ?? false;
  const hasStringOverride = Object.hasOwn(stringOverrides, path);
  const isStringFolded =
    isLongString &&
    !matchedInFilter &&
    (hasStringOverride ? Boolean(stringOverrides[path]) : foldStrings);
  const stringLabel = shownKey ?? '""';

  const renderGutter = () => {
    if (!isLongString) {
      return <span className={css.TreeGutter} aria-hidden="true" />;
    }
    return (
      <span className={css.TreeGutter}>
        <button
          type="button"
          className={css.FoldButton}
          disabled={matchedInFilter}
          aria-expanded={!isStringFolded}
          aria-label={
            isStringFolded
              ? t('sharedUi.eventSourceViewer.expandNode', { name: stringLabel })
              : t('sharedUi.eventSourceViewer.collapseNode', { name: stringLabel })
          }
          onClick={matchedInFilter ? undefined : () => onToggleString(path)}
        >
          <Icon src={isStringFolded ? Icons.ChevronRight : Icons.ChevronBottom} size="50" />
        </button>
      </span>
    );
  };

  const renderPrimitiveValue = () => {
    if (typeof value === 'string') {
      if (isStringFolded) {
        const snippet = makeStringSnippet(value);
        return (
          <>
            <button
              type="button"
              className={css.StringPreviewBtn}
              onClick={() => onToggleString(path)}
              aria-expanded={false}
            >
              <span className="token string">{snippet}</span>
            </button>
            <span className={css.StringPillWrap}>
              <button
                type="button"
                className={css.StringLenPill}
                aria-expanded={false}
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

      const escapedValue = formatJsonStringInner(value);

      if (isLongString) {
        return (
          <>
            <span className="token string">
              &quot;
              <HighlightedText text={escapedValue} query={highlightQuery} />
              &quot;
            </span>
            <span className={css.StringPillWrap}>
              <button
                type="button"
                className={css.StringLenPill}
                disabled={matchedInFilter}
                onClick={matchedInFilter ? undefined : () => onToggleString(path)}
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
            <HighlightedText text={escapedValue} query={highlightQuery} />
            &quot;
          </span>
          {comma}
        </>
      );
    }

    if (typeof value === 'number') {
      const numText = String(value);
      const timestampHint = isTimestampField(keyName, value)
        ? formatTimestampHint(value, language)
        : undefined;
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
          <HighlightedText text={formatJsonStringInner(String(value))} query={highlightQuery} />
          &quot;
        </span>
        {comma}
      </>
    );
  };

  return (
    <div className={css.TreeNode}>
      <div className={css.TreeLine}>
        {renderGutter()}
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
    case 'decryptionError':
      return 'sharedUi.eventSourceViewer.tabDecryptionError';
    case 'encrypted':
      return 'sharedUi.eventSourceViewer.tabEncrypted';
    case 'event':
      return 'sharedUi.eventSourceViewer.tabEvent';
  }
};

type MetaChipDescriptor = {
  key: 'event_id' | 'type' | 'sender' | 'origin_server_ts';
  label: string;
  displayValue: string;
  rawValue: string;
};

/**
 * Interactive Matrix event source viewer with a quick-copy metadata strip, version tabs, foldable
 * Prism-highlighted JSON tree, string folding, live filter, and raw JSON toggle.
 */
export const EventSourceViewer = as<'div', EventSourceViewerProps>(
  ({ className, mEvent, name, requestClose, ...props }, ref) => {
    const { t, i18n } = useTranslation();
    const idBase = useId();
    const shownName = revealDirectionControls(name);

    const eventKey = getEventIdentityKey(mEvent);
    const [revision, setRevision] = useState(0);
    const replacingEvent = mEvent.replacingEvent?.() ?? undefined;

    // Live updates when the event decrypts or receives an edit while the viewer is open.
    useEffect(() => {
      const bump = () => setRevision((prev) => prev + 1);
      if (typeof mEvent.on === 'function' && typeof mEvent.off === 'function') {
        mEvent.on(MatrixEventEvent.Decrypted, bump);
        mEvent.on(MatrixEventEvent.Replaced, bump);
      }
      if (
        replacingEvent &&
        typeof replacingEvent.on === 'function' &&
        typeof replacingEvent.off === 'function'
      ) {
        replacingEvent.on(MatrixEventEvent.Decrypted, bump);
      }
      return () => {
        if (typeof mEvent.off === 'function') {
          mEvent.off(MatrixEventEvent.Decrypted, bump);
          mEvent.off(MatrixEventEvent.Replaced, bump);
        }
        if (replacingEvent && typeof replacingEvent.off === 'function') {
          replacingEvent.off(MatrixEventEvent.Decrypted, bump);
        }
      };
    }, [mEvent, replacingEvent]);

    const bundle = useMemo(() => {
      if (revision < 0) return buildEventSourceBundle(mEvent);
      return buildEventSourceBundle(mEvent);
    }, [mEvent, revision]);

    const [selectedDocByEvent, setSelectedDocByEvent] = useState<
      Record<string, EventSourceDocKind>
    >({});
    const selectedKind = Object.hasOwn(selectedDocByEvent, eventKey)
      ? selectedDocByEvent[eventKey]
      : undefined;
    const activeDoc: EventSourceDoc =
      bundle.docs.find((doc) => doc.kind === selectedKind) ?? bundle.docs[0];
    const docKey = `${eventKey}:${activeDoc.kind}`;

    const [collapsedByDoc, setCollapsedByDoc] = useState<Record<string, Set<string>>>({});
    const [stringOverridesByDoc, setStringOverridesByDoc] = useState<
      Record<string, Record<string, boolean>>
    >({});
    const [foldStringsByDoc, setFoldStringsByDoc] = useState<Record<string, boolean>>({});
    const [rawModeByDoc, setRawModeByDoc] = useState<Record<string, boolean>>({});
    const [filterQueryByEvent, setFilterQueryByEvent] = useState<Record<string, string>>({});

    const [copiedAll, setCopiedAll] = useState(false);
    const [copiedMetaKey, setCopiedMetaKey] = useState<string | null>(null);
    const [copiedRowKey, setCopiedRowKey] = useState<string | null>(null);

    const mountedRef = useRef(true);
    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);
    const activeDocKeyRef = useRef(docKey);
    activeDocKeyRef.current = docKey;
    const copyTokenRef = useRef({ all: 0, meta: 0, row: 0 });
    const tabRefs = useRef<Partial<Record<EventSourceDocKind, HTMLButtonElement | null>>>({});

    const summary = useMemo(() => extractEventSummary(activeDoc.data), [activeDoc.data]);
    const { eventId, type: eventType, sender, timestamp } = summary;

    const treeExceedsLimit = useMemo(
      () => exceedsTreeNodeLimit(activeDoc.data, MAX_TREE_NODES),
      [activeDoc.data]
    );
    const rawOverride = Object.hasOwn(rawModeByDoc, docKey) ? rawModeByDoc[docKey] : undefined;
    const isRaw = rawOverride ?? treeExceedsLimit;

    // Skip full tree fold analysis while in Raw mode.
    const structure = useMemo(
      () => (isRaw ? EMPTY_TREE_STRUCTURE : analyzeTreeStructure(activeDoc.data)),
      [activeDoc.data, isRaw]
    );

    const collapsedPaths = Object.hasOwn(collapsedByDoc, docKey)
      ? collapsedByDoc[docKey]!
      : structure.defaultCollapsed;
    const stringOverrides = useMemo(
      () => (Object.hasOwn(stringOverridesByDoc, docKey) ? stringOverridesByDoc[docKey]! : {}),
      [docKey, stringOverridesByDoc]
    );
    const foldStrings = Object.hasOwn(foldStringsByDoc, docKey) ? foldStringsByDoc[docKey]! : true;
    const filterQuery = Object.hasOwn(filterQueryByEvent, eventKey)
      ? filterQueryByEvent[eventKey]!
      : '';

    const filterResult = useMemo(
      () => (isRaw ? null : computeTreeFilter(activeDoc.data, filterQuery)),
      [activeDoc.data, filterQuery, isRaw]
    );

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
      if (!copiedRowKey) return undefined;
      const timer = setTimeout(setCopiedRowKey, COPIED_ITEM_FEEDBACK_MS, null);
      return () => clearTimeout(timer);
    }, [copiedRowKey]);

    const selectDocKind = useCallback(
      (kind: EventSourceDocKind) => {
        setSelectedDocByEvent((prev) => ({ ...prev, [eventKey]: kind }));
      },
      [eventKey]
    );

    const setFilterQuery = useCallback(
      (nextQuery: string) => {
        setFilterQueryByEvent((prev) => ({ ...prev, [eventKey]: nextQuery }));
      },
      [eventKey]
    );

    const handleCopyAll = () => {
      const targetEventKey = eventKey;
      copyTokenRef.current.all += 1;
      const token = copyTokenRef.current.all;
      copyToClipboard(bundle.rawAll).then(
        (ok) => {
          if (
            ok &&
            mountedRef.current &&
            copyTokenRef.current.all === token &&
            activeDocKeyRef.current.startsWith(`${targetEventKey}:`)
          ) {
            setCopiedAll(true);
          }
        },
        () => undefined
      );
    };

    const handleCopyMeta = (metaKey: string, rawValue: string) => {
      const targetDocKey = docKey;
      copyTokenRef.current.meta += 1;
      const token = copyTokenRef.current.meta;
      copyToClipboard(rawValue).then(
        (ok) => {
          if (
            ok &&
            mountedRef.current &&
            copyTokenRef.current.meta === token &&
            activeDocKeyRef.current === targetDocKey
          ) {
            setCopiedMetaKey(`${targetDocKey}:${metaKey}`);
          }
        },
        () => undefined
      );
    };

    const handleCopyRow = useCallback(
      (path: string, rowValue: unknown) => {
        const targetDocKey = docKey;
        copyTokenRef.current.row += 1;
        const token = copyTokenRef.current.row;
        copyToClipboard(formatCopyValue(rowValue)).then(
          (ok) => {
            if (
              ok &&
              mountedRef.current &&
              copyTokenRef.current.row === token &&
              activeDocKeyRef.current === targetDocKey
            ) {
              setCopiedRowKey(`${targetDocKey}:${path}`);
            }
          },
          () => undefined
        );
      },
      [docKey]
    );

    const handleToggleContainer = useCallback(
      (path: string) => {
        setCollapsedByDoc((prev) => {
          const current = Object.hasOwn(prev, docKey) ? prev[docKey]! : structure.defaultCollapsed;
          const next = new Set(current);
          if (next.has(path)) {
            next.delete(path);
          } else {
            next.add(path);
          }
          return { ...prev, [docKey]: next };
        });
      },
      [docKey, structure.defaultCollapsed]
    );

    const handleToggleString = useCallback(
      (path: string) => {
        setStringOverridesByDoc((prev) => {
          const docOverrides = Object.hasOwn(prev, docKey) ? prev[docKey]! : {};
          const currentFolded = Object.hasOwn(docOverrides, path)
            ? Boolean(docOverrides[path])
            : foldStrings;
          return {
            ...prev,
            [docKey]: { ...docOverrides, [path]: !currentFolded },
          };
        });
      },
      [docKey, foldStrings]
    );

    const handleCollapseAll = () => {
      setCollapsedByDoc((prev) => ({
        ...prev,
        [docKey]: new Set(structure.allCollapsibleAtDepthGte1),
      }));
      setFoldStringsByDoc((prev) => ({ ...prev, [docKey]: true }));
      setStringOverridesByDoc((prev) => ({ ...prev, [docKey]: {} }));
    };

    const handleExpandAll = () => {
      setCollapsedByDoc((prev) => ({ ...prev, [docKey]: new Set() }));
      setFoldStringsByDoc((prev) => ({ ...prev, [docKey]: false }));
      setStringOverridesByDoc((prev) => ({ ...prev, [docKey]: {} }));
    };

    const handleToggleFoldStrings = () => {
      setFoldStringsByDoc((prev) => {
        const current = Object.hasOwn(prev, docKey) ? prev[docKey]! : true;
        return { ...prev, [docKey]: !current };
      });
      setStringOverridesByDoc((prev) => ({ ...prev, [docKey]: {} }));
    };

    const handleToggleRawMode = () => {
      setRawModeByDoc((prev) => ({ ...prev, [docKey]: !isRaw }));
    };

    const handleFilterKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape' && filterQuery.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        setFilterQuery('');
      }
    };

    const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | undefined;
      if (event.key === 'ArrowRight') {
        nextIndex = (index + 1) % bundle.docs.length;
      } else if (event.key === 'ArrowLeft') {
        nextIndex = (index - 1 + bundle.docs.length) % bundle.docs.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = bundle.docs.length - 1;
      }
      if (nextIndex === undefined) return;
      event.preventDefault();
      const nextDoc = bundle.docs[nextIndex];
      if (!nextDoc) return;
      selectDocKind(nextDoc.kind);
      tabRefs.current[nextDoc.kind]?.focus();
    };

    const metaChips = useMemo<MetaChipDescriptor[]>(() => {
      const chips: MetaChipDescriptor[] = [];
      if (eventId) {
        chips.push({
          key: 'event_id',
          label: t('sharedUi.eventSourceViewer.metaEventId'),
          displayValue: revealDirectionControls(eventId),
          rawValue: eventId,
        });
      }
      if (eventType) {
        chips.push({
          key: 'type',
          label: t('sharedUi.eventSourceViewer.metaType'),
          displayValue: revealDirectionControls(eventType),
          rawValue: eventType,
        });
      }
      if (sender) {
        chips.push({
          key: 'sender',
          label: t('sharedUi.eventSourceViewer.metaSender'),
          displayValue: revealDirectionControls(sender),
          rawValue: sender,
        });
      }
      if (timestamp !== undefined) {
        chips.push({
          key: 'origin_server_ts',
          label: t('sharedUi.eventSourceViewer.metaTime'),
          displayValue: formatTimestampHint(timestamp, i18n.language) ?? String(timestamp),
          rawValue: String(timestamp),
        });
      }
      return chips;
    }, [eventId, eventType, i18n.language, sender, t, timestamp]);

    const hasMetaStrip = metaChips.length > 0 || bundle.isEdited || bundle.isEncrypted;
    const hasMultipleDocs = bundle.docs.length > 1;
    const panelId = `${idBase}-panel`;
    const getTabId = (kind: EventSourceDocKind) => `${idBase}-tab-${kind}`;
    const activeTabId = getTabId(activeDoc.kind);

    const revealedRaw = useMemo(
      () => (isRaw ? revealDirectionControls(activeDoc.rawJson) : ''),
      [activeDoc.rawJson, isRaw]
    );

    const treeContextValue = useMemo<JsonTreeContextValue>(
      () => ({
        docKey,
        collapsedPaths,
        foldStrings,
        stringOverrides,
        filterResult,
        copiedRowKey,
        language: i18n.language,
        onToggleContainer: handleToggleContainer,
        onToggleString: handleToggleString,
        onCopyRow: handleCopyRow,
      }),
      [
        collapsedPaths,
        copiedRowKey,
        docKey,
        filterResult,
        foldStrings,
        handleCopyRow,
        handleToggleContainer,
        handleToggleString,
        i18n.language,
        stringOverrides,
      ]
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
            {metaChips.map((chip) => {
              const isCopied = copiedMetaKey === `${docKey}:${chip.key}`;
              const copyActionLabel = t('sharedUi.eventSourceViewer.copyField', {
                field: chip.label,
              });
              const accessibleLabel = `${copyActionLabel}: ${chip.displayValue}`;
              return (
                <button
                  key={chip.key}
                  type="button"
                  className={classNames(css.MetaChip, isCopied && css.MetaChipCopied)}
                  title={accessibleLabel}
                  aria-label={accessibleLabel}
                  onClick={() => handleCopyMeta(chip.key, chip.rawValue)}
                >
                  <span className={css.MetaChipLabel}>{chip.label}</span>
                  <span className={css.MetaChipValue}>{chip.displayValue}</span>
                  {isCopied && <CheckMiniIcon />}
                </button>
              );
            })}
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
          {hasMultipleDocs && (
            <div
              role="tablist"
              aria-label={t('sharedUi.eventSourceViewer.documentTabsLabel')}
              className={css.DocTabs}
            >
              {bundle.docs.map((doc, index) => {
                const selected = doc.kind === activeDoc.kind;
                return (
                  <button
                    key={doc.kind}
                    id={getTabId(doc.kind)}
                    ref={(el) => {
                      tabRefs.current[doc.kind] = el;
                    }}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={panelId}
                    tabIndex={selected ? 0 : -1}
                    className={classNames(css.DocTab, selected && css.DocTabActive)}
                    onClick={() => selectDocKind(doc.kind)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
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
            onClick={handleToggleRawMode}
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

        <PageScroll
          className={css.ViewerContent}
          id={hasMultipleDocs ? panelId : undefined}
          role={hasMultipleDocs ? 'tabpanel' : undefined}
          aria-labelledby={hasMultipleDocs ? activeTabId : undefined}
        >
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
              <JsonTreeContext.Provider value={treeContextValue}>
                <JsonTreeNode
                  value={activeDoc.data}
                  path=""
                  keyName={undefined}
                  depth={0}
                  hasTrailingComma={false}
                />
              </JsonTreeContext.Provider>
            </div>
          )}
        </PageScroll>
      </Box>
    );
  }
);
