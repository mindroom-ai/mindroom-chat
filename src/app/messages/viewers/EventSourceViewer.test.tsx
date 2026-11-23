import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { MatrixEvent } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enAdditions from '../../i18n/locales/additions/en.json';
import deAdditions from '../../i18n/locales/additions/de.json';
import { EventSourceViewer } from './EventSourceViewer';

const copyToClipboard = vi.hoisted(() => vi.fn(async (_text: string) => true));

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
  PageScroll: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../lib/dom', () => ({ copyToClipboard }));
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
  MetaStrip: 'MetaStrip',
  NoWrap: 'NoWrap',
  RawPre: 'RawPre',
  RowCopyBtn: 'RowCopyBtn',
  RowCopyBtnCopied: 'RowCopyBtnCopied',
  RowCopyIcon: 'RowCopyIcon',
  StringLenPill: 'StringLenPill',
  StringPreviewBtn: 'StringPreviewBtn',
  SubToolbar: 'SubToolbar',
  TimestampHint: 'TimestampHint',
  ToolbarButton: 'ToolbarButton',
  TreeChildren: 'TreeChildren',
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
    },
  });
  return instance;
};

const makeMockEvent = (options: {
  event: Record<string, unknown>;
  encrypted?: boolean;
  effectiveEvent?: Record<string, unknown>;
  edit?: MatrixEvent;
}): MatrixEvent =>
  ({
    event: options.event,
    isEncrypted: () => Boolean(options.encrypted),
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
    copyToClipboard.mockClear();
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
    expect(fullText).toContain('2 keys');
    expect(fullText).toContain('6 items');

    // Long string (> 120 chars) starts folded with char count pill; clicking unfolds only that string.
    const foldStringsBtn = renderer.root
      .findAllByType('button')
      .find((b) => collectText(b) === 'Fold strings');
    expect(foldStringsBtn?.props['aria-pressed']).toBe(true);

    const expandStringBtn = renderer.root.findByProps({ 'aria-label': 'Expand string' });
    expect(collectText(expandStringBtn)).toBe(`${longBody.length} chars`);
    act(() => {
      expandStringBtn.props.onClick();
    });
    expect(collectText(renderer.root)).toContain(longBody);
    // Global Fold strings toggle remains pressed after individual string toggle.
    expect(foldStringsBtn?.props['aria-pressed']).toBe(true);

    // Meta chip copy: event_id copies raw ID, origin_server_ts copies raw numeric string.
    const copyEventIdMeta = renderer.root.findAllByProps({ 'aria-label': 'Copy event_id' })[0];
    await act(async () => {
      copyEventIdMeta?.props.onClick();
    });
    expect(copyToClipboard).toHaveBeenCalledWith('$evt_garden_1');

    const copyTsMeta = renderer.root.findAllByProps({ 'aria-label': 'Copy origin_server_ts' })[0];
    await act(async () => {
      copyTsMeta?.props.onClick();
    });
    expect(copyToClipboard).toHaveBeenCalledWith('1731500000000');

    // Row copy on a string field copies raw string; row copy on an object copies formatted JSON.
    const copyBodyRow = renderer.root.findByProps({ 'aria-label': 'Copy body' });
    await act(async () => {
      copyBodyRow.props.onClick();
    });
    expect(copyToClipboard).toHaveBeenCalledWith(longBody);

    const copyUnsignedRow = renderer.root.findByProps({ 'aria-label': 'Copy unsigned' });
    await act(async () => {
      copyUnsignedRow.props.onClick();
    });
    expect(copyToClipboard).toHaveBeenCalledWith(JSON.stringify(raw.unsigned, null, 2));

    // Copy All copies active document rawJson.
    const copyAllBtn = renderer.root
      .findAllByType('button')
      .find((b) => collectText(b) === 'Copy All');
    await act(async () => {
      copyAllBtn?.props.onClick();
    });
    expect(copyToClipboard).toHaveBeenCalledWith(JSON.stringify(raw, null, 2));

    // Collapse / Expand buttons work cleanly.
    const expandAllBtn = renderer.root
      .findAllByType('button')
      .find((b) => collectText(b) === 'Expand');
    act(() => {
      expandAllBtn?.props.onClick();
    });
    expect(collectText(renderer.root)).toContain('txn_demo_99');

    const collapseAllBtn = renderer.root
      .findAllByType('button')
      .find((b) => collectText(b) === 'Collapse');
    act(() => {
      collapseAllBtn?.props.onClick();
    });
    expect(collectText(renderer.root)).not.toContain('txn_demo_99');

    renderer.unmount();
  });

  it('filters keys and values, auto-expands matching branches, highlights matches, and handles Escape', async () => {
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

    // Filter inside collapsed `unsigned` branch auto-expands it and highlights with <mark>.
    act(() => {
      input.props.onChange({ target: { value: 'txn_demo_99' } });
    });
    expect(collectText(renderer.root)).toContain('1 match');
    const marks = renderer.root.findAllByType('mark');
    expect(marks.length).toBeGreaterThan(0);
    expect(collectText(marks[0]!)).toBe('txn_demo_99');

    // Escape when filter has text clears the filter and stops propagation so modal stays open.
    const stopNonEmpty = vi.fn();
    const preventNonEmpty = vi.fn();
    act(() => {
      input.props.onKeyDown({
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

  it('switches document tabs for encrypted edited events and supports Raw Prism JSON toggle', async () => {
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
    const edit = makeMockEvent({
      event: {
        event_id: '$evt_enc_2',
        type: 'm.room.message',
        sender: '@alex:example.org',
        origin_server_ts: 1731500010000,
        content: { msgtype: 'm.text', body: '* Updated valve closed' },
      },
    });
    const mEvent = makeMockEvent({
      event: encryptedEnvelope,
      encrypted: true,
      effectiveEvent: decryptedOriginal,
      edit,
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={i18n}>
          <EventSourceViewer name="Source Code" mEvent={mEvent} requestClose={vi.fn()} />
        </I18nextProvider>
      );
    });

    // Badges for Edited and Encrypted both shown.
    const text = collectText(renderer.root);
    expect(text).toContain('Edited');
    expect(text).toContain('Encrypted');

    const tabs = renderer.root.findAllByProps({ role: 'tab' });
    expect(tabs.map((tab) => collectText(tab))).toEqual(['Original', 'Latest edit', 'Encrypted']);
    expect(tabs[0]?.props['aria-selected']).toBe(true);

    // Switch to Latest edit tab.
    act(() => {
      tabs[1]?.props.onClick();
    });
    expect(collectText(renderer.root)).toContain('$evt_enc_2');
    expect(collectText(renderer.root)).toContain('Updated valve closed');

    // Toggle Raw mode and verify Prism JSON token spans render.
    const rawBtn = renderer.root.findAllByType('button').find((b) => collectText(b) === 'Raw');
    act(() => {
      rawBtn?.props.onClick();
    });
    expect(rawBtn?.props['aria-pressed']).toBe(true);
    const code = renderer.root.findByType('code');
    const prismTokens = code
      .findAllByType('span')
      .filter((span) => String(span.props.className ?? '').includes('token'));
    expect(prismTokens.length).toBeGreaterThan(0);

    renderer.unmount();
  });

  it('defaults to Raw mode automatically when the JSON tree exceeds 5,000 nodes', async () => {
    const i18n = await createTestI18n();
    const manyItems = Array.from({ length: 5005 }, (_, index) => index);
    const mEvent = makeMockEvent({
      event: {
        event_id: '$evt_huge_1',
        type: 'm.room.message',
        content: { readings: manyItems },
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

    const rawBtn = renderer.root.findAllByType('button').find((b) => collectText(b) === 'Raw');
    expect(rawBtn?.props['aria-pressed']).toBe(true);
    expect(renderer.root.findAllByType('pre')).toHaveLength(1);

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

    const copySenderMeta = renderer.root.findAllByProps({ 'aria-label': 'Copy sender' })[0];
    await act(async () => {
      copySenderMeta?.props.onClick();
    });
    expect(copyToClipboard).toHaveBeenCalledWith(rawSender);

    const copyBodyRow = renderer.root.findByProps({ 'aria-label': 'Copy body' });
    await act(async () => {
      copyBodyRow.props.onClick();
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
});
