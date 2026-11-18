// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_SETTINGS_EVENT } from '../../../matrix/protocol/roomSettings';
import { ROOM_SETTING_DEFINITIONS, type RoomTextSettingDefinition } from './roomSettingDefinitions';
import { RoomTextSettingTile } from './RoomTextSettingTile';

const ROOM = { roomId: '!r:example.org' } as Room;
const DEFINITION = ROOM_SETTING_DEFINITIONS.find(
  (definition): definition is RoomTextSettingDefinition => definition.kind === 'text'
);
const KEY = 'thread_summary_instructions';
const LABEL = 'Thread title rules';
const FAILED = "Couldn't save the setting. Try again.";

const live = vi.hoisted(() => ({
  event: undefined as MatrixEvent | undefined,
  canSend: true,
  stateArgs: [] as unknown[],
  permissionArgs: [] as unknown[],
}));
const client = vi.hoisted(() => ({
  getSafeUserId: () => '@me:example.org',
  sendStateEvent: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../../test/utils/i18n');
  // The count's `{{length, number}}` reads as the plain number here.
  const t = (key: string, options?: Record<string, unknown>) =>
    translateFromEn(key, options).replace(/\{\{(\w+), number\}\}/g, (_match, name: string) =>
      String(options?.[name])
    );
  return { useTranslation: () => ({ t }) };
});
vi.mock('../../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../../../matrix/hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../../../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../../../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    stateEvent: (...args: unknown[]) => {
      live.permissionArgs = args;
      return live.canSend;
    },
  }),
}));
vi.mock('../../../matrix/hooks/useStateEvent', () => ({
  useStateEvent: (...args: unknown[]) => {
    live.stateArgs = args;
    return live.event;
  },
}));
vi.mock('folds', () => {
  // Plain elements with only the DOM props the tile's roles and names depend on.
  const DOM_PROPS = [
    'id',
    'htmlFor',
    'role',
    'style',
    'type',
    'disabled',
    'value',
    'readOnly',
    'placeholder',
    'maxLength',
    'rows',
    'aria-describedby',
    'onClick',
    'onChange',
    'onSubmit',
  ];
  const domProps = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([name]) => DOM_PROPS.includes(name)));
  const element =
    (tag: string) =>
    ({ as, children, ...props }: { as?: string; children?: React.ReactNode }) =>
      React.createElement(as ?? tag, domProps(props), children);
  const button = element('button');
  return {
    Box: element('div'),
    Button: ({
      before,
      children,
      ...props
    }: {
      before?: React.ReactNode;
      children?: React.ReactNode;
    }) =>
      button({ ...props, children: React.createElement(React.Fragment, null, before, children) }),
    Icon: () => null,
    Icons: { Check: 'check' },
    Text: element('span'),
    TextArea: (props: Record<string, unknown>) => React.createElement('textarea', domProps(props)),
    color: { Critical: { Main: 'red' } },
  };
});

vi.mock('./RoomTextSettingTile.css', () => ({
  Saved: 'Saved',
  SavedCheck: 'SavedCheck',
  VisuallyHidden: 'VisuallyHidden',
}));

let eventCount = 0;
/** Sets the room's live `thread_summary_instructions` event to one with `content`. */
const setLive = (content: object | undefined, id = `$event${(eventCount += 1)}`) => {
  live.event =
    content === undefined
      ? undefined
      : ({ getId: () => id, getContent: () => content } as unknown as MatrixEvent);
};
/** The room's state showing the echo of the event the tile's `call`th send created. */
const echo = (call: number) => {
  setLive(sentContent(call) as object, `$sent${call}`);
  refresh();
};

/** A send that settles when the test says so, with the event ID `$sent<call>`. */
const deferSend = () => {
  const settle = {} as { resolve: () => Promise<void>; reject: () => Promise<void> };
  client.sendStateEvent.mockImplementationOnce(() => {
    const call = client.sendStateEvent.mock.calls.length - 1;
    return new Promise((resolve, reject) => {
      settle.resolve = () => act(async () => resolve({ event_id: `$sent${call}` }));
      settle.reject = () => act(async () => reject(new Error('M_FORBIDDEN')));
    });
  });
  return settle;
};

const tile = () => <RoomTextSettingTile room={ROOM} definition={DEFINITION!} />;
let rerender: (ui: React.ReactElement) => void;
const mount = () => {
  ({ rerender } = render(tile()));
};
/** Draws the tile again, as a change of the room's state does. */
const refresh = () => rerender(tile());

const field = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: LABEL });
// Save, or Saved for a moment after a write.
const saveButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /^Saved?$/ });
const clearButton = () => screen.queryByRole('button', { name: 'Clear' });
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const clickSave = () => fireEvent.click(saveButton());
const sentContent = (call: number) => client.sendStateEvent.mock.calls[call]?.[2];

beforeEach(() => {
  live.event = undefined;
  live.canSend = true;
  client.sendStateEvent.mockReset();
  client.sendStateEvent.mockImplementation(async () => ({
    event_id: `$sent${client.sendStateEvent.mock.calls.length - 1}`,
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RoomTextSettingTile', () => {
  it("shows the room's value with its count, Clear, and Save once the text changes", () => {
    setLive({ value: '  Use at most 4 words\n' });
    mount();

    expect(live.stateArgs).toEqual([ROOM, ROOM_SETTINGS_EVENT, KEY]);
    expect(field().value).toBe('Use at most 4 words');
    expect(field().maxLength).toBe(2000);
    expect(screen.getByText('19 / 2000')).toBeTruthy();
    expect(clearButton()).not.toBeNull();
    expect(saveButton().disabled).toBe(true);

    // White space around the same text changes nothing, and stays as typed.
    type('Use at most 4 words ');
    expect(field().value).toBe('Use at most 4 words ');
    expect(saveButton().disabled).toBe(true);

    type('Use at most 5 words');
    expect(saveButton().disabled).toBe(false);
  });

  it('labels the field and describes it with elements that exist', () => {
    setLive({ value: 'Use at most 4 words' });
    mount();

    const ids = field().getAttribute('aria-describedby')!.split(' ');
    expect(ids.length).toBeGreaterThan(0);
    ids.forEach((id) => expect(document.getElementById(id), id).not.toBeNull());
    const described = ids.map((id) => document.getElementById(id)!.textContent).join(' ');
    expect(described).toContain('Titles already set keep their wording until the next refresh.');
    expect(described).toContain('19 / 2000');
  });

  it('shows an unset setting as an empty field without Clear', () => {
    setLive({});
    mount();

    expect(field().value).toBe('');
    expect(field().placeholder).toBe('For example: Use at most 4 words after the emoji');
    expect(clearButton()).toBeNull();
    expect(saveButton().disabled).toBe(true);
  });

  it('saves the trimmed text under the setting as its state key', async () => {
    mount();
    type('  Use at most 4 words\n');
    await act(async () => clickSave());

    expect(client.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(client.sendStateEvent).toHaveBeenCalledWith(
      ROOM.roomId,
      ROOM_SETTINGS_EVENT,
      { value: 'Use at most 4 words' },
      KEY
    );
    expect(field().value).toBe('Use at most 4 words');
    expect(saveButton().disabled).toBe(true);
    expect(clearButton()).not.toBeNull();
  });

  it('clears the setting with empty content', async () => {
    setLive({ value: 'Use at most 4 words' });
    mount();
    await act(async () => fireEvent.click(clearButton()!));

    expect(client.sendStateEvent).toHaveBeenCalledWith(ROOM.roomId, ROOM_SETTINGS_EVENT, {}, KEY);
    expect(field().value).toBe('');
    expect(clearButton()).toBeNull();
  });

  it('compares with the saved value before its echo: typing the old value back can save', async () => {
    setLive({ value: 'Use at most 4 words' });
    mount();
    type('Use at most 6 words');
    const send = deferSend();
    clickSave();
    expect(field().readOnly).toBe(true);
    await send.resolve();

    // The room still shows the old value, but the server holds the new one.
    type('Use at most 4 words');
    expect(saveButton().disabled).toBe(false);
    await act(async () => clickSave());
    expect(sentContent(1)).toEqual({ value: 'Use at most 4 words' });
  });

  it('can clear a value just saved before its echo', async () => {
    setLive({});
    mount();
    type('Use at most 4 words');
    await act(async () => clickSave());

    expect(clearButton()).not.toBeNull();
    type('');
    expect(saveButton().disabled).toBe(false);
    await act(async () => clickSave());
    expect(sentContent(1)).toEqual({});
  });

  it('follows the room again after an edit is undone', () => {
    setLive({ value: 'Use at most 4 words' });
    mount();
    type('Use at most 5 words');
    type('Use at most 4 words');

    setLive({ value: 'Name the topic first' });
    refresh();
    expect(field().value).toBe('Name the topic first');
    expect(saveButton().disabled).toBe(true);
  });

  it('keeps what the person types while someone else changes the room', () => {
    setLive({ value: 'Use at most 4 words' });
    mount();
    type('Use at most 5 words');

    setLive({ value: 'Name the topic first' });
    refresh();
    expect(field().value).toBe('Use at most 5 words');
    expect(saveButton().disabled).toBe(false);
  });

  it('takes an echo that arrives before the send resolves', async () => {
    setLive({ value: 'Use at most 4 words' });
    mount();
    type('Use at most 6 words');
    const send = deferSend();
    clickSave();
    setLive({ value: 'Use at most 6 words' });
    refresh();
    await send.resolve();

    expect(field().value).toBe('Use at most 6 words');
    expect(saveButton().disabled).toBe(true);
    // The room's next change shows, as the echo already went past the saved value.
    setLive({ value: 'Name the topic first' });
    refresh();
    expect(field().value).toBe('Name the topic first');
  });

  it("shows another writer's value that replaces a save whose echo never showed", async () => {
    setLive({ value: 'Use at most 4 words' });
    mount();
    type('Use at most 6 words');
    await act(async () => clickSave());
    expect(field().value).toBe('Use at most 6 words');

    setLive({ value: 'Name the topic first' });
    refresh();
    expect(field().value).toBe('Name the topic first');
    expect(saveButton().disabled).toBe(true);
  });

  it('keeps a later save when an earlier echo arrives while it is pending', async () => {
    setLive({ value: 'Use at most 4 words' });
    mount();
    type('Use at most 5 words');
    await act(async () => clickSave());
    type('Use at most 6 words');
    const second = deferSend();
    clickSave();
    echo(0);
    await second.resolve();

    expect(field().value).toBe('Use at most 6 words');
    expect(saveButton().disabled).toBe(true);
    expect(clearButton()).not.toBeNull();
    // Its own echo, and then someone else's change, show as they come.
    echo(1);
    expect(field().value).toBe('Use at most 6 words');
    setLive({ value: 'Name the topic first' });
    refresh();
    expect(field().value).toBe('Name the topic first');
  });

  it.each([
    ['in order', [0, 1]],
    ['out of order', [1, 0]],
  ])('keeps a Clear after a Save when both echoes come late, %s', async (_name, echoes) => {
    setLive({ value: 'Use at most 4 words' });
    mount();
    type('Use at most 5 words');
    await act(async () => clickSave());
    await act(async () => fireEvent.click(clearButton()!));
    expect(sentContent(1)).toEqual({});
    expect(field().value).toBe('');

    // The server holds the Clear, whichever echo comes first.
    echoes.forEach((call) => {
      echo(call);
      expect(field().value).toBe('');
      expect(clearButton()).toBeNull();
    });
    expect(saveButton().disabled).toBe(true);
  });

  it('is read-only with a note for someone who may not send the setting', () => {
    live.canSend = false;
    setLive({ value: 'Use at most 4 words' });
    mount();

    expect(live.permissionArgs).toEqual([ROOM_SETTINGS_EVENT, '@me:example.org']);
    expect(field().value).toBe('Use at most 4 words');
    expect(field().readOnly).toBe(true);
    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.getByText("Only people allowed to change this room's settings can edit this.")
    ).toBeTruthy();
  });

  it('reads Saved for two seconds after a write, until the person types again', async () => {
    vi.useFakeTimers();
    try {
      mount();
      type('Use at most 4 words');
      await act(async () => clickSave());
      expect(saveButton().textContent).toBe('Saved');
      expect(saveButton().disabled).toBe(true);
      expect(screen.getByRole('status').textContent).toBe('Saved');

      act(() => {
        vi.advanceTimersByTime(1999);
      });
      expect(saveButton().textContent).toBe('Saved');
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(saveButton().textContent).toBe('Save');
      expect(screen.getByRole('status').textContent).toBe('');

      // Clear confirms the same way, and typing ends it early.
      await act(async () => fireEvent.click(clearButton()!));
      expect(saveButton().textContent).toBe('Saved');
      type('Use at most 5 words');
      expect(saveButton().textContent).toBe('Save');
      expect(saveButton().disabled).toBe(false);
      expect(screen.getByRole('status').textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts the two seconds from the latest write, and a failed one ends Saved', async () => {
    vi.useFakeTimers();
    const wait = (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    try {
      mount();
      type('Use at most 4 words');
      await act(async () => clickSave());
      wait(1500);
      expect(saveButton().textContent).toBe('Saved');

      // A second write inside the window: Saved lasts two seconds from it, not from the first.
      await act(async () => fireEvent.click(clearButton()!));
      expect(sentContent(1)).toEqual({});
      wait(600);
      expect(saveButton().textContent).toBe('Saved');
      wait(1399);
      expect(saveButton().textContent).toBe('Saved');
      wait(1);
      expect(saveButton().textContent).toBe('Save');

      // A failed write inside the window takes Saved away and leaves the alert.
      type('Use at most 5 words');
      await act(async () => clickSave());
      wait(500);
      expect(saveButton().textContent).toBe('Saved');
      const failed = deferSend();
      fireEvent.click(clearButton()!);
      await failed.reject();
      expect(saveButton().textContent).toBe('Save');
      expect(screen.getByRole('status').textContent).toBe('');
      expect(screen.getByRole('alert').textContent).toBe(FAILED);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so in an alert when the save fails, and keeps the text', async () => {
    mount();
    type('Use at most 4 words');
    const send = deferSend();
    clickSave();
    await send.reject();

    expect(screen.getByRole('alert').textContent).toBe(FAILED);
    expect(field().value).toBe('Use at most 4 words');
    expect(saveButton().textContent).toBe('Save');
    expect(saveButton().disabled).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('');

    // Typing again takes the error away.
    type('Use at most 4 words.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('changes nothing when a send settles after the tile is gone', async () => {
    const errors = vi.spyOn(console, 'error');
    mount();
    type('Use at most 4 words');
    const sent = deferSend();
    clickSave();
    cleanup();
    await sent.resolve();

    expect(errors).not.toHaveBeenCalled();
  });
});
