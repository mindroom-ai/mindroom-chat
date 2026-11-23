import React, {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { MatrixEventEvent, type MatrixEvent } from 'matrix-js-sdk';
import { Box, Icon, Icons, Text, as } from 'folds';
import '../../theme/codeTokenStyles.css';
import { Chip, Header, IconButton } from '../../ui/glass/GlassPrimitives';
import { PageScroll } from '../../ui/page/PageScroll';
import { copyToClipboard } from '../../lib/dom';
import { getAppliedEdit } from '../../matrix/protocol/untrustedContent';
import { IsolatedText, documentIsRightToLeft, revealDirectionControls } from '../../ui/directional';
import { PrismCode } from '../../rich-text/code/ReactPrism';
import {
  buildEventSourceBundle,
  extractEventSummary,
  type EventSourceDocKind,
} from './eventSourceDocuments';
import {
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
  isTimestampField,
  makeStringSnippet,
  splitHighlightSegments,
  type JsonContainer,
  type TreeFilterResult,
  type TreeStructureMeta,
} from './jsonSourceTree';
import * as css from './EventSourceViewer.css';

const COPIED_ALL_MS = 2000;
const COPIED_ITEM_MS = 1500;
const MAX_INDENT_DEPTH = 6;
const EMPTY_STRUCTURE: TreeStructureMeta = {
  allCollapsibleAtDepthGte1: [],
  defaultCollapsed: new Set(),
};
const EVENT_CHANGE_EVENTS = [
  MatrixEventEvent.Decrypted,
  MatrixEventEvent.Replaced,
  MatrixEventEvent.LocalEventIdReplaced,
  MatrixEventEvent.Status,
] as const;
const DOC_TAB_LABELS = {
  original: 'sharedUi.eventSourceViewer.tabOriginal',
  latestEdit: 'sharedUi.eventSourceViewer.tabLatestEdit',
  decrypted: 'sharedUi.eventSourceViewer.tabDecrypted',
  decryptionError: 'sharedUi.eventSourceViewer.tabDecryptionError',
  encrypted: 'sharedUi.eventSourceViewer.tabEncrypted',
  event: 'sharedUi.eventSourceViewer.tabEvent',
} as const satisfies Record<EventSourceDocKind, string>;

const useEventSourceBundle = (mEvent: MatrixEvent) => {
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let disposed = false;
    let listenedEdit: MatrixEvent | undefined;
    const onChange = () => {
      if (disposed) return;
      const edit =
        typeof mEvent.replacingEvent === 'function'
          ? getAppliedEdit(mEvent) ?? undefined
          : undefined;
      if (edit !== listenedEdit) {
        listenedEdit?.off(MatrixEventEvent.Decrypted, onChange);
        listenedEdit =
          typeof edit?.on === 'function' && typeof edit.off === 'function' ? edit : undefined;
        listenedEdit?.on(MatrixEventEvent.Decrypted, onChange);
      }
      bump();
    };
    const onBeforeRedaction = () => queueMicrotask(onChange);
    const canListen = typeof mEvent.on === 'function' && typeof mEvent.off === 'function';
    if (canListen) {
      EVENT_CHANGE_EVENTS.forEach((ev) => mEvent.on(ev, onChange));
      mEvent.on(MatrixEventEvent.BeforeRedaction, onBeforeRedaction);
    }
    onChange();
    return () => {
      disposed = true;
      if (canListen) {
        EVENT_CHANGE_EVENTS.forEach((ev) => mEvent.off(ev, onChange));
        mEvent.off(MatrixEventEvent.BeforeRedaction, onBeforeRedaction);
      }
      listenedEdit?.off(MatrixEventEvent.Decrypted, onChange);
    };
  }, [mEvent]);

  return useMemo(() => {
    void version;
    return buildEventSourceBundle(mEvent);
  }, [mEvent, version]);
};

const useCopyFeedback = (resetKey: string) => {
  const [copied, setCopied] = useState<{ key: string; id: string } | null>(null);
  const keyRef = useRef(resetKey);
  keyRef.current = resetKey;
  const tokenRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    tokenRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    setCopied((prev) => (prev?.key === resetKey ? prev : null));
    return () => {
      tokenRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetKey]);

  const copy = useCallback((id: string, text: string, el: Element, ms = COPIED_ITEM_MS) => {
    const key = keyRef.current;
    const token = (tokenRef.current += 1);
    void copyToClipboard(text, el).then(
      (ok) => {
        if (!ok || tokenRef.current !== token || keyRef.current !== key) return;
        setCopied({ key, id });
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(null), ms);
      },
      () => undefined
    );
  }, []);

  return { copiedId: copied?.key === resetKey ? copied.id : null, copy };
};

const CopyMiniIcon = () => (
  <svg
    className={css.RowCopyIcon}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

const HighlightedText = ({ text, query }: { text: string; query: string }) =>
  !query ? (
    <>{text}</>
  ) : (
    <>
      {splitHighlightSegments(text, query).map((seg, i) =>
        seg.match ? (
          <mark key={i} className={css.MatchMark}>
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        )
      )}
    </>
  );

type TreeRowProps = {
  gutter?: React.ReactNode;
  copy?: { label: string; copied: boolean; onClick: (el: Element) => void };
  children: React.ReactNode;
};

const TreeRow = ({ gutter, copy, children }: TreeRowProps) => (
  <div className={css.TreeLine}>
    <span className={css.TreeGutter} aria-hidden={gutter ? undefined : true}>
      {gutter}
    </span>
    <span className={css.TreeText}>{children}</span>
    {copy && (
      <button
        type="button"
        className={classNames(css.RowCopyBtn, copy.copied && css.RowCopyBtnCopied)}
        onClick={(e) => copy.onClick(e.currentTarget)}
        aria-label={copy.label}
      >
        {copy.copied ? <Icon src={Icons.Check} size="50" /> : <CopyMiniIcon />}
      </button>
    )}
  </div>
);

type TreeCtx = {
  copiedId: string | null;
  collapsed: ReadonlySet<string>;
  foldStrings: boolean;
  overrides: Readonly<Record<string, boolean>>;
  filter: TreeFilterResult | null;
  language: string;
  toggleContainer: (path: string) => void;
  toggleString: (path: string) => void;
  copy: (id: string, text: string, el: Element) => void;
};

const JsonTreeContext = React.createContext<TreeCtx | null>(null);

function JsonTreeNode({
  value,
  path,
  keyName,
  depth,
  hasTrailingComma,
}: {
  value: unknown;
  path: string;
  keyName?: string;
  depth: number;
  hasTrailingComma: boolean;
}) {
  const { t } = useTranslation();
  const ctx = useContext(JsonTreeContext);
  const foldBtnRef = useRef<HTMLButtonElement>(null);
  if (!ctx || (ctx.filter && !ctx.filter.visiblePaths.has(path))) return null;

  const query = ctx.filter?.query ?? '';
  const shownKey = keyName !== undefined ? revealDirectionControls(keyName) : undefined;
  const comma = hasTrailingComma ? <span className="token punctuation">,</span> : null;
  const keyPrefix = keyName !== undefined && (
    <>
      <span className="token property">
        &quot;
        <HighlightedText text={formatJsonStringInner(keyName)} query={query} />
        &quot;
      </span>
      <span className="token punctuation">: </span>
    </>
  );
  const rowCopy = {
    copied: ctx.copiedId === `row:${path}`,
    label:
      shownKey !== undefined
        ? t('sharedUi.eventSourceViewer.copyField', { field: shownKey })
        : t('sharedUi.eventSourceViewer.copyValue'),
    onClick: (el: Element) => ctx.copy(`row:${path}`, formatCopyValue(value), el),
  };
  const foldBtn = (collapsed: boolean, disabled: boolean, name: string, onClick: () => void) => (
    <button
      ref={foldBtnRef}
      type="button"
      className={css.FoldButton}
      disabled={disabled}
      aria-expanded={!collapsed}
      aria-label={t(
        collapsed
          ? 'sharedUi.eventSourceViewer.expandNode'
          : 'sharedUi.eventSourceViewer.collapseNode',
        { name }
      )}
      onClick={disabled ? undefined : onClick}
    >
      <Icon src={collapsed ? Icons.ChevronRight : Icons.ChevronBottom} size="50" />
    </button>
  );
  const unfoldKeepingFocus = (toggle: (p: string) => void) => {
    toggle(path);
    foldBtnRef.current?.focus();
  };

  if (value !== null && typeof value === 'object') {
    const isArray = Array.isArray(value);
    const entries = getContainerEntries(value as JsonContainer, path);
    const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
    if (entries.length === 0) {
      return (
        <TreeRow copy={rowCopy}>
          {keyPrefix}
          <span className="token punctuation">{`${open}${close}`}</span>
          {comma}
        </TreeRow>
      );
    }
    const forceOpen = ctx.filter?.autoExpandPaths.has(path) ?? false;
    const isCollapsed = !forceOpen && ctx.collapsed.has(path);
    const label = shownKey ?? `${open}${close}`;
    if (isCollapsed) {
      const summary = t(
        isArray ? 'sharedUi.eventSourceViewer.itemCount' : 'sharedUi.eventSourceViewer.keyCount',
        { count: entries.length }
      );
      return (
        <TreeRow
          gutter={foldBtn(true, false, label, () => ctx.toggleContainer(path))}
          copy={rowCopy}
        >
          {keyPrefix}
          <span className="token punctuation">{open}</span>
          <button
            type="button"
            className={css.FoldPill}
            aria-expanded={false}
            onClick={() => unfoldKeepingFocus(ctx.toggleContainer)}
          >
            <IsolatedText text={summary} />
          </button>
          <span className="token punctuation">{close}</span>
          {comma}
        </TreeRow>
      );
    }
    const visible = ctx.filter
      ? entries.filter((e) => ctx.filter!.visiblePaths.has(e.path))
      : entries;
    return (
      <div>
        <TreeRow
          gutter={foldBtn(false, forceOpen, label, () => ctx.toggleContainer(path))}
          copy={rowCopy}
        >
          {keyPrefix}
          <span className="token punctuation">{open}</span>
        </TreeRow>
        <div className={depth < MAX_INDENT_DEPTH ? css.TreeChildren : undefined}>
          {visible.map((e, i) => (
            <JsonTreeNode
              key={e.segment}
              value={e.value}
              path={e.path}
              keyName={e.key}
              depth={depth + 1}
              hasTrailingComma={i < visible.length - 1}
            />
          ))}
        </div>
        <TreeRow>
          <span className="token punctuation">{close}</span>
          {comma}
        </TreeRow>
      </div>
    );
  }

  const isLong = typeof value === 'string' && value.length > LONG_STRING_THRESHOLD;
  const matched = ctx.filter?.matchedValuePaths.has(path) ?? false;
  const folded =
    isLong &&
    !matched &&
    (Object.hasOwn(ctx.overrides, path) ? Boolean(ctx.overrides[path]) : ctx.foldStrings);
  const tokenClass =
    typeof value === 'number'
      ? 'token number'
      : typeof value === 'boolean'
      ? 'token keyword'
      : value === null
      ? 'token tag'
      : 'token string';
  const quoted = tokenClass === 'token string';
  const leafText = quoted ? formatJsonStringInner(String(value)) : String(value);
  const hint =
    typeof value === 'number' && isTimestampField(keyName, value)
      ? formatTimestampHint(value, ctx.language)
      : undefined;

  return (
    <TreeRow
      gutter={
        isLong
          ? foldBtn(folded, matched, shownKey ?? '""', () => ctx.toggleString(path))
          : undefined
      }
      copy={rowCopy}
    >
      {keyPrefix}
      {folded && typeof value === 'string' ? (
        <button
          type="button"
          className={css.StringPreviewBtn}
          onClick={() => unfoldKeepingFocus(ctx.toggleString)}
          aria-expanded={false}
        >
          <span className="token string">{makeStringSnippet(value)}</span>
        </button>
      ) : (
        <span className={tokenClass}>
          {quoted && '"'}
          <HighlightedText text={leafText} query={query} />
          {quoted && '"'}
        </span>
      )}
      {isLong && typeof value === 'string' ? (
        <span className={css.StringPillWrap}>
          <button
            type="button"
            className={css.StringLenPill}
            disabled={!folded && matched}
            aria-expanded={!folded}
            aria-label={t(
              folded
                ? 'sharedUi.eventSourceViewer.expandString'
                : 'sharedUi.eventSourceViewer.collapseString'
            )}
            onClick={!folded && matched ? undefined : () => ctx.toggleString(path)}
          >
            {folded ? (
              <IsolatedText
                text={t('sharedUi.eventSourceViewer.charCount', { count: value.length })}
              />
            ) : (
              t('sharedUi.eventSourceViewer.collapseAll')
            )}
          </button>
          {comma}
        </span>
      ) : (
        comma
      )}
      {hint && (
        <span className={classNames('token comment', css.TimestampHint)}>
          {' // '}
          <bdi>{hint}</bdi>
        </span>
      )}
    </TreeRow>
  );
}

type FoldState = {
  collapsed: Set<string> | null;
  foldStrings: boolean;
  overrides: Record<string, boolean>;
};
const INITIAL_FOLD: FoldState = { collapsed: null, foldStrings: true, overrides: {} };

type EventSourceViewerProps = { name: string; mEvent: MatrixEvent; requestClose: () => void };

export const EventSourceViewer = as<'div', EventSourceViewerProps>(
  ({ className, mEvent, name, requestClose, ...props }, ref) => {
    const { t, i18n } = useTranslation();
    const idBase = useId();
    const shownName = revealDirectionControls(name);
    const bundle = useEventSourceBundle(mEvent);

    const [selectedKind, setSelectedKind] = useState<EventSourceDocKind | undefined>(undefined);
    const [filterQuery, setFilterQuery] = useState('');
    const [fold, setFold] = useState<FoldState>(INITIAL_FOLD);
    const [rawOverride, setRawOverride] = useState<{ key: string; value: boolean } | null>(null);
    const tabRefs = useRef<Partial<Record<EventSourceDocKind, HTMLButtonElement | null>>>({});

    const activeDoc = bundle.docs.find((doc) => doc.kind === selectedKind) ?? bundle.docs[0];
    const docRawKey = `${activeDoc.kind}\0${activeDoc.rawJson}`;
    const { copiedId, copy } = useCopyFeedback(`${docRawKey}\0${bundle.rawAll}`);

    useEffect(() => {
      setSelectedKind(undefined);
      setFilterQuery('');
    }, [mEvent]);
    useEffect(() => setFold(INITIAL_FOLD), [mEvent, activeDoc.kind]);

    const summary = extractEventSummary(activeDoc.data);
    const treeExceedsLimit = useMemo(
      () => exceedsTreeNodeLimit(activeDoc.data, MAX_TREE_NODES),
      [activeDoc.data]
    );
    const isRaw =
      (rawOverride?.key === docRawKey ? rawOverride.value : undefined) ?? treeExceedsLimit;
    const structure = useMemo(
      () => (isRaw ? EMPTY_STRUCTURE : analyzeTreeStructure(activeDoc.data)),
      [activeDoc.data, isRaw]
    );
    const filter = useMemo(
      () => (isRaw ? null : computeTreeFilter(activeDoc.data, filterQuery)),
      [activeDoc.data, filterQuery, isRaw]
    );
    const revealedRaw = useMemo(
      () => (isRaw ? revealDirectionControls(activeDoc.rawJson) : ''),
      [activeDoc.rawJson, isRaw]
    );

    const toggleContainer = (path: string) =>
      setFold((s) => {
        const next = new Set(s.collapsed ?? structure.defaultCollapsed);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return { ...s, collapsed: next };
      });
    const toggleString = (path: string) =>
      setFold((s) => ({
        ...s,
        overrides: {
          ...s.overrides,
          [path]: !(Object.hasOwn(s.overrides, path) ? s.overrides[path] : s.foldStrings),
        },
      }));

    const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      const [nextKey, prevKey] = documentIsRightToLeft()
        ? ['ArrowLeft', 'ArrowRight']
        : ['ArrowRight', 'ArrowLeft'];
      const len = bundle.docs.length;
      const nextIndex =
        event.key === nextKey
          ? (index + 1) % len
          : event.key === prevKey
          ? (index - 1 + len) % len
          : event.key === 'Home'
          ? 0
          : event.key === 'End'
          ? len - 1
          : undefined;
      const nextDoc = nextIndex !== undefined ? bundle.docs[nextIndex] : undefined;
      if (!nextDoc) return;
      event.preventDefault();
      setSelectedKind(nextDoc.kind);
      tabRefs.current[nextDoc.kind]?.focus();
    };

    const metaChips = [
      summary.eventId &&
        (['event_id', 'sharedUi.eventSourceViewer.metaEventId', summary.eventId] as const),
      summary.type && (['type', 'sharedUi.eventSourceViewer.metaType', summary.type] as const),
      summary.sender &&
        (['sender', 'sharedUi.eventSourceViewer.metaSender', summary.sender] as const),
      summary.timestamp !== undefined &&
        ([
          'origin_server_ts',
          'sharedUi.eventSourceViewer.metaTime',
          String(summary.timestamp),
        ] as const),
    ].filter((c): c is Exclude<typeof c, false | '' | undefined> => Boolean(c));

    const treeCtx: TreeCtx = {
      copiedId,
      collapsed: fold.collapsed ?? structure.defaultCollapsed,
      foldStrings: fold.foldStrings,
      overrides: fold.overrides,
      filter,
      language: i18n.language,
      toggleContainer,
      toggleString,
      copy,
    };

    const hasTabs = bundle.docs.length > 1;
    const panelId = `${idBase}-panel`;
    const tabId = (kind: EventSourceDocKind) => `${idBase}-tab-${kind}`;
    const copiedAll = copiedId === 'all';

    return (
      <Box
        direction="Column"
        className={classNames(css.EventSourceViewer, className)}
        {...props}
        ref={ref}
      >
        <Header size="400" className={css.ViewerHeader}>
          <Box grow="Yes" style={{ minWidth: 0 }}>
            <Text title={shownName} truncate size="H4">
              {shownName}
            </Text>
          </Box>
          <Chip
            before={copiedAll ? <Icon src={Icons.Check} size="50" /> : undefined}
            onClick={(e: React.MouseEvent<HTMLElement>) =>
              copy('all', bundle.rawAll, e.currentTarget, COPIED_ALL_MS)
            }
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

        {(metaChips.length > 0 || bundle.isEdited || bundle.isEncrypted) && (
          <div className={css.StripBar}>
            {metaChips.map(([key, labelKey, raw]) => {
              const technical = key !== 'origin_server_ts';
              const display = technical
                ? revealDirectionControls(raw)
                : formatTimestampHint(summary.timestamp!, i18n.language) ?? raw;
              const isCopied = copiedId === `meta:${key}`;
              const label = `${t('sharedUi.eventSourceViewer.copyField', {
                field: t(labelKey),
              })}: ${display}`;
              return (
                <button
                  key={key}
                  type="button"
                  className={classNames(css.MetaChip, isCopied && css.MetaChipCopied)}
                  title={label}
                  aria-label={label}
                  onClick={(e) => copy(`meta:${key}`, raw, e.currentTarget)}
                >
                  <span className={css.MetaChipLabel}>{t(labelKey)}</span>
                  <span
                    className={classNames(
                      css.MetaChipValue,
                      technical && css.MetaChipValueTechnical
                    )}
                  >
                    {display}
                  </span>
                  {isCopied && <Icon src={Icons.Check} size="50" />}
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

        <div className={css.StripBar}>
          {hasTabs && (
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
                    id={tabId(doc.kind)}
                    ref={(el) => {
                      tabRefs.current[doc.kind] = el;
                    }}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={panelId}
                    tabIndex={selected ? 0 : -1}
                    className={classNames(css.DocTab, selected && css.DocTabActive)}
                    onClick={() => setSelectedKind(doc.kind)}
                    onKeyDown={(e) => handleTabKeyDown(e, index)}
                  >
                    {t(DOC_TAB_LABELS[doc.kind])}
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            className={css.ToolbarButton}
            disabled={isRaw}
            onClick={() =>
              setFold({
                collapsed: new Set(structure.allCollapsibleAtDepthGte1),
                foldStrings: true,
                overrides: {},
              })
            }
          >
            {t('sharedUi.eventSourceViewer.collapseAll')}
          </button>
          <button
            type="button"
            className={css.ToolbarButton}
            disabled={isRaw}
            onClick={() => setFold({ collapsed: new Set(), foldStrings: false, overrides: {} })}
          >
            {t('sharedUi.eventSourceViewer.expandAll')}
          </button>
          <button
            type="button"
            className={css.ToolbarButton}
            aria-pressed={fold.foldStrings}
            disabled={isRaw}
            onClick={() => setFold((s) => ({ ...s, foldStrings: !s.foldStrings, overrides: {} }))}
          >
            {t('sharedUi.eventSourceViewer.foldStrings')}
          </button>
          <button
            type="button"
            className={css.ToolbarButton}
            aria-pressed={isRaw}
            onClick={() => setRawOverride({ key: docRawKey, value: !isRaw })}
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
              onChange={(e) => setFilterQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && filterQuery.length > 0) {
                  e.preventDefault();
                  e.stopPropagation();
                  setFilterQuery('');
                }
              }}
            />
            {filter && (
              <span className={css.FilterCount} aria-live="polite">
                <IsolatedText
                  text={t('sharedUi.eventSourceViewer.matchCount', { count: filter.matchCount })}
                />
              </span>
            )}
          </div>
        </div>

        <PageScroll
          className={css.ViewerContent}
          id={hasTabs ? panelId : undefined}
          role={hasTabs ? 'tabpanel' : undefined}
          aria-labelledby={hasTabs ? tabId(activeDoc.kind) : undefined}
        >
          {isRaw ? (
            <pre className={classNames(css.RawPre, 'language-json')}>
              {revealedRaw.length <= MAX_RAW_HIGHLIGHT_LENGTH ? (
                <PrismCode code={revealedRaw} language="json" />
              ) : (
                <code>{revealedRaw}</code>
              )}
            </pre>
          ) : filter?.matchCount === 0 ? (
            <div className={css.EmptyFilter}>
              <IsolatedText
                text={t('sharedUi.eventSourceViewer.noMatches', { query: filter.query })}
              />
            </div>
          ) : (
            <div className={css.TreeRoot}>
              <JsonTreeContext.Provider value={treeCtx}>
                <JsonTreeNode value={activeDoc.data} path="" depth={0} hasTrailingComma={false} />
              </JsonTreeContext.Provider>
            </div>
          )}
        </PageScroll>
      </Box>
    );
  }
);
