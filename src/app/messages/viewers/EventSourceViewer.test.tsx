import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MatrixEvent, MatrixEventEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enAdditions from '../../i18n/locales/additions/en.json';
import deAdditions from '../../i18n/locales/additions/de.json';
import arAdditions from '../../i18n/locales/additions/ar.json';
import { getAppliedEdit, installEventContentGuard } from '../../matrix/protocol/untrustedContent';
import { EventSourceViewer } from './EventSourceViewer';

const copyToClipboard = vi.hoisted(() => vi.fn(async (_text: string) => true));
const copyContainers = vi.hoisted((): unknown[] => []);

// Real events behave as in the app, where an edit that failed to decrypt is hidden from
// `replacingEvent()`.
installEventContentGuard();

/** The button a click lands on; copy handlers hand it to the clipboard helper. */
const CLICKED_BUTTON = { tagName: 'BUTTON' };
const CLICK = { currentTarget: CLICKED_BUTTON };

vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  return {
    ...actual,
    Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Icon: ({ src }: { src?: string }) => <span data-icon={src} />,
    Text: ({ children, title }: { children?: React.ReactNode; title?: string }) => (
      <span title={title}>{children}</span>
    ),
  };
});

vi.mock('../../ui/glass/GlassPrimitives', () => {
  const button = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  );
  return {
    Chip: button,
    Header: ({ children }: { children?: React.ReactNode }) => <header>{children}</header>,
    IconButton: button,
  };
});

vi.mock('../../ui/page/PageScroll', () => ({
  PageScroll: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('../../lib/dom', () => ({
  // The spy sees the text alone; the element each copy came from is kept beside it.
  copyToClipboard: (text: string, container?: unknown) => {
    copyContainers.push(container);
    return copyToClipboard(text);
  },
}));
vi.mock('../../theme/codeTokenStyles.css', () => ({}));
vi.mock('./EventSourceViewer.css', () => ({
  DocTab: 'DocTab',
  DocTabActive: 'DocTabActive',
  DocTabs: 'DocTabs',
  EmptyFilter: 'EmptyFilter',
  EventSourceViewer: 'EventSourceViewer',
  FilterCount: 'FilterCount',
  FilterGroup: 'FilterGroup',
  FilterInput: 'FilterInput',
  FoldButton: 'FoldButton',
  FoldPill: 'FoldPill',
  MatchMark: 'MatchMark',
  MetaBadge: 'MetaBadge',
  MetaBadgeEdited: 'MetaBadgeEdited',
  MetaBadgeEncrypted: 'MetaBadgeEncrypted',
  MetaChip: 'MetaChip',
  MetaChipCopied: 'MetaChipCopied',
  MetaChipLabel: 'MetaChipLabel',
  MetaChipValue: 'MetaChipValue',
  MetaChipValueTechnical: 'MetaChipValueTechnical',
  MetaStrip: 'MetaStrip',
  RawPre: 'RawPre',
  RowCopyBtn: 'RowCopyBtn',
  RowCopyBtnCopied: 'RowCopyBtnCopied',
  RowCopyIcon: 'RowCopyIcon',
  StringLenPill: 'StringLenPill',
  StringPillWrap: 'StringPillWrap',
  StringPreviewBtn: 'StringPreviewBtn',
  SubToolbar: 'SubToolbar',
  TimestampHint: 'TimestampHint',
  ToolbarButton: 'ToolbarButton',
  TreeChildren: 'TreeChildren',
  TreeChildrenFlat: 'TreeChildrenFlat',
  TreeGutter: 'TreeGutter',
  TreeLine: 'TreeLine',
  TreeNode: 'TreeNode',
  TreeRoot: 'TreeRoot',
  TreeText: 'TreeText',
  ViewerContent: 'ViewerContent',
  ViewerHeader: 'ViewerHeader',
}));

const CONTROL = /[؜‎‏‪-‮⁦-⁩]/;

const collectText = (node: ReactTestInstance | string): string => {
  if (typeof node === 'string') return node;
  return node.children.map((child) => collectText(child)).join('');
};

const createTestI18n = async () => {
  const instance = createInstance();
  await instance.init({
    lng: 'en',
    fallbackLng: 'en',
    react: { useSuspense: false },
    interpolation: { escapeValue: false },
    resources: {
      en: {
        translation: {
          sharedUi: {
            textViewer: { copyAll: 'Copy All', close: 'Close' },
            eventSourceViewer: enAdditions.sharedUi.eventSourceViewer,
          },
        },
      },
      de: {
        translation: {
          sharedUi: {
            textViewer: { copyAll: 'Alles kopieren', close: 'Schließen' },
            eventSourceViewer: deAdditions.sharedUi.eventSourceViewer,
          },
        },
      },
      ar: {
        translation: {
          sharedUi: {
            textViewer: { copyAll: 'نسخ الكل', close: 'إغلاق' },
            eventSourceViewer: arAdditions.sharedUi.eventSourceViewer,
          },
        },
      },
    },
  });
  return instance;
};

type TestI18n = Awaited<ReturnType<typeof createTestI18n>>;

const renderViewer = (
  i18n: TestI18n,
  mEvent: MatrixEvent,
  options?: Parameters<typeof create>[1],
  sibling?: React.ReactNode
): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <I18nextProvider i18n={i18n}>
        <EventSourceViewer name="Source Code" mEvent={mEvent} requestClose={vi.fn()} />
        {sibling}
      </I18nextProvider>,
      options
    );
  });
  return renderer;
};

const tabLabels = (renderer: ReactTestRenderer): string[] =>
  renderer.root.findAllByProps({ role: 'tab' }).map((tab) => collectText(tab));

const findButtonByText = (renderer: ReactTestRenderer, text: string) =>
  renderer.root.findAllByType('button').find((button) => collectText(button) === text);

const ROOM_ID = '!greenhouse:example.org';
const SENDER = '@alex:example.org';

const makeRealMessage = (
  eventId: string,
  body: string,
  extraContent: Record<string, unknown> = {}
): MatrixEvent =>
  new MatrixEvent({
    event_id: eventId,
    room_id: ROOM_ID,
    sender: SENDER,
    type: 'm.room.message',
    origin_server_ts: 1731500100000,
    content: { msgtype: 'm.text', body, ...extraContent },
  });

const makeRealEdit = (
  eventId: string,
  targetId: string,
  body: string,
  extraNewContent: Record<string, unknown> = {}
): MatrixEvent =>
  makeRealMessage(eventId, `* ${body}`, {
    'm.new_content': { msgtype: 'm.text', body, ...extraNewContent },
    'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
  });

/** Runs `run` in the commit, after the viewer rendered and before its effects subscribe. */
function RunDuringCommit({ run }: { run: () => void }) {
  React.useLayoutEffect(() => {
    run();
  }, [run]);
  return null;
}

const makeMockEvent = (options: {
  event: Record<string, unknown>;
  encrypted?: boolean;
  effectiveEvent?: Record<string, unknown>;
  decryptionFailure?: boolean;
  edit?: MatrixEvent;
}): MatrixEvent =>
  ({
    event: options.event,
    isEncrypted: () => Boolean(options.encrypted),
    isDecryptionFailure: () => Boolean(options.decryptionFailure),
    getEffectiveEvent: () => options.effectiveEvent,
    replacingEvent: () => options.edit,
  } as unknown as MatrixEvent);

const buildRichEvent = () => {
  const longBody =
    'Greenhouse sector north recorded steady soil humidity across all twelve ceramic probes after the dawn misting cycle finished without interruption.';
  const raw = {
    event_id: '$evt_garden_1',
    room_id: '!greenhouse:example.org',
    type: 'm.room.message',
    sender: '@alex:example.org',
    origin_server_ts: 1731500000000,
    content: {
      msgtype: 'm.text',
      body: longBody,
      checked_ts: 1731500060000,
      'm.mentions': { user_ids: ['@maya:example.org'] },
      'm.relates_to': { rel_type: 'm.thread', event_id: '$evt_root_1' },
      'io.mindroom.tool_trace': {
        version: 1,
        events: [{ type: 'tool_call_start', tool: 'probe' }],
      },
      readings: [21, 22, 23, 24, 25, 26],
    },
    unsigned: {
      age: 4200,
      transaction_id: 'txn_demo_99',
    },
  };
  return { raw, longBody };
};

describe('EventSourceViewer', () => {
  beforeEach(() => {
    copyToClipboard.mockReset();
    copyToClipboard.mockResolvedValue(true);
    copyContainers.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders quick-copy metadata strip, smart default folds, timestamp hints, and copies raw values', async () => {
    const i18n = await createTestI18n();
    const { raw, longBody } = buildRichEvent();
    const mEvent = makeMockEvent({ event: raw });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={i18n}>
          <EventSourceViewer name="Source Code" mEvent={mEvent} requestClose={vi.fn()} />
        </I18nextProvider>
      );
    });

    const fullText = collectText(renderer.root);
    expect(fullText).toContain('$evt_garden_1');
    expect(fullText).toContain('m.room.message');
    expect(fullText).toContain('@alex:example.org');
    // Inline timestamp hints rendered as Prism comment tokens for origin_server_ts and checked_ts.
    const comments = renderer.root
      .findAllByType('span')
      .filter((span) => String(span.props.className ?? '').includes('token comment'));
    expect(comments.length).toBe(2);

    // Smart initial collapse state: unsigned, m.mentions, m.relates_to, io.mindroom.tool_trace, readings (>5 items).
    const collapsedNames = [
      'unsigned',
      'm.mentions',
      'm.relates_to',
      'io.mindroom.tool_trace',
      'readings',
    ];
    for (const key of collapsedNames) {
      const btn = renderer.root.findByProps({ 'aria-label': `Expand ${key}` });
      expect(btn.props['aria-expanded']).toBe(false);
    }
    const foldPills = renderer.root.findAllByProps({ className: 'FoldPill' });
    expect(foldPills.length).toBe(collapsedNames.length);
    for (const pill of foldPills) {
      expect(pill.props['aria-expanded']).toBe(false);
    }
    expect(fullText).toContain('2 keys');
    expect(fullText).toContain('6 items');

    // Long string (> 120 chars) starts folded with left gutter chevron AND char count pill; clicking unfolds only that string.
    const foldStringsBtn = renderer.root
      .findAllByType('button')
      .find((b) => collectText(b) === 'Fold strings');
    expect(foldStringsBtn?.props['aria-pressed']).toBe(true);

    const bodyGutterChevron = renderer.root.findByProps({ 'aria-label': 'Expand body' });
    expect(bodyGutterChevron.props['aria-expanded']).toBe(false);

    const expandStringBtn = renderer.root.findByProps({ 'aria-label': 'Expand string' });
    expect(collectText(expandStringBtn)).toBe(`${longBody.length} chars`);
    act(() => {
      expandStringBtn.props.onClick(CLICK);
    });
    expect(collectText(renderer.root)).toContain(longBody);
    // Global Fold strings toggle remains pressed after individual string toggle.
    expect(foldStringsBtn?.props['aria-pressed']).toBe(true);

    // Meta chip copy: accessible name includes label + value; copies raw ID / numeric ms string.
    const copyEventIdMeta = renderer.root.findByProps({
      'aria-label': 'Copy Event: $evt_garden_1',
    });
    await act(async () => {
      copyEventIdMeta.props.onClick(CLICK);
    });
    expect(copyToClipboard).toHaveBeenCalledWith('$evt_garden_1');

    const copyTsMeta = renderer.root
      .findAllByType('button')
      .find((btn) => String(btn.props['aria-label'] ?? '').startsWith('Copy Time: '));
    expect(copyTsMeta).toBeDefined();
    await act(async () => {
      copyTsMeta?.props.onClick(CLICK);
    });
    expect(copyToClipboard).toHaveBeenCalledWith('1731500000000');

    // Row copy on a string field copies raw string; row copy on an object copies formatted JSON.
    const copyBodyRow = renderer.root.findByProps({ 'aria-label': 'Copy body' });
    await act(async () => {
      copyBodyRow.props.onClick(CLICK);
    });
    expect(copyToClipboard).toHaveBeenCalledWith(longBody);

    const copyUnsignedRow = renderer.root.findByProps({ 'aria-label': 'Copy unsigned' });
    await act(async () => {
      copyUnsignedRow.props.onClick(CLICK);
    });
    expect(copyToClipboard).toHaveBeenCalledWith(JSON.stringify(raw.unsigned, null, 2));

    // Root copy button copies active document JSON; Copy All copies bundle.rawAll.
    const rootCopyBtn = renderer.root.findByProps({ 'aria-label': 'Copy value' });
    await act(async () => {
      rootCopyBtn.props.onClick(CLICK);
    });
    expect(copyToClipboard).toHaveBeenCalledWith(JSON.stringify(raw, null, 2));

    const copyAllBtn = renderer.root
      .findAllByType('button')
      .find((b) => collectText(b) === 'Copy All');
    await act(async () => {
      copyAllBtn?.props.onClick(CLICK);
    });
    expect(copyToClipboard).toHaveBeenCalledWith(JSON.stringify(raw, null, 2));

    // Collapse / Expand buttons work cleanly.
    const expandAllBtn = renderer.root
      .findAllByType('button')
      .find((b) => collectText(b) === 'Expand');
    act(() => {
      expandAllBtn?.props.onClick(CLICK);
    });
    expect(collectText(renderer.root)).toContain('txn_demo_99');

    const collapseAllBtn = renderer.root
      .findAllByType('button')
      .find((b) => collectText(b) === 'Collapse');
    act(() => {
      collapseAllBtn?.props.onClick(CLICK);
    });
    expect(collectText(renderer.root)).not.toContain('txn_demo_99');

    renderer.unmount();
  });

  it('filters keys and values, disables forced-open fold buttons, and handles Escape cleanly', async () => {
    const i18n = await createTestI18n();
    const { raw } = buildRichEvent();
    const mEvent = makeMockEvent({ event: raw });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={i18n}>
          <EventSourceViewer name="Source Code" mEvent={mEvent} requestClose={vi.fn()} />
        </I18nextProvider>
      );
    });

    const input = renderer.root.findByType('input');

    // Filter inside collapsed `unsigned` branch auto-expands it, highlights with <mark>, and disables its fold button.
    act(() => {
      input.props.onChange({ target: { value: 'txn_demo_99' } });
    });
    expect(collectText(renderer.root)).toContain('1 match');
    const marks = renderer.root.findAllByType('mark');
    expect(marks.length).toBeGreaterThan(0);
    expect(collectText(marks[0]!)).toBe('txn_demo_99');

    const forcedUnsignedCollapseBtn = renderer.root.findByProps({
      'aria-label': 'Collapse unsigned',
    });
    expect(forcedUnsignedCollapseBtn.props.disabled).toBe(true);
    expect(forcedUnsignedCollapseBtn.props.onClick).toBeUndefined();

    // Filter matching a long string forces it open and disables its fold controls.
    act(() => {
      renderer.root.findByType('input').props.onChange({ target: { value: 'ceramic probes' } });
    });
    const forcedBodyChevron = renderer.root.findByProps({ 'aria-label': 'Collapse body' });
    expect(forcedBodyChevron.props.disabled).toBe(true);
    expect(forcedBodyChevron.props.onClick).toBeUndefined();
    const forcedStringCollapsePill = renderer.root.findByProps({
      'aria-label': 'Collapse string',
    });
    expect(forcedStringCollapsePill.props.disabled).toBe(true);
    expect(forcedStringCollapsePill.props.onClick).toBeUndefined();

    // Escape when filter has text clears the filter and stops propagation so modal stays open.
    const stopNonEmpty = vi.fn();
    const preventNonEmpty = vi.fn();
    act(() => {
      renderer.root.findByType('input').props.onKeyDown({
        key: 'Escape',
        stopPropagation: stopNonEmpty,
        preventDefault: preventNonEmpty,
      });
    });
    expect(stopNonEmpty).toHaveBeenCalledTimes(1);
    expect(preventNonEmpty).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByType('input').props.value).toBe('');

    // Escape when filter is already empty does NOT stop propagation (lets modal close).
    const stopEmpty = vi.fn();
    act(() => {
      renderer.root.findByType('input').props.onKeyDown({
        key: 'Escape',
        stopPropagation: stopEmpty,
        preventDefault: vi.fn(),
      });
    });
    expect(stopEmpty).not.toHaveBeenCalled();

    // Non-matching query displays empty state.
    act(() => {
      renderer.root.findByType('input').props.onChange({ target: { value: 'zz_missing_field' } });
    });
    expect(collectText(renderer.root)).toContain('No matches for “zz_missing_field”');

    renderer.unmount();
  });

  it('provides accessible tabs, keyboard navigation, all-versions Copy All, and active-tab root copy', async () => {
    const i18n = await createTestI18n();
    const decryptedOriginal = {
      event_id: '$evt_enc_1',
      type: 'm.room.message',
      sender: '@alex:example.org',
      origin_server_ts: 1731500000000,
      content: { msgtype: 'm.text', body: 'Initial valve open' },
    };
    const encryptedEnvelope = {
      event_id: '$evt_enc_1',
      type: 'm.room.encrypted',
      sender: '@alex:example.org',
      origin_server_ts: 1731500000000,
      content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'cipher-demo-1' },
    };
    const editPayload = {
      event_id: '$evt_enc_2',
      type: 'm.room.message',
      sender: '@alex:example.org',
      origin_server_ts: 1731500010000,
      content: { msgtype: 'm.text', body: '* Updated valve closed' },
    };
    const edit = makeMockEvent({ event: editPayload });
    const mEvent = makeMockEvent({
      event: encryptedEnvelope,
      encrypted: true,
      effectiveEvent: decryptedOriginal,
      edit,
    });

    const focusSpies: Record<string, ReturnType<typeof vi.fn>> = {
      Original: vi.fn(),
      'Latest edit': vi.fn(),
      Encrypted: vi.fn(),
    };

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={i18n}>
          <EventSourceViewer name="Source Code" mEvent={mEvent} requestClose={vi.fn()} />
        </I18nextProvider>,
        {
          createNodeMock: (element) => {
            if (element.type === 'button' && element.props.role === 'tab') {
              const label = String(element.props.children ?? '');
              return { focus: focusSpies[label] ?? vi.fn() };
            }
            return null;
          },
        }
      );
    });

    // Badges for Edited and Encrypted both shown.
    const text = collectText(renderer.root);
    expect(text).toContain('Edited');
    expect(text).toContain('Encrypted');

    const tabs = renderer.root.findAllByProps({ role: 'tab' });
    expect(tabs.map((tab) => collectText(tab))).toEqual(['Original', 'Latest edit', 'Encrypted']);
    expect(tabs[0]?.props['aria-selected']).toBe(true);
    expect(tabs[0]?.props.tabIndex).toBe(0);
    expect(tabs[1]?.props.tabIndex).toBe(-1);

    const panel = renderer.root.findByProps({ role: 'tabpanel' });
    expect(panel.props.id).toBe(tabs[0]?.props['aria-controls']);
    expect(panel.props['aria-labelledby']).toBe(tabs[0]?.props.id);

    // ArrowRight moves selection and focus to Latest edit; End jumps to Encrypted; Home jumps to Original.
    act(() => {
      tabs[0]?.props.onKeyDown({ key: 'ArrowRight', preventDefault: vi.fn() });
    });
    expect(focusSpies['Latest edit']).toHaveBeenCalledTimes(1);
    expect(collectText(renderer.root)).toContain('$evt_enc_2');
    expect(collectText(renderer.root)).toContain('Updated valve closed');

    // Root copy copies ONLY the active tab JSON (Latest edit).
    const rootCopyBtn = renderer.root.findByProps({ 'aria-label': 'Copy value' });
    await act(async () => {
      rootCopyBtn.props.onClick(CLICK);
    });
    expect(copyToClipboard).toHaveBeenLastCalledWith(JSON.stringify(editPayload, null, 2));

    // Header Copy All copies ALL versions (encrypted + decrypted + edit) with origin/main parity.
    const copyAllBtn = renderer.root
      .findAllByType('button')
      .find((b) => collectText(b) === 'Copy All');
    await act(async () => {
      copyAllBtn?.props.onClick(CLICK);
    });
    const copiedAllPayload = copyToClipboard.mock.calls.at(-1)?.[0] ?? '';
    expect(copiedAllPayload).toContain('"ciphertext": "cipher-demo-1"');
    expect(copiedAllPayload).toContain('"body": "Initial valve open"');
    expect(copiedAllPayload).toContain('"body": "* Updated valve closed"');

    // End / Home keyboard navigation.
    act(() => {
      renderer.root.findAllByProps({ role: 'tab' })[1]?.props.onKeyDown({
        key: 'End',
        preventDefault: vi.fn(),
      });
    });
    expect(focusSpies['Encrypted']).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ role: 'tab' })[2]?.props['aria-selected']).toBe(true);

    act(() => {
      renderer.root.findAllByProps({ role: 'tab' })[2]?.props.onKeyDown({
        key: 'Home',
        preventDefault: vi.fn(),
      });
    });
    expect(focusSpies['Original']).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ role: 'tab' })[0]?.props['aria-selected']).toBe(true);

    // Toggle Raw mode and verify Prism JSON token spans render.
    const rawBtn = renderer.root.findAllByType('button').find((b) => collectText(b) === 'Raw');
    act(() => {
      rawBtn?.props.onClick(CLICK);
    });
    expect(rawBtn?.props['aria-pressed']).toBe(true);
    const code = renderer.root.findByType('code');
    const prismTokens = code
      .findAllByType('span')
      .filter((span) => String(span.props.className ?? '').includes('token'));
    expect(prismTokens.length).toBeGreaterThan(0);

    renderer.unmount();
  });

  it('scopes Raw-mode overrides per document so toggling Raw on a small tab keeps auto-Raw on a >5,000-node tab', async () => {
    const i18n = await createTestI18n();
    const manyItems = Array.from({ length: 5005 }, (_, index) => index);
    const smallOriginal = {
      event_id: '$evt_small_1',
      type: 'm.room.message',
      content: { body: 'compact original' },
    };
    const hugeEdit = makeMockEvent({
      event: {
        event_id: '$evt_huge_edit',
        type: 'm.room.message',
        content: { readings: manyItems },
      },
    });
    const mEvent = makeMockEvent({ event: smallOriginal, edit: hugeEdit });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={i18n}>
          <EventSourceViewer name="Source Code" mEvent={mEvent} requestClose={vi.fn()} />
        </I18nextProvider>
      );
    });

    const getRawBtn = () =>
      renderer.root.findAllByType('button').find((b) => collectText(b) === 'Raw');

    // Toggle Raw ON then OFF on the small Original tab.
    expect(getRawBtn()?.props['aria-pressed']).toBe(false);
    act(() => {
      getRawBtn()?.props.onClick(CLICK);
    });
    expect(getRawBtn()?.props['aria-pressed']).toBe(true);
    act(() => {
      getRawBtn()?.props.onClick(CLICK);
    });
    expect(getRawBtn()?.props['aria-pressed']).toBe(false);

    // Switching to the >5,000-node Latest edit tab STILL auto-enables Raw mode.
    const tabs = renderer.root.findAllByProps({ role: 'tab' });
    act(() => {
      tabs[1]?.props.onClick(CLICK);
    });
    expect(getRawBtn()?.props['aria-pressed']).toBe(true);
    expect(renderer.root.findAllByType('pre')).toHaveLength(1);

    renderer.unmount();
  });

  it('preserves __proto__, constructor, and hasOwnProperty identically in tree, Raw view, Copy All, and per-field copy', async () => {
    const i18n = await createTestI18n();
    const parsed = JSON.parse(
      '{"content":{"body":"hi","__proto__":{"hidden":"payload"},"constructor":"c","hasOwnProperty":"h"}}'
    ) as Record<string, unknown>;
    const mEvent = makeMockEvent({ event: parsed });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={i18n}>
          <EventSourceViewer name="Source Code" mEvent={mEvent} requestClose={vi.fn()} />
        </I18nextProvider>
      );
    });

    // Tree view renders all three keys and nested payload.
    const treeText = collectText(renderer.root);
    expect(treeText).toContain('"__proto__":');
    expect(treeText).toContain('"hidden": "payload"');
    expect(treeText).toContain('"constructor": "c"');
    expect(treeText).toContain('"hasOwnProperty": "h"');

    // Per-field copy on __proto__ copies its formatted JSON object.
    const copyProtoBtn = renderer.root.findByProps({ 'aria-label': 'Copy __proto__' });
    await act(async () => {
      copyProtoBtn.props.onClick(CLICK);
    });
    expect(copyToClipboard).toHaveBeenLastCalledWith('{\n  "hidden": "payload"\n}');

    // Per-field copy on constructor and hasOwnProperty copies their raw strings.
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Copy constructor' }).props.onClick(CLICK);
    });
    expect(copyToClipboard).toHaveBeenLastCalledWith('c');

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Copy hasOwnProperty' }).props.onClick(CLICK);
    });
    expect(copyToClipboard).toHaveBeenLastCalledWith('h');

    // Copy All preserves all three keys identically.
    const copyAllBtn = renderer.root
      .findAllByType('button')
      .find((b) => collectText(b) === 'Copy All');
    await act(async () => {
      copyAllBtn?.props.onClick(CLICK);
    });
    const copiedAll = copyToClipboard.mock.calls.at(-1)?.[0] ?? '';
    expect(copiedAll).toContain('"__proto__"');
    expect(copiedAll).toContain('"hidden": "payload"');
    expect(copiedAll).toContain('"constructor": "c"');
    expect(copiedAll).toContain('"hasOwnProperty": "h"');

    // Raw view displays the exact same JSON.
    const rawBtn = renderer.root.findAllByType('button').find((b) => collectText(b) === 'Raw');
    act(() => {
      rawBtn?.props.onClick(CLICK);
    });
    const rawText = collectText(renderer.root.findByType('pre'));
    expect(rawText).toBe(copiedAll);

    renderer.unmount();
  });

  it('JSON-escapes quotes, backslashes, and newlines in tree view while per-field copy copies the raw string', async () => {
    const i18n = await createTestI18n();
    const specialValue = 'line 1\n"quoted" \\ end';
    const mEvent = makeMockEvent({
      event: {
        event_id: '$evt_escape_1',
        type: 'm.room.message',
        content: { body: specialValue },
      },
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={i18n}>
          <EventSourceViewer name="Source Code" mEvent={mEvent} requestClose={vi.fn()} />
        </I18nextProvider>
      );
    });

    expect(collectText(renderer.root)).toContain('"line 1\\n\\"quoted\\" \\\\ end"');

    const copyBodyBtn = renderer.root.findByProps({ 'aria-label': 'Copy body' });
    await act(async () => {
      copyBodyBtn.props.onClick(CLICK);
    });
    expect(copyToClipboard).toHaveBeenLastCalledWith(specialValue);

    renderer.unmount();
  });

  it('renders cleanly without throwing when origin_server_ts is out of Intl.DateTimeFormat range', async () => {
    const i18n = await createTestI18n();
    const mEvent = makeMockEvent({
      event: {
        event_id: '$evt_future_ts',
        type: 'm.room.message',
        sender: '@alex:example.org',
        origin_server_ts: 9e15,
        content: { body: 'far future reading' },
      },
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={i18n}>
          <EventSourceViewer name="Source Code" mEvent={mEvent} requestClose={vi.fn()} />
        </I18nextProvider>
      );
    });

    expect(collectText(renderer.root)).toContain('9000000000000000');
    const copyTsMeta = renderer.root.findByProps({
      'aria-label': 'Copy Time: 9000000000000000',
    });
    expect(copyTsMeta).toBeDefined();

    renderer.unmount();
  });

  it('updates live when a real MatrixEvent emits Decrypted or Replaced while the viewer is open', async () => {
    const i18n = await createTestI18n();
    const liveEvent = new MatrixEvent({
      event_id: '$evt_live_1',
      room_id: '!greenhouse:example.org',
      sender: '@alex:example.org',
      type: 'm.room.encrypted',
      origin_server_ts: 1731500000000,
      content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'live-cipher' },
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={i18n}>
          <EventSourceViewer name="Source Code" mEvent={liveEvent} requestClose={vi.fn()} />
        </I18nextProvider>
      );
    });

    // Initially only encrypted wire event is present (no version tabs yet).
    expect(renderer.root.findAllByProps({ role: 'tab' })).toHaveLength(0);
    expect(collectText(renderer.root)).toContain('live-cipher');

    // Decrypt live while mounted -> Decrypted + Encrypted tabs appear immediately.
    await act(async () => {
      await liveEvent.attemptDecryption({
        decryptEvent: async () => ({
          clearEvent: {
            type: 'm.room.message',
            content: { msgtype: 'm.text', body: 'Decrypted live body' },
          },
        }),
      } as never);
    });

    expect(renderer.root.findAllByProps({ role: 'tab' }).map((tab) => collectText(tab))).toEqual([
      'Decrypted',
      'Encrypted',
    ]);
    expect(collectText(renderer.root)).toContain('Decrypted live body');

    // Receive an edit live while mounted -> Original + Latest edit + Encrypted tabs appear immediately.
    const liveEdit = new MatrixEvent({
      event_id: '$evt_live_edit_2',
      room_id: '!greenhouse:example.org',
      sender: '@alex:example.org',
      type: 'm.room.message',
      origin_server_ts: 1731500005000,
      content: {
        msgtype: 'm.text',
        body: '* Live edited body',
        'm.new_content': { msgtype: 'm.text', body: 'Live edited body' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$evt_live_1' },
      },
    });
    act(() => {
      liveEvent.makeReplaced(liveEdit);
    });

    const tabsAfterEdit = renderer.root.findAllByProps({ role: 'tab' });
    expect(tabsAfterEdit.map((tab) => collectText(tab))).toEqual([
      'Original',
      'Latest edit',
      'Encrypted',
    ]);
    // Original tab retains original plaintext.
    expect(collectText(renderer.root)).toContain('Decrypted live body');

    renderer.unmount();
  });

  it('scopes copied feedback per tab and ignores stale async copy completions after switching tabs', async () => {
    const i18n = await createTestI18n();
    let resolveCopy!: (value: boolean) => void;
    copyToClipboard.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCopy = resolve;
        })
    );

    const original = {
      event_id: '$evt_tab_copy_1',
      type: 'm.room.message',
      content: { body: 'original text' },
    };
    const edit = makeMockEvent({
      event: {
        event_id: '$evt_tab_copy_2',
        type: 'm.room.message',
        content: { body: 'edited text' },
      },
    });
    const mEvent = makeMockEvent({ event: original, edit });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={i18n}>
          <EventSourceViewer name="Source Code" mEvent={mEvent} requestClose={vi.fn()} />
        </I18nextProvider>
      );
    });

    // Start copying `body` on Original tab, then switch to Latest edit before clipboard resolves.
    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Copy body' }).props.onClick(CLICK);
    });
    act(() => {
      renderer.root.findAllByProps({ role: 'tab' })[1]?.props.onClick(CLICK);
    });

    await act(async () => {
      resolveCopy(true);
    });

    // Latest edit's `Copy body` button must NOT be highlighted as copied.
    const editCopyBodyBtn = renderer.root.findByProps({ 'aria-label': 'Copy body' });
    expect(String(editCopyBodyBtn.props.className)).not.toContain('RowCopyBtnCopied');

    renderer.unmount();
  });

  it('reveals bidi direction controls in rendered output while keeping copied values raw', async () => {
    const i18n = await createTestI18n();
    const rawSender = '@alex‮_admin‬:example.org';
    const rawBody = 'sensor ‮spoof‬ ok';
    const raw = {
      event_id: '$evt_bidi_1',
      type: 'm.room.message',
      sender: rawSender,
      content: { msgtype: 'm.text', body: rawBody },
    };
    const mEvent = makeMockEvent({ event: raw });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={i18n}>
          <EventSourceViewer name={'Source‮Code'} mEvent={mEvent} requestClose={vi.fn()} />
        </I18nextProvider>
      );
    });

    const renderedJson = JSON.stringify(renderer.toJSON());
    expect(renderedJson).not.toMatch(CONTROL);
    expect(collectText(renderer.root)).toContain('Source<U+202E>Code');
    expect(collectText(renderer.root)).toContain('@alex<U+202E>_admin<U+202C>:example.org');
    expect(collectText(renderer.root)).toContain('sensor <U+202E>spoof<U+202C> ok');

    const copySenderMeta = renderer.root.findByProps({
      'aria-label': 'Copy Sender: @alex<U+202E>_admin<U+202C>:example.org',
    });
    await act(async () => {
      copySenderMeta.props.onClick(CLICK);
    });
    expect(copyToClipboard).toHaveBeenCalledWith(rawSender);

    const copyBodyRow = renderer.root.findByProps({ 'aria-label': 'Copy body' });
    await act(async () => {
      copyBodyRow.props.onClick(CLICK);
    });
    expect(copyToClipboard).toHaveBeenCalledWith(rawBody);

    renderer.unmount();
  });

  it('updates toolbar, metadata labels, and collapsed pills live when language changes', async () => {
    const i18n = await createTestI18n();
    const { raw } = buildRichEvent();
    const mEvent = makeMockEvent({ event: raw });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={i18n}>
          <EventSourceViewer name="Source Code" mEvent={mEvent} requestClose={vi.fn()} />
        </I18nextProvider>
      );
    });

    expect(collectText(renderer.root)).toContain('Fold strings');
    expect(collectText(renderer.root)).toContain('6 items');

    await act(async () => {
      await i18n.changeLanguage('de');
    });

    const germanText = collectText(renderer.root);
    expect(germanText).toContain('Texte kürzen');
    expect(germanText).toContain('6 Einträge');
    expect(germanText).toContain('Einklappen');

    renderer.unmount();
  });

  it('shows an edit that arrives between the first render and the effect that subscribes', async () => {
    const i18n = await createTestI18n();
    const target = makeRealMessage('$evt_gap_1', 'Seed trays stacked');
    const edit = makeRealEdit('$evt_gap_edit', '$evt_gap_1', 'Seed trays labelled');
    const emitted: string[] = [];
    target.on(MatrixEventEvent.Replaced, () => emitted.push('replaced'));

    // The edit lands in the commit: after the render that read the event, before any listener
    // of the viewer exists, so its Replaced event reaches no one in the viewer.
    const applyEdit = () => target.makeReplaced(edit);
    const renderer = renderViewer(i18n, target, undefined, <RunDuringCommit run={applyEdit} />);

    expect(emitted).toEqual(['replaced']);
    expect(tabLabels(renderer)).toEqual(['Original', 'Latest edit']);
    expect(collectText(renderer.root)).toContain('Edited');
    act(() => {
      renderer.root.findAllByProps({ role: 'tab' })[1]?.props.onClick(CLICK);
    });
    expect(collectText(renderer.root)).toContain('* Seed trays labelled');

    renderer.unmount();
  });

  it('updates live when an edit that failed to decrypt decrypts later', async () => {
    const i18n = await createTestI18n();
    const target = makeRealMessage('$evt_retry_1', 'Lamp timer set to six hours');
    const failedEdit = new MatrixEvent({
      event_id: '$evt_retry_edit',
      room_id: ROOM_ID,
      sender: SENDER,
      type: 'm.room.encrypted',
      origin_server_ts: 1731500200000,
      content: {
        algorithm: 'm.megolm.v1.aes-sha2',
        ciphertext: 'retry-edit-cipher',
        'm.relates_to': { rel_type: 'm.replace', event_id: '$evt_retry_1' },
      },
    });
    target.makeReplaced(failedEdit);
    await failedEdit.attemptDecryption({
      decryptEvent: () => Promise.reject(new Error('withheld key')),
    } as never);

    // The content guard hides the failed edit from replacingEvent(); the SDK still holds it.
    expect(target.replacingEvent()).toBeNull();
    expect(getAppliedEdit(target)).toBe(failedEdit);

    const renderer = renderViewer(i18n, target);
    expect(tabLabels(renderer)).toEqual([]);
    expect(collectText(renderer.root)).not.toContain('Edited');

    await act(async () => {
      await failedEdit.attemptDecryption(
        {
          decryptEvent: async () => ({
            clearEvent: {
              type: 'm.room.message',
              content: {
                msgtype: 'm.text',
                body: '* Lamp timer set to eight hours',
                'm.new_content': { msgtype: 'm.text', body: 'Lamp timer set to eight hours' },
              },
            },
          }),
        } as never,
        { isRetry: true }
      );
    });

    expect(tabLabels(renderer)).toEqual(['Original', 'Latest edit']);
    expect(collectText(renderer.root)).toContain('Edited');
    act(() => {
      renderer.root.findAllByProps({ role: 'tab' })[1]?.props.onClick(CLICK);
    });
    expect(collectText(renderer.root)).toContain('* Lamp timer set to eight hours');

    // The listener leaves the edit with the viewer.
    expect(failedEdit.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);
    act(() => {
      renderer.unmount();
    });
    expect(failedEdit.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    expect(target.listenerCount(MatrixEventEvent.Replaced)).toBe(0);
  });

  it('follows a newer edit, a server event ID and a redaction while open', async () => {
    const i18n = await createTestI18n();
    const target = makeRealMessage('~local_echo_1', 'Mist nozzle checked');
    const firstEdit = makeRealEdit('$evt_follow_edit_1', '~local_echo_1', 'Mist nozzle cleaned');
    target.makeReplaced(firstEdit);
    const renderer = renderViewer(i18n, target);
    expect(firstEdit.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);

    // A newer edit: the Decrypted listener moves from the old edit to the new one.
    const secondEdit = makeRealEdit('$evt_follow_edit_2', '~local_echo_1', 'Mist nozzle replaced');
    act(() => {
      target.makeReplaced(secondEdit);
    });
    expect(firstEdit.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    expect(secondEdit.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);

    // The local echo gets its server event ID.
    expect(collectText(renderer.root)).toContain('~local_echo_1');
    act(() => {
      target.replaceLocalEventId('$evt_follow_server_1');
    });
    expect(collectText(renderer.root)).toContain('$evt_follow_server_1');
    expect(collectText(renderer.root)).not.toContain('~local_echo_1');

    // A redaction strips the event after BeforeRedaction fires, and takes its edit with it.
    const redaction = new MatrixEvent({
      event_id: '$evt_follow_redaction',
      room_id: ROOM_ID,
      sender: SENDER,
      type: 'm.room.redaction',
      origin_server_ts: 1731500300000,
      redacts: '$evt_follow_server_1',
      content: {},
    });
    await act(async () => {
      target.makeRedacted(redaction, {} as never);
    });
    expect(tabLabels(renderer)).toEqual([]);
    expect(collectText(renderer.root)).not.toContain('Mist nozzle checked');
    expect(collectText(renderer.root)).toContain('"content": {}');
    expect(collectText(renderer.root)).not.toContain('Edited');
    // The edit went with the redaction, and so did its listener.
    expect(secondEdit.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);

    act(() => {
      renderer.unmount();
    });
    expect(target.listenerCount(MatrixEventEvent.BeforeRedaction)).toBe(0);
  });

  it('shows another event at once when its event prop changes, and moves its listeners', async () => {
    const i18n = await createTestI18n();
    const first = makeRealMessage('$evt_swap_1', 'Heater on');
    const second = makeRealMessage('$evt_swap_2', 'Heater off');
    const viewerOf = (mEvent: MatrixEvent) => (
      <I18nextProvider i18n={i18n}>
        <EventSourceViewer name="Source Code" mEvent={mEvent} requestClose={vi.fn()} />
      </I18nextProvider>
    );
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(viewerOf(first));
    });
    expect(collectText(renderer.root)).toContain('Heater on');
    expect(first.listenerCount(MatrixEventEvent.Replaced)).toBe(1);

    act(() => {
      renderer.update(viewerOf(second));
    });
    expect(collectText(renderer.root)).toContain('Heater off');
    expect(collectText(renderer.root)).not.toContain('Heater on');
    expect(first.listenerCount(MatrixEventEvent.Replaced)).toBe(0);
    expect(second.listenerCount(MatrixEventEvent.Replaced)).toBe(1);

    // Only the event that shows updates the viewer.
    act(() => {
      first.makeReplaced(makeRealEdit('$evt_swap_edit_1', '$evt_swap_1', 'Heater idle'));
    });
    expect(tabLabels(renderer)).toEqual([]);
    act(() => {
      second.makeReplaced(makeRealEdit('$evt_swap_edit_2', '$evt_swap_2', 'Heater eco'));
    });
    expect(tabLabels(renderer)).toEqual(['Original', 'Latest edit']);

    act(() => {
      renderer.unmount();
    });
  });

  it('drops a Raw override when a live edit replaces the document, so a >5,000-node edit opens in Raw', async () => {
    const i18n = await createTestI18n();
    const target = makeRealMessage('$evt_raw_1', 'Bench three readings');
    target.makeReplaced(makeRealEdit('$evt_raw_edit_small', '$evt_raw_1', 'Bench three, short'));
    const renderer = renderViewer(i18n, target);
    const rawPressed = () => findButtonByText(renderer, 'Raw')?.props['aria-pressed'];

    // On the small Latest edit: Raw on, then off, which leaves an override of "not raw".
    act(() => {
      renderer.root.findAllByProps({ role: 'tab' })[1]?.props.onClick(CLICK);
    });
    expect(rawPressed()).toBe(false);
    act(() => {
      findButtonByText(renderer, 'Raw')?.props.onClick(CLICK);
    });
    expect(rawPressed()).toBe(true);
    act(() => {
      findButtonByText(renderer, 'Raw')?.props.onClick(CLICK);
    });
    expect(rawPressed()).toBe(false);

    // A new edit with more than 5,000 nodes replaces it live: the old override does not apply.
    const hugeEdit = makeRealEdit('$evt_raw_edit_huge', '$evt_raw_1', 'Bench three, full log', {
      readings: Array.from({ length: 5005 }, (_, index) => index),
    });
    act(() => {
      target.makeReplaced(hugeEdit);
    });
    expect(
      renderer.root.findAllByProps({ role: 'tab' }).map((tab) => tab.props['aria-selected'])
    ).toEqual([false, true]);
    expect(rawPressed()).toBe(true);
    expect(renderer.root.findAllByType('pre')).toHaveLength(1);

    renderer.unmount();
  });

  it('shows no copied mark on a value that a live edit changed while its copy was pending', async () => {
    const i18n = await createTestI18n();
    const target = makeRealMessage('$evt_stale_1', 'Fan speed low');
    target.makeReplaced(makeRealEdit('$evt_stale_edit_1', '$evt_stale_1', 'Fan speed medium'));
    const renderer = renderViewer(i18n, target);
    act(() => {
      renderer.root.findAllByProps({ role: 'tab' })[1]?.props.onClick(CLICK);
    });
    // The edit's own body; its m.new_content holds a second one.
    const copyBody = () => renderer.root.findAllByProps({ 'aria-label': 'Copy body' })[0]!;
    const copyEventId = () =>
      renderer.root
        .findAllByType('button')
        .find((button) => String(button.props['aria-label'] ?? '').startsWith('Copy Event: '));
    const copyAll = () => findButtonByText(renderer, 'Copy All');

    // A copy that finishes while its value still shows is marked, here and on the other controls.
    await act(async () => {
      copyBody().props.onClick(CLICK);
    });
    expect(String(copyBody().props.className)).toContain('RowCopyBtnCopied');
    await act(async () => {
      copyEventId()?.props.onClick(CLICK);
    });
    expect(String(copyEventId()?.props.className)).toContain('MetaChipCopied');
    await act(async () => {
      copyAll()?.props.onClick(CLICK);
    });
    expect(copyAll()?.props.variant).toBe('Success');

    // A live edit changes the value at each of those places: none inherits the mark.
    act(() => {
      target.makeReplaced(makeRealEdit('$evt_stale_edit_2', '$evt_stale_1', 'Fan speed high'));
    });
    expect(String(copyBody().props.className)).not.toContain('RowCopyBtnCopied');
    expect(String(copyEventId()?.props.className)).not.toContain('MetaChipCopied');
    expect(copyAll()?.props.variant).toBe('Primary');

    // Copies still pending when the next edit lands finish without a mark on the new values.
    const pending: Array<(ok: boolean) => void> = [];
    copyToClipboard.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          pending.push(resolve);
        })
    );
    act(() => {
      copyBody().props.onClick(CLICK);
      copyEventId()?.props.onClick(CLICK);
      copyAll()?.props.onClick(CLICK);
    });
    expect(copyToClipboard).toHaveBeenCalledWith('* Fan speed high');
    act(() => {
      target.makeReplaced(makeRealEdit('$evt_stale_edit_3', '$evt_stale_1', 'Fan speed off'));
    });
    await act(async () => {
      pending.forEach((resolve) => resolve(true));
    });
    expect(collectText(renderer.root)).toContain('* Fan speed off');
    expect(String(copyBody().props.className)).not.toContain('RowCopyBtnCopied');
    expect(String(copyEventId()?.props.className)).not.toContain('MetaChipCopied');
    expect(copyAll()?.props.variant).toBe('Primary');

    renderer.unmount();
  });

  it('hands the clicked button to the clipboard helper for every copy', async () => {
    const i18n = await createTestI18n();
    const renderer = renderViewer(i18n, makeRealMessage('$evt_container_1', 'Shade cloth up'));
    const click = (label: string) => ({ currentTarget: { label } });

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Copy body' }).props.onClick(click('row'));
    });
    await act(async () => {
      renderer.root
        .findByProps({ 'aria-label': 'Copy Event: $evt_container_1' })
        .props.onClick(click('meta'));
    });
    await act(async () => {
      findButtonByText(renderer, 'Copy All')?.props.onClick(click('all'));
    });
    expect(copyContainers).toEqual([{ label: 'row' }, { label: 'meta' }, { label: 'all' }]);

    renderer.unmount();
  });

  it('reverses ArrowLeft and ArrowRight on the tabs in a right-to-left document', async () => {
    const i18n = await createTestI18n();
    const edit = makeMockEvent({
      event: { event_id: '$evt_rtl_edit', type: 'm.room.message', content: { body: '* edited' } },
    });
    const mEvent = makeMockEvent({
      event: {
        event_id: '$evt_rtl_1',
        type: 'm.room.encrypted',
        content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'rtl-cipher-demo' },
      },
      encrypted: true,
      effectiveEvent: {
        event_id: '$evt_rtl_1',
        type: 'm.room.message',
        content: { body: 'original' },
      },
      edit,
    });
    const renderer = renderViewer(i18n, mEvent, { createNodeMock: () => ({ focus: vi.fn() }) });
    const selectedTab = () =>
      collectText(
        renderer.root.findAllByProps({ role: 'tab' }).find((tab) => tab.props['aria-selected'])!
      );
    const press = (key: string) => {
      const tab = renderer.root
        .findAllByProps({ role: 'tab' })
        .find((candidate) => candidate.props['aria-selected']);
      act(() => {
        tab?.props.onKeyDown({ key, preventDefault: vi.fn() });
      });
    };
    expect(tabLabels(renderer)).toEqual(['Original', 'Latest edit', 'Encrypted']);

    // Left to right: ArrowRight is the next tab.
    press('ArrowRight');
    expect(selectedTab()).toBe('Latest edit');
    press('ArrowLeft');
    expect(selectedTab()).toBe('Original');

    // Right to left: the tabs run from the right, so ArrowLeft is the next tab.
    vi.stubGlobal('document', { documentElement: { dir: 'rtl' } });
    press('ArrowLeft');
    expect(selectedTab()).toBe('Latest edit');
    press('ArrowLeft');
    expect(selectedTab()).toBe('Encrypted');
    press('ArrowLeft');
    expect(selectedTab()).toBe('Original');
    press('ArrowRight');
    expect(selectedTab()).toBe('Encrypted');
    press('ArrowRight');
    expect(selectedTab()).toBe('Latest edit');
    press('Home');
    expect(selectedTab()).toBe('Original');
    press('End');
    expect(selectedTab()).toBe('Encrypted');

    renderer.unmount();
  });

  it('isolates technical values, timestamps and translated counts from the interface direction', async () => {
    const i18n = await createTestI18n();
    await i18n.changeLanguage('ar');
    const { raw } = buildRichEvent();
    const renderer = renderViewer(i18n, makeMockEvent({ event: raw }));
    const isolates = /[\u2066-\u2069]/;

    // Event ID, type and sender read left to right; the localized time keeps the document's side.
    const chipValueClasses = renderer.root
      .findAllByType('span')
      .map((span) => String(span.props.className ?? ''))
      .filter((className) => className.includes('MetaChipValue'));
    expect(chipValueClasses).toEqual([
      'MetaChipValue MetaChipValueTechnical',
      'MetaChipValue MetaChipValueTechnical',
      'MetaChipValue MetaChipValueTechnical',
      'MetaChipValue',
    ]);

    // The date of an inline timestamp hint sits in a <bdi>.
    const hints = renderer.root
      .findAllByType('span')
      .filter((span) => String(span.props.className ?? '').includes('token comment'));
    expect(hints).toHaveLength(2);
    for (const hint of hints) {
      expect(collectText(hint).startsWith(' // ')).toBe(true);
      expect(collectText(hint.findByType('bdi')).length).toBeGreaterThan(0);
    }

    // The Arabic counts carry isolates in their translations; they render as <bdi>, not as text.
    expect(arAdditions.sharedUi.eventSourceViewer.itemCount_few).toMatch(isolates);
    const pills = renderer.root.findAllByProps({ className: 'FoldPill' });
    expect(pills.length).toBeGreaterThan(0);
    for (const pill of pills) {
      expect(pill.findAllByType('bdi')).toHaveLength(1);
      expect(collectText(pill)).not.toMatch(isolates);
    }
    const charPill = renderer.root.findAllByProps({ className: 'StringLenPill' })[0]!;
    expect(collectText(charPill.findByType('bdi'))).toBe('146');
    expect(collectText(charPill)).not.toMatch(isolates);

    const input = renderer.root.findByType('input');
    act(() => {
      input.props.onChange({ target: { value: 'txn_demo_99' } });
    });
    const matchCount = renderer.root.findByProps({ className: 'FilterCount' });
    expect(collectText(matchCount.findByType('bdi'))).toBe('1');
    expect(collectText(matchCount)).not.toMatch(isolates);

    act(() => {
      input.props.onChange({ target: { value: 'zz_missing_field' } });
    });
    const empty = renderer.root.findByProps({ className: 'EmptyFilter' });
    expect(collectText(empty.findByType('bdi'))).toBe('zz_missing_field');
    expect(collectText(empty)).not.toMatch(isolates);

    renderer.unmount();
  });

  it('moves focus to the row’s gutter button when a collapsed pill or folded string preview unfolds', async () => {
    const i18n = await createTestI18n();
    const { raw, longBody } = buildRichEvent();
    const focused: string[] = [];
    const renderer = renderViewer(i18n, makeMockEvent({ event: raw }), {
      createNodeMock: (element) =>
        element.props.className === 'FoldButton'
          ? { focus: () => focused.push(String(element.props['aria-label'])) }
          : null,
    });

    // The collapsed pill unmounts as its container opens: focus goes to that row's chevron.
    const unsignedPill = renderer.root.findAllByProps({ className: 'FoldPill' }).at(-1);
    expect(collectText(unsignedPill!)).toBe('2 keys');
    act(() => {
      unsignedPill?.props.onClick(CLICK);
    });
    expect(collectText(renderer.root)).toContain('txn_demo_99');
    expect(focused).toEqual(['Expand unsigned']);

    // The folded string preview unmounts as the string opens: focus goes to its chevron.
    act(() => {
      renderer.root.findByProps({ className: 'StringPreviewBtn' }).props.onClick(CLICK);
    });
    expect(collectText(renderer.root)).toContain(longBody);
    expect(focused).toEqual(['Expand unsigned', 'Expand body']);

    // The chevron itself stays mounted and keeps its own focus.
    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Collapse unsigned' }).props.onClick(CLICK);
    });
    expect(focused).toHaveLength(2);

    renderer.unmount();
  });
});
