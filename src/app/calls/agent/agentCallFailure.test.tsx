// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeCallAtom } from '../callStore';
import { agentCallFailureAtom, useAgentCaller } from './agentCaller';
import { AgentCallFailureNotice } from './AgentCallFailureNotice';

const support = vi.hoisted(() => ({
  browser: true,
  /** The call service lookup; a test can hold it to switch accounts meanwhile. */
  service: async (): Promise<string | undefined> => undefined,
  createRoom: async (): Promise<string> => '!call:example.org',
}));
const client = vi.hoisted(() => ({ clientRunning: true, getRoom: () => null }));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../callSupport', () => ({
  browserSupportsCalls: () => support.browser,
}));
vi.mock('../rtcFocus', () => ({
  getLivekitServiceUrl: () => support.service(),
}));
// The agent has no call room yet; a test holds the making of one open.
vi.mock('./agentCall', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agentCall')>()),
  findAgentCallRoom: () => undefined,
  createAgentVoiceRoom: () => support.createRoom(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('folds', () => {
  const plain =
    (tag: string) =>
    ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
      React.createElement(tag, props, children);
  return {
    Box: plain('div'),
    Text: plain('span'),
    Icon: () => null,
    IconButton: plain('button'),
    Icons: { Warning: 'Warning', Cross: 'Cross' },
    color: { Critical: { Main: 'red' } },
  };
});
vi.mock('../../ui/glass/GlassPrimitives', () => ({
  Surface: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement('section', props, children),
}));
vi.mock('../IncomingCalls.css', () => ({ Card: 'card', Host: 'host' }));

type Caller = ReturnType<typeof useAgentCaller>;

/** Renders a caller the way the command palette does, and hands out its `call`. */
const mountCaller = (store: ReturnType<typeof createStore>, announce: boolean) => {
  const caller: { current?: Caller } = {};
  function Probe() {
    caller.current = useAgentCaller({ announce });
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <Provider store={store}>
        <Probe />
      </Provider>
    );
  });
  return { caller, unmount: () => act(() => renderer?.unmount()) };
};

const target = { agentUserId: '@mindroom_helper:example.org', roomId: '!room:example.org' };

beforeEach(() => {
  support.browser = true;
  support.service = async () => undefined;
  client.clientRunning = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('agent calls started from the header or the command palette', () => {
  it('report why they did not start, even after the palette that started them closed', async () => {
    const store = createStore();
    const { caller, unmount } = mountCaller(store, true);
    const call = caller.current?.call;
    support.browser = false;
    // The palette closes itself before the call starts.
    unmount();
    await act(async () => {
      expect(await call?.(target)).toBe(false);
    });
    expect(store.get(agentCallFailureAtom)?.error).toBe('browser');

    support.browser = true;
    const second = mountCaller(store, true);
    await act(async () => {
      await second.caller.current?.call(target);
    });
    expect(store.get(agentCallFailureAtom)?.error).toBe('homeserver');

    store.set(activeCallAtom, {} as never);
    await act(async () => {
      await second.caller.current?.call(target);
    });
    expect(store.get(agentCallFailureAtom)?.error).toBe('busy');
  });

  it('tell the next account nothing when the account that started one went away meanwhile', async () => {
    const store = createStore();
    const { caller } = mountCaller(store, true);
    let answerLookup: ((url: string | undefined) => void) | undefined;
    support.service = () =>
      new Promise((resolve) => {
        answerLookup = resolve;
      });
    let starting: Promise<boolean> | undefined;
    act(() => {
      starting = caller.current?.call(target);
    });
    // The account switches while the call service is looked up: its client stops, and the
    // lookup fails as a request of a stopped client does.
    client.clientRunning = false;
    await act(async () => {
      answerLookup?.(undefined);
      expect(await starting).toBe(false);
    });
    expect(store.get(agentCallFailureAtom)).toBeUndefined();
  });

  it('start one at a time, wherever they are asked, so a first call makes one call room', async () => {
    const store = createStore();
    // The room menu's entry, which goes away once it is chosen, and the menu opened again.
    const first = mountCaller(store, true);
    const second = mountCaller(store, true);
    support.service = async () => 'https://calls.example.org';
    let failCreation: (() => void) | undefined;
    const createRoom = vi.fn(
      () =>
        new Promise<string>((_resolve, reject) => {
          failCreation = () => reject(new Error('no room'));
        })
    );
    support.createRoom = createRoom;
    let starting: Promise<boolean> | undefined;
    await act(async () => {
      starting = first.caller.current?.call(target);
      await vi.waitFor(() => expect(createRoom).toHaveBeenCalledTimes(1));
    });
    first.unmount();
    // The start is still under way for the caller that is left, which starts no second one.
    expect(second.caller.current?.pending).toBe(true);
    await act(async () => {
      expect(await second.caller.current?.call(target)).toBe(false);
    });
    expect(createRoom).toHaveBeenCalledTimes(1);

    await act(async () => {
      failCreation?.();
      expect(await starting).toBe(false);
    });
    expect(second.caller.current?.pending).toBe(false);
    expect(mountCaller(store, true).caller.current?.pending).toBe(false);
    // The next one starts again.
    support.createRoom = vi.fn(async () => {
      throw new Error('no room');
    });
    await act(async () => {
      await second.caller.current?.call(target);
    });
    expect(support.createRoom).toHaveBeenCalledTimes(1);
  });

  it('leave the account-wide notice alone when the caller shows its own error', async () => {
    const store = createStore();
    const { caller } = mountCaller(store, false);
    support.browser = false;
    await act(async () => {
      await caller.current?.call(target);
    });
    expect(caller.current?.error).toBe('browser');
    expect(store.get(agentCallFailureAtom)).toBeUndefined();
  });
});

describe('AgentCallFailureNotice', () => {
  const render = (store: ReturnType<typeof createStore>) => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <AgentCallFailureNotice />
        </Provider>
      );
    });
    return renderer as ReactTestRenderer;
  };

  it('says why, until closed', () => {
    const store = createStore();
    store.set(agentCallFailureAtom, { error: 'homeserver', id: 1 });
    const renderer = render(store);
    const alert = renderer.root.findByProps({ role: 'alert' });
    expect(alert.props['data-agent-call-failure']).toBe('homeserver');
    expect(JSON.stringify(renderer.toJSON())).toContain(
      'mindroomUi.calls.agentCallButton.homeserverUnsupported'
    );
    act(() => {
      renderer.root
        .findByProps({ 'aria-label': 'featureUi.call.callView.dismissVoiceCallError' })
        .props.onClick();
    });
    expect(store.get(agentCallFailureAtom)).toBeUndefined();
    expect(renderer.toJSON()).toBeNull();
  });

  it('goes away by itself, but a newer failure stays its own time', () => {
    vi.useFakeTimers();
    const store = createStore();
    store.set(agentCallFailureAtom, { error: 'failed', id: 1 });
    render(store);
    act(() => {
      vi.advanceTimersByTime(8_000);
      store.set(agentCallFailureAtom, { error: 'busy', id: 2 });
    });
    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    expect(store.get(agentCallFailureAtom)?.error).toBe('busy');
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(store.get(agentCallFailureAtom)).toBeUndefined();
  });
});
