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

installEventContentGuard();

const CLICK = { currentTarget: { tagName: 'BUTTON' } };
const CONTROL = /[؜‎‏‪-‮⁦-⁩]/;
const ROOM_ID = '!greenhouse:example.org';
const SENDER = '@alex:example.org';

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
  const Btn = ({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...p}>
      {children}
    </button>
  );
  return {
    Chip: Btn,
    Header: ({ children }: { children?: React.ReactNode }) => <header>{children}</header>,
    IconButton: Btn,
  };
});

vi.mock('../../ui/page/PageScroll', () => ({
  PageScroll: ({ children, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...p}>{children}</div>
  ),
}));

vi.mock('../../lib/dom', () => ({
  copyToClipboard: (text: string, container?: unknown) => {
    copyContainers.push(container);
    return copyToClipboard(text);
  },
}));
vi.mock('../../theme/codeTokenStyles.css', () => ({}));
vi.mock('./EventSourceViewer.css', () =>
  Object.fromEntries(
    [
      'DocTab',
      'DocTabActive',
      'DocTabs',
      'EmptyFilter',
      'EventSourceViewer',
      'FilterCount',
      'FilterGroup',
      'FilterInput',
      'FoldButton',
      'FoldPill',
      'MatchMark',
      'MetaBadgeEdited',
      'MetaBadgeEncrypted',
      'MetaChip',
      'MetaChipCopied',
      'MetaChipLabel',
      'MetaChipValue',
      'MetaChipValueTechnical',
      'RawPre',
      'RowCopyBtn',
      'RowCopyBtnCopied',
      'RowCopyIcon',
      'StripBar',
      'StringLenPill',
      'StringPillWrap',
      'StringPreviewBtn',
      'TimestampHint',
      'ToolbarButton',
      'TreeChildren',
      'TreeGutter',
      'TreeLine',
      'TreeRoot',
      'TreeText',
      'ViewerContent',
      'ViewerHeader',
    ].map((k) => [k, k])
  )
);

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

const createTestI18n = async () => {
  const res = (copyAll: string, close: string, eventSourceViewer: unknown) => ({
    translation: { sharedUi: { textViewer: { copyAll, close }, eventSourceViewer } },
  });
  const instance = createInstance();
  await instance.init({
    lng: 'en',
    fallbackLng: 'en',
    react: { useSuspense: false },
    interpolation: { escapeValue: false },
    resources: {
      en: res('Copy All', 'Close', enAdditions.sharedUi.eventSourceViewer),
      de: res('Alles kopieren', 'Schließen', deAdditions.sharedUi.eventSourceViewer),
      ar: res('نسخ الكل', 'إغلاق', arAdditions.sharedUi.eventSourceViewer),
    },
  });
  return instance;
};
type TestI18n = Awaited<ReturnType<typeof createTestI18n>>;

const renderViewer = (
  i18n: TestI18n,
  mEvent: MatrixEvent,
  opts?: { name?: string; options?: Parameters<typeof create>[1]; sibling?: React.ReactNode }
): ReactTestRenderer => {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <I18nextProvider i18n={i18n}>
        <EventSourceViewer
          name={opts?.name ?? 'Source Code'}
          mEvent={mEvent}
          requestClose={vi.fn()}
        />
        {opts?.sibling}
      </I18nextProvider>,
      opts?.options
    );
  });
  return r;
};

const tabsOf = (r: ReactTestRenderer) => r.root.findAllByProps({ role: 'tab' });
const tabLabels = (r: ReactTestRenderer) => tabsOf(r).map(textOf);
const btnByText = (r: ReactTestRenderer, label: string) =>
  r.root.findAllByType('button').find((b) => textOf(b) === label);
const byLabel = (r: ReactTestRenderer, label: string) =>
  r.root.findByProps({ 'aria-label': label });
const click = (el: ReactTestInstance | undefined, ev: unknown = CLICK): void => {
  act(() => {
    el?.props.onClick(ev);
  });
};
const clickAsync = async (
  el: ReactTestInstance | undefined,
  ev: unknown = CLICK
): Promise<void> => {
  await act(async () => {
    el?.props.onClick(ev);
  });
};
const setFilter = (r: ReactTestRenderer, value: string): void => {
  act(() => {
    r.root.findByType('input').props.onChange({ target: { value } });
  });
};

const makePlainEvent = (
  eventId: string,
  body: string,
  extraContent: Record<string, unknown> = {},
  extraTop: Record<string, unknown> = {}
) =>
  new MatrixEvent({
    event_id: eventId,
    room_id: ROOM_ID,
    sender: SENDER,
    type: 'm.room.message',
    origin_server_ts: 1731500100000,
    content: { msgtype: 'm.text', body, ...extraContent },
    ...extraTop,
  });

const makeEditEvent = (
  eventId: string,
  targetId: string,
  body: string,
  extraNewContent: Record<string, unknown> = {}
) =>
  makePlainEvent(eventId, `* ${body}`, {
    'm.new_content': { msgtype: 'm.text', body, ...extraNewContent },
    'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
  });

const makeRichEvent = () => {
  const longBody =
    'Greenhouse sector north recorded steady soil humidity across all twelve ceramic probes after the dawn misting cycle finished without interruption.';
  const ev = makePlainEvent(
    '$evt_garden_1',
    longBody,
    {
      checked_ts: 1731500060000,
      'm.mentions': { user_ids: ['@maya:example.org'] },
      'm.relates_to': { rel_type: 'm.thread', event_id: '$evt_root_1' },
      'io.mindroom.tool_trace': {
        version: 1,
        events: [{ type: 'tool_call_start', tool: 'probe' }],
      },
      readings: [21, 22, 23, 24, 25, 26],
      note: 'line 1\n"quoted" \\ end',
    },
    { origin_server_ts: 1731500000000, unsigned: { age: 4200, transaction_id: 'txn_demo_99' } }
  );
  return { ev, longBody };
};

const makeEncryptedEditedEvent = async () => {
  const ev = new MatrixEvent({
    event_id: '$evt_enc_1',
    room_id: ROOM_ID,
    sender: SENDER,
    type: 'm.room.encrypted',
    origin_server_ts: 1731500000000,
    content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'cipher-demo-1' },
  });
  await ev.attemptDecryption({
    decryptEvent: async () => ({
      clearEvent: {
        type: 'm.room.message',
        content: { msgtype: 'm.text', body: 'Initial valve open' },
      },
    }),
  } as never);
  const edit = makeEditEvent('$evt_enc_2', '$evt_enc_1', 'Updated valve closed');
  ev.makeReplaced(edit);
  return { ev, edit };
};

function RunDuringCommit({ run }: { run: () => void }) {
  React.useLayoutEffect(() => {
    run();
  }, [run]);
  return null;
}

describe('EventSourceViewer', () => {
  beforeEach(() => {
    copyToClipboard.mockReset().mockResolvedValue(true);
    copyContainers.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders metadata strip, smart default folds, timestamp hints, escaping, long-string unfold, Collapse/Expand, and copy actions', async () => {
    const i18n = await createTestI18n();
    const { ev, longBody } = makeRichEvent();
    const r = renderViewer(i18n, ev);

    const text = textOf(r.root);
    for (const s of [
      '$evt_garden_1',
      'm.room.message',
      SENDER,
      '"line 1\\n\\"quoted\\" \\\\ end"',
      '2 keys',
      '6 items',
    ]) {
      expect(text).toContain(s);
    }
    expect(
      r.root
        .findAllByType('span')
        .filter((s) => String(s.props.className ?? '').includes('token comment'))
    ).toHaveLength(2);

    const collapsed = [
      'unsigned',
      'm.mentions',
      'm.relates_to',
      'io.mindroom.tool_trace',
      'readings',
    ];
    for (const key of collapsed) {
      expect(byLabel(r, `Expand ${key}`).props['aria-expanded']).toBe(false);
    }
    expect(r.root.findAllByProps({ className: 'FoldPill' })).toHaveLength(collapsed.length);

    // Long string starts folded; unfolding keeps global Fold strings toggle pressed.
    expect(btnByText(r, 'Fold strings')?.props['aria-pressed']).toBe(true);
    expect(byLabel(r, 'Expand body').props['aria-expanded']).toBe(false);
    const expandStr = byLabel(r, 'Expand string');
    expect(textOf(expandStr)).toBe(`${longBody.length} chars`);
    click(expandStr);
    expect(textOf(r.root)).toContain(longBody);
    expect(btnByText(r, 'Fold strings')?.props['aria-pressed']).toBe(true);

    // Meta, raw string, object, root, Copy All, and container forwarding.
    const tgt = (label: string) => ({ currentTarget: { label } });
    await clickAsync(byLabel(r, 'Copy Event: $evt_garden_1'), tgt('meta'));
    expect(copyToClipboard).toHaveBeenLastCalledWith('$evt_garden_1');
    const tsMeta = r.root
      .findAllByType('button')
      .find((b) => String(b.props['aria-label'] ?? '').startsWith('Copy Time: '));
    await clickAsync(tsMeta, tgt('ts'));
    expect(copyToClipboard).toHaveBeenLastCalledWith('1731500000000');
    await clickAsync(byLabel(r, 'Copy note'), tgt('row'));
    expect(copyToClipboard).toHaveBeenLastCalledWith('line 1\n"quoted" \\ end');
    await clickAsync(byLabel(r, 'Copy unsigned'), tgt('obj'));
    expect(copyToClipboard).toHaveBeenLastCalledWith(JSON.stringify(ev.event.unsigned, null, 2));
    await clickAsync(byLabel(r, 'Copy value'), tgt('root'));
    expect(copyToClipboard).toHaveBeenLastCalledWith(JSON.stringify(ev.event, null, 2));
    await clickAsync(btnByText(r, 'Copy All'), tgt('all'));
    expect(copyToClipboard).toHaveBeenLastCalledWith(JSON.stringify(ev.event, null, 2));
    expect(copyContainers.map((c) => (c as { label: string }).label)).toEqual([
      'meta',
      'ts',
      'row',
      'obj',
      'root',
      'all',
    ]);

    click(btnByText(r, 'Expand'));
    expect(textOf(r.root)).toContain('txn_demo_99');
    click(btnByText(r, 'Collapse'));
    expect(textOf(r.root)).not.toContain('txn_demo_99');
    r.unmount();

    // Out-of-range timestamp renders cleanly without throwing.
    const rFar = renderViewer(
      i18n,
      makePlainEvent('$evt_future', 'far', {}, { origin_server_ts: 9e15 })
    );
    expect(byLabel(rFar, 'Copy Time: 9000000000000000')).toBeDefined();
    rFar.unmount();
  });

  it('filters keys and values, disables forced-open fold buttons, and handles Escape cleanly', async () => {
    const i18n = await createTestI18n();
    const r = renderViewer(i18n, makeRichEvent().ev);

    setFilter(r, 'txn_demo_99');
    expect(textOf(r.root)).toContain('1 match');
    expect(textOf(r.root.findAllByType('mark')[0]!)).toBe('txn_demo_99');
    const forcedUnsigned = byLabel(r, 'Collapse unsigned');
    expect(forcedUnsigned.props.disabled).toBe(true);
    expect(forcedUnsigned.props.onClick).toBeUndefined();

    setFilter(r, 'ceramic probes');
    expect(byLabel(r, 'Collapse body').props.disabled).toBe(true);
    expect(byLabel(r, 'Collapse string').props.disabled).toBe(true);

    const stopNonEmpty = vi.fn();
    const preventNonEmpty = vi.fn();
    act(() => {
      r.root.findByType('input').props.onKeyDown({
        key: 'Escape',
        stopPropagation: stopNonEmpty,
        preventDefault: preventNonEmpty,
      });
    });
    expect(stopNonEmpty).toHaveBeenCalledTimes(1);
    expect(preventNonEmpty).toHaveBeenCalledTimes(1);
    expect(r.root.findByType('input').props.value).toBe('');

    const stopEmpty = vi.fn();
    act(() => {
      r.root.findByType('input').props.onKeyDown({
        key: 'Escape',
        stopPropagation: stopEmpty,
        preventDefault: vi.fn(),
      });
    });
    expect(stopEmpty).not.toHaveBeenCalled();

    setFilter(r, 'zz_missing_field');
    expect(textOf(r.root)).toContain('No matches for “zz_missing_field”');
    r.unmount();
  });

  it('supports accessible LTR/RTL tab navigation, focus preservation on unfold, Raw Prism tokens, and active-tab vs Copy All', async () => {
    const i18n = await createTestI18n();
    const { ev, edit } = await makeEncryptedEditedEvent();
    const focusSpies: Record<string, ReturnType<typeof vi.fn>> = {
      Original: vi.fn(),
      'Latest edit': vi.fn(),
      Encrypted: vi.fn(),
    };
    const r = renderViewer(i18n, ev, {
      options: {
        createNodeMock: (el) =>
          el.type === 'button' && el.props.role === 'tab'
            ? { focus: focusSpies[String(el.props.children ?? '')] ?? vi.fn() }
            : null,
      },
    });

    expect(textOf(r.root)).toContain('Edited');
    expect(textOf(r.root)).toContain('Encrypted');
    expect(tabLabels(r)).toEqual(['Original', 'Latest edit', 'Encrypted']);
    const panel = r.root.findByProps({ role: 'tabpanel' });
    expect(panel.props.id).toBe(tabsOf(r)[0]?.props['aria-controls']);
    expect(panel.props['aria-labelledby']).toBe(tabsOf(r)[0]?.props.id);

    const selectedTab = () => textOf(tabsOf(r).find((t) => t.props['aria-selected'])!);
    const pressTab = (key: string): void => {
      act(() => {
        tabsOf(r)
          .find((t) => t.props['aria-selected'])
          ?.props.onKeyDown({ key, preventDefault: vi.fn() });
      });
    };

    pressTab('ArrowRight');
    expect(selectedTab()).toBe('Latest edit');
    expect(focusSpies['Latest edit']).toHaveBeenCalledTimes(1);

    await clickAsync(byLabel(r, 'Copy value'));
    expect(copyToClipboard).toHaveBeenLastCalledWith(JSON.stringify(edit.event, null, 2));
    await clickAsync(btnByText(r, 'Copy All'));
    const copiedAll = copyToClipboard.mock.calls.at(-1)?.[0] ?? '';
    expect(copiedAll).toContain('"ciphertext": "cipher-demo-1"');
    expect(copiedAll).toContain('"body": "Initial valve open"');
    expect(copiedAll).toContain('"body": "* Updated valve closed"');

    vi.stubGlobal('document', { documentElement: { dir: 'rtl' } });
    pressTab('ArrowLeft');
    expect(selectedTab()).toBe('Encrypted');
    pressTab('ArrowRight');
    expect(selectedTab()).toBe('Latest edit');
    pressTab('Home');
    expect(selectedTab()).toBe('Original');
    pressTab('End');
    expect(selectedTab()).toBe('Encrypted');

    click(btnByText(r, 'Raw'));
    expect(btnByText(r, 'Raw')?.props['aria-pressed']).toBe(true);
    expect(
      r.root
        .findByType('code')
        .findAllByType('span')
        .filter((s) => String(s.props.className ?? '').includes('token')).length
    ).toBeGreaterThan(0);
    r.unmount();

    // Unfolding a collapsed pill or folded string moves focus to that row's gutter chevron.
    const { ev: rich, longBody } = makeRichEvent();
    const focused: string[] = [];
    const rFocus = renderViewer(i18n, rich, {
      options: {
        createNodeMock: (el) =>
          el.props.className === 'FoldButton'
            ? { focus: () => focused.push(String(el.props['aria-label'])) }
            : null,
      },
    });
    click(rFocus.root.findAllByProps({ className: 'FoldPill' }).at(-1));
    expect(textOf(rFocus.root)).toContain('txn_demo_99');
    click(rFocus.root.findByProps({ className: 'StringPreviewBtn' }));
    expect(textOf(rFocus.root)).toContain(longBody);
    expect(focused).toEqual(['Expand unsigned', 'Expand body']);
    click(byLabel(rFocus, 'Collapse unsigned'));
    expect(focused).toHaveLength(2);
    rFocus.unmount();
  });

  it('auto-enables Raw for >5,000-node tabs and drops Raw overrides when a live edit crosses the limit', async () => {
    const i18n = await createTestI18n();
    const target = makePlainEvent('$evt_raw_1', 'Bench readings');
    target.makeReplaced(makeEditEvent('$evt_raw_small', '$evt_raw_1', 'Bench short'));
    const r = renderViewer(i18n, target);
    const rawPressed = () => btnByText(r, 'Raw')?.props['aria-pressed'];

    click(btnByText(r, 'Raw'));
    click(btnByText(r, 'Raw'));
    click(tabsOf(r)[1]);
    click(btnByText(r, 'Raw'));
    click(btnByText(r, 'Raw'));
    expect(rawPressed()).toBe(false);

    const hugeEdit = makeEditEvent('$evt_raw_huge', '$evt_raw_1', 'Bench full', {
      readings: Array.from({ length: 5005 }, (_, i) => i),
    });
    act(() => {
      target.makeReplaced(hugeEdit);
    });
    expect(tabsOf(r).map((t) => t.props['aria-selected'])).toEqual([false, true]);
    expect(rawPressed()).toBe(true);
    expect(r.root.findAllByType('pre')).toHaveLength(1);

    click(tabsOf(r)[0]);
    expect(rawPressed()).toBe(false);
    click(tabsOf(r)[1]);
    expect(rawPressed()).toBe(true);
    r.unmount();
  });

  it('preserves __proto__, constructor, and hasOwnProperty identically in tree, Raw, Copy All, and per-field copy', async () => {
    const i18n = await createTestI18n();
    const parsed = JSON.parse(
      '{"content":{"body":"hi","__proto__":{"hidden":"payload"},"constructor":"c","hasOwnProperty":"h"}}'
    ) as Record<string, unknown>;
    const r = renderViewer(i18n, {
      event: parsed,
      isEncrypted: () => false,
    } as unknown as MatrixEvent);

    const treeText = textOf(r.root);
    for (const s of [
      '"__proto__":',
      '"hidden": "payload"',
      '"constructor": "c"',
      '"hasOwnProperty": "h"',
    ]) {
      expect(treeText).toContain(s);
    }
    await clickAsync(byLabel(r, 'Copy __proto__'));
    expect(copyToClipboard).toHaveBeenLastCalledWith('{\n  "hidden": "payload"\n}');
    await clickAsync(byLabel(r, 'Copy constructor'));
    expect(copyToClipboard).toHaveBeenLastCalledWith('c');
    await clickAsync(btnByText(r, 'Copy All'));
    const copiedAll = copyToClipboard.mock.calls.at(-1)?.[0] ?? '';
    click(btnByText(r, 'Raw'));
    expect(textOf(r.root.findByType('pre'))).toBe(copiedAll);
    r.unmount();
  });

  it('tracks live SDK Decrypted, Replaced, LocalEventIdReplaced, BeforeRedaction, commit-gap edits, failed-edit retries, and prop swaps', async () => {
    const i18n = await createTestI18n();

    const liveEnc = new MatrixEvent({
      event_id: '$evt_live_1',
      room_id: ROOM_ID,
      sender: SENDER,
      type: 'm.room.encrypted',
      origin_server_ts: 1731500000000,
      content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'live-cipher' },
    });
    const rEnc = renderViewer(i18n, liveEnc);
    expect(tabLabels(rEnc)).toEqual([]);
    await act(async () => {
      await liveEnc.attemptDecryption({
        decryptEvent: async () => ({
          clearEvent: {
            type: 'm.room.message',
            content: { msgtype: 'm.text', body: 'Decrypted live body' },
          },
        }),
      } as never);
    });
    expect(tabLabels(rEnc)).toEqual(['Decrypted', 'Encrypted']);
    act(() => {
      liveEnc.makeReplaced(makeEditEvent('$evt_live_e', '$evt_live_1', 'Live edited'));
    });
    expect(tabLabels(rEnc)).toEqual(['Original', 'Latest edit', 'Encrypted']);
    expect(textOf(rEnc.root)).toContain('Decrypted live body');
    rEnc.unmount();

    const gap = makePlainEvent('$evt_gap', 'Seed trays stacked');
    const rGap = renderViewer(i18n, gap, {
      sibling: (
        <RunDuringCommit
          run={() => gap.makeReplaced(makeEditEvent('$evt_gap_e', '$evt_gap', 'Labelled'))}
        />
      ),
    });
    expect(tabLabels(rGap)).toEqual(['Original', 'Latest edit']);
    rGap.unmount();

    const retryTarget = makePlainEvent('$evt_retry', 'Lamp six hours');
    const failedEdit = new MatrixEvent({
      event_id: '$evt_retry_e',
      room_id: ROOM_ID,
      sender: SENDER,
      type: 'm.room.encrypted',
      origin_server_ts: 1731500200000,
      content: {
        algorithm: 'm.megolm.v1.aes-sha2',
        ciphertext: 'retry-cipher',
        'm.relates_to': { rel_type: 'm.replace', event_id: '$evt_retry' },
      },
    });
    retryTarget.makeReplaced(failedEdit);
    await failedEdit.attemptDecryption({
      decryptEvent: () => Promise.reject(new Error('withheld key')),
    } as never);
    expect(retryTarget.replacingEvent()).toBeNull();
    expect(getAppliedEdit(retryTarget)).toBe(failedEdit);
    const rRetry = renderViewer(i18n, retryTarget);
    expect(tabLabels(rRetry)).toEqual([]);
    await act(async () => {
      await failedEdit.attemptDecryption(
        {
          decryptEvent: async () => ({
            clearEvent: {
              type: 'm.room.message',
              content: {
                msgtype: 'm.text',
                body: '* Lamp eight hours',
                'm.new_content': { msgtype: 'm.text', body: 'Lamp eight hours' },
              },
            },
          }),
        } as never,
        { isRetry: true }
      );
    });
    expect(tabLabels(rRetry)).toEqual(['Original', 'Latest edit']);
    act(() => {
      rRetry.unmount();
    });
    expect(failedEdit.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);

    const first = makePlainEvent('~local_1', 'Nozzle checked');
    const second = makePlainEvent('$evt_swap_2', 'Heater off');
    const edit1 = makeEditEvent('$evt_e1', '~local_1', 'Nozzle cleaned');
    const edit2 = makeEditEvent('$evt_e2', '~local_1', 'Nozzle replaced');
    first.makeReplaced(edit1);
    const rFollow = renderViewer(i18n, first);
    expect(edit1.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);
    act(() => {
      first.makeReplaced(edit2);
    });
    expect(edit1.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    expect(edit2.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);

    act(() => {
      first.replaceLocalEventId('$evt_server_1');
    });
    expect(textOf(rFollow.root)).toContain('$evt_server_1');
    expect(textOf(rFollow.root)).not.toContain('~local_1');

    const redaction = new MatrixEvent({
      event_id: '$evt_redaction',
      room_id: ROOM_ID,
      sender: SENDER,
      type: 'm.room.redaction',
      origin_server_ts: 1731500300000,
      redacts: '$evt_server_1',
      content: {},
    });
    await act(async () => {
      first.makeRedacted(redaction, {} as never);
    });
    expect(tabLabels(rFollow)).toEqual([]);
    expect(textOf(rFollow.root)).toContain('"content": {}');
    expect(edit2.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);

    act(() => {
      rFollow.update(
        <I18nextProvider i18n={i18n}>
          <EventSourceViewer name="Source Code" mEvent={second} requestClose={vi.fn()} />
        </I18nextProvider>
      );
    });
    expect(textOf(rFollow.root)).toContain('Heater off');
    expect(first.listenerCount(MatrixEventEvent.Replaced)).toBe(0);
    expect(second.listenerCount(MatrixEventEvent.Replaced)).toBe(1);
    act(() => {
      rFollow.unmount();
    });
    expect(second.listenerCount(MatrixEventEvent.Replaced)).toBe(0);
  });

  it('clears copied feedback and ignores stale async copies on tab switch or live edit', async () => {
    const i18n = await createTestI18n();
    const target = makePlainEvent('$evt_stale', 'Fan low');
    target.makeReplaced(makeEditEvent('$evt_stale_e1', '$evt_stale', 'Fan medium'));
    const r = renderViewer(i18n, target);
    click(tabsOf(r)[1]);

    const copyBody = () => r.root.findAllByProps({ 'aria-label': 'Copy body' })[0]!;
    const copyEventId = () =>
      r.root
        .findAllByType('button')
        .find((b) => String(b.props['aria-label'] ?? '').startsWith('Copy Event: '));

    await clickAsync(copyBody());
    expect(String(copyBody().props.className)).toContain('RowCopyBtnCopied');
    await clickAsync(copyEventId());
    expect(String(copyEventId()?.props.className)).toContain('MetaChipCopied');
    await clickAsync(btnByText(r, 'Copy All'));
    expect(btnByText(r, 'Copy All')?.props.variant).toBe('Success');

    act(() => {
      target.makeReplaced(makeEditEvent('$evt_stale_e2', '$evt_stale', 'Fan high'));
    });
    expect(String(copyBody().props.className)).not.toContain('RowCopyBtnCopied');
    expect(String(copyEventId()?.props.className)).not.toContain('MetaChipCopied');
    expect(btnByText(r, 'Copy All')?.props.variant).toBe('Primary');

    const pending: Array<(ok: boolean) => void> = [];
    copyToClipboard.mockImplementation(() => new Promise<boolean>((res) => pending.push(res)));
    act(() => {
      copyBody().props.onClick(CLICK);
      copyEventId()?.props.onClick(CLICK);
      btnByText(r, 'Copy All')?.props.onClick(CLICK);
    });
    act(() => {
      target.makeReplaced(makeEditEvent('$evt_stale_e3', '$evt_stale', 'Fan off'));
    });
    await act(async () => {
      pending.forEach((res) => res(true));
    });
    expect(String(copyBody().props.className)).not.toContain('RowCopyBtnCopied');
    expect(btnByText(r, 'Copy All')?.props.variant).toBe('Primary');

    pending.length = 0;
    click(copyBody());
    click(tabsOf(r)[0]);
    await act(async () => {
      pending.forEach((res) => res(true));
    });
    expect(String(copyBody().props.className)).not.toContain('RowCopyBtnCopied');
    r.unmount();
  });

  it('reveals bidi controls while copying raw values, isolates Arabic counts in <bdi>, and updates live on language switch', async () => {
    const i18n = await createTestI18n();
    const rawSender = '@alex‮_admin‬:example.org';
    const rawBody = 'sensor ‮spoof‬ ok';
    const rBidi = renderViewer(
      i18n,
      makePlainEvent('$evt_bidi', rawBody, {}, { sender: rawSender }),
      {
        name: 'Source‮Code',
      }
    );

    expect(JSON.stringify(rBidi.toJSON())).not.toMatch(CONTROL);
    expect(textOf(rBidi.root)).toContain('Source<U+202E>Code');
    expect(textOf(rBidi.root)).toContain('@alex<U+202E>_admin<U+202C>:example.org');
    expect(textOf(rBidi.root)).toContain('sensor <U+202E>spoof<U+202C> ok');
    await clickAsync(byLabel(rBidi, 'Copy body'));
    expect(copyToClipboard).toHaveBeenLastCalledWith(rawBody);
    await clickAsync(byLabel(rBidi, 'Copy Sender: @alex<U+202E>_admin<U+202C>:example.org'));
    expect(copyToClipboard).toHaveBeenLastCalledWith(rawSender);
    rBidi.unmount();

    await i18n.changeLanguage('ar');
    const rAr = renderViewer(i18n, makeRichEvent().ev);
    const isolates = /[\u2066-\u2069]/;
    expect(
      rAr.root
        .findAllByType('span')
        .map((s) => String(s.props.className ?? ''))
        .filter((c) => c.includes('MetaChipValue'))
    ).toEqual([
      'MetaChipValue MetaChipValueTechnical',
      'MetaChipValue MetaChipValueTechnical',
      'MetaChipValue MetaChipValueTechnical',
      'MetaChipValue',
    ]);
    for (const pill of rAr.root.findAllByProps({ className: 'FoldPill' })) {
      expect(pill.findAllByType('bdi')).toHaveLength(1);
      expect(textOf(pill)).not.toMatch(isolates);
    }
    expect(
      textOf(rAr.root.findAllByProps({ className: 'StringLenPill' })[0]!.findByType('bdi'))
    ).toBe('146');
    setFilter(rAr, 'txn_demo_99');
    expect(textOf(rAr.root.findByProps({ className: 'FilterCount' }).findByType('bdi'))).toBe('1');
    setFilter(rAr, 'zz_missing');
    expect(textOf(rAr.root.findByProps({ className: 'EmptyFilter' }).findByType('bdi'))).toBe(
      'zz_missing'
    );

    setFilter(rAr, '');
    await act(async () => {
      await i18n.changeLanguage('de');
    });
    const deText = textOf(rAr.root);
    expect(deText).toContain('Texte kürzen');
    expect(deText).toContain('6 Einträge');
    expect(deText).toContain('Einklappen');
    rAr.unmount();
  });

  it('keeps the same chevron button node mounted on fold/unfold and retains fold and Raw state per tab', async () => {
    const i18n = await createTestI18n();
    const { ev } = makeRichEvent();
    const edit = makeEditEvent('$evt_edit_tabs', '$evt_garden_1', 'Edited body');
    ev.makeReplaced(edit);

    const buttonNodes = new Map<string, { id: number; focus: ReturnType<typeof vi.fn> }>();
    let nextNodeId = 1;
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <I18nextProvider i18n={i18n}>
          <EventSourceViewer name="Source Code" mEvent={ev} requestClose={vi.fn()} />
        </I18nextProvider>,
        {
          createNodeMock: (el) => {
            if (el.type === 'button') {
              const label = String((el.props as { 'aria-label'?: string })['aria-label'] ?? '');
              const node = { id: nextNodeId++, focus: vi.fn() };
              buttonNodes.set(label, node);
              return node;
            }
            return {};
          },
        }
      );
    });

    const initialUnsignedId = buttonNodes.get('Expand unsigned')?.id;
    expect(initialUnsignedId).toBeDefined();
    // Clicking the collapsed count pill unfolds unsigned without remounting the chevron button
    const unsignedLine = r.root
      .findAllByProps({ className: 'TreeLine' })
      .find((line) => textOf(line).includes('"unsigned"'));
    const unsignedPill = unsignedLine?.findByProps({ className: 'FoldPill' });
    expect(unsignedPill).toBeDefined();
    click(unsignedPill);
    // Because the chevron stayed mounted, createNodeMock did not create a second button for it
    expect(buttonNodes.get('Collapse unsigned')).toBeUndefined();
    expect(buttonNodes.get('Expand unsigned')?.focus).toHaveBeenCalledTimes(1);
    expect(textOf(r.root)).toContain('txn_demo_99');

    // Folding and unfolding via the chevron keeps the exact same button instance mounted
    click(byLabel(r, 'Collapse unsigned'));
    expect(textOf(r.root)).not.toContain('txn_demo_99');
    expect(buttonNodes.get('Expand unsigned')?.id).toBe(initialUnsignedId);
    click(byLabel(r, 'Expand unsigned'));
    expect(textOf(r.root)).toContain('txn_demo_99');
    expect(buttonNodes.get('Collapse unsigned')).toBeUndefined();

    // Switch to Latest edit and back to Original: unsigned stays expanded
    click(btnByText(r, 'Latest edit'));
    expect(textOf(r.root)).toContain('Edited body');
    click(btnByText(r, 'Original'));
    expect(textOf(r.root)).toContain('txn_demo_99');

    // Toggle Raw on Original, switch to Latest edit (still tree), switch back (still Raw)
    click(btnByText(r, 'Raw'));
    expect(r.root.findAllByType('pre')).toHaveLength(1);
    click(btnByText(r, 'Latest edit'));
    expect(r.root.findAllByType('pre')).toHaveLength(0);
    click(btnByText(r, 'Original'));
    expect(r.root.findAllByType('pre')).toHaveLength(1);
    r.unmount();
  });
});
