// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DISCLOSURE_KEY_PREFIX,
  ManualExpansionStateContext,
  clearBulkExpansionOverrides,
  hasOpenReplyDisclosure,
  replyDisclosureScope,
  usePersistedDisclosure,
} from './manualExpansionState';

function DisclosureHarness({
  keys,
  defaultOpen = false,
}: {
  keys: string | readonly string[] | undefined;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = usePersistedDisclosure(keys, defaultOpen);
  return (
    <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      {open ? 'open' : 'closed'}
    </button>
  );
}

describe('manualExpansionState disclosure helpers', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const mount = (
    state: Map<string, boolean>,
    keys: string | readonly string[] | undefined,
    defaultOpen = false
  ) => {
    act(() => {
      renderer = create(
        <ManualExpansionStateContext.Provider value={state}>
          <DisclosureHarness keys={keys} defaultOpen={defaultOpen} />
        </ManualExpansionStateContext.Provider>
      );
    });
  };

  const toggle = () => {
    const button = renderer!.root.findByType('button');
    act(() => {
      button.props.onClick();
    });
  };

  const isOpen = () => renderer!.root.findByType('button').props['aria-expanded'] as boolean;

  it('persists single-key open state across remounts and deletes it on close', () => {
    const state = new Map<string, boolean>();
    const scope = replyDisclosureScope('!room:example.org', '$reply')!;
    const key = `${scope}reasoning`;

    mount(state, key);
    expect(isOpen()).toBe(false);
    expect(state.has(key)).toBe(false);

    toggle();
    expect(isOpen()).toBe(true);
    expect(state.get(key)).toBe(true);

    act(() => renderer?.unmount());
    mount(state, key);
    expect(isOpen()).toBe(true);

    toggle();
    expect(isOpen()).toBe(false);
    expect(state.has(key)).toBe(false);
  });

  it('persists multi-key open state across growth, split, and remount', () => {
    const state = new Map<string, boolean>();
    const scope = replyDisclosureScope('!room:example.org', '$reply')!;
    const key1 = `${scope}tool-run:1`;
    const key2 = `${scope}tool-run:2`;

    mount(state, [key1]);
    toggle();
    expect(state.get(key1)).toBe(true);

    // A second tool joins the open run; the effect records it so a later split keeps both open.
    act(() => {
      renderer!.update(
        <ManualExpansionStateContext.Provider value={state}>
          <DisclosureHarness keys={[key1, key2]} />
        </ManualExpansionStateContext.Provider>
      );
    });
    expect(state.get(key2)).toBe(true);

    act(() => renderer?.unmount());
    mount(state, [key2]);
    expect(isOpen()).toBe(true);

    toggle();
    expect(state.has(key2)).toBe(false);
    expect(state.get(key1)).toBe(true);
  });

  it('clearBulkExpansionOverrides clears outer keys while preserving disclosure keys', () => {
    const scope = replyDisclosureScope('!room:example.org', '$reply')!;
    const state = new Map<string, boolean>([
      ['$msg1', true],
      ['finished-work:$reply', false],
      [`${scope}reasoning`, true],
      [`${DISCLOSURE_KEY_PREFIX}custom`, true],
    ]);

    clearBulkExpansionOverrides(state);

    expect([...state.entries()]).toEqual([
      [`${scope}reasoning`, true],
      [`${DISCLOSURE_KEY_PREFIX}custom`, true],
    ]);
  });

  it('hasOpenReplyDisclosure ignores hidden cog children when tools are hidden and the cog is closed', () => {
    const scope = replyDisclosureScope('!room:example.org', '$reply')!;
    const otherScope = replyDisclosureScope('!room:example.org', '$other')!;
    const state = new Map<string, boolean>([[`${otherScope}reasoning`, true]]);

    expect(hasOpenReplyDisclosure(state, scope, { toolsShown: true })).toBe(false);

    state.set(`${scope}tool-run:1`, true);
    state.set(`${scope}tool-result:1`, true);
    state.set(`${scope}live-shell:1`, true);
    state.set(`${scope}live-subagent:run1:id:call1`, true);
    state.set(`${scope}secret:$card`, true);

    expect(hasOpenReplyDisclosure(state, scope, { toolsShown: true })).toBe(true);
    expect(hasOpenReplyDisclosure(state, scope, { toolsShown: false })).toBe(false);

    state.set(`${scope}tool-fold`, true);
    expect(hasOpenReplyDisclosure(state, scope, { toolsShown: false })).toBe(true);

    state.delete(`${scope}tool-fold`);
    expect(hasOpenReplyDisclosure(state, scope, { toolsShown: false })).toBe(false);

    state.set(`${scope}reasoning`, true);
    expect(hasOpenReplyDisclosure(state, scope, { toolsShown: false })).toBe(true);
  });
});
