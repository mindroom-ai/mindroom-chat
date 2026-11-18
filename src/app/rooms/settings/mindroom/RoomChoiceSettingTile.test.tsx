// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_SETTINGS_EVENT } from '../../../matrix/protocol/roomSettings';
import {
  ROOM_SETTING_DEFINITIONS,
  type RoomChoiceSettingDefinition,
} from './roomSettingDefinitions';
import { RoomChoiceSettingTile } from './RoomChoiceSettingTile';

const ROOM = { roomId: '!r:example.org' } as Room;
const DEFINITION = ROOM_SETTING_DEFINITIONS.find(
  (definition): definition is RoomChoiceSettingDefinition => definition.key === 'reply_mode'
);
const FAILED = "Couldn't save the setting. Try again.";
const READ_ONLY = "Only people allowed to change this room's settings can edit this.";

const live = vi.hoisted(() => ({
  event: undefined as MatrixEvent | undefined,
  canSend: true,
  stateArgs: [] as unknown[],
}));
const client = vi.hoisted(() => ({
  getSafeUserId: () => '@me:example.org',
  sendStateEvent: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('../../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../../../matrix/hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../../../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../../../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ stateEvent: () => live.canSend }),
}));
vi.mock('../../../matrix/hooks/useStateEvent', () => ({
  useStateEvent: (...args: unknown[]) => {
    live.stateArgs = args;
    return live.event;
  },
}));
vi.mock('folds', () => {
  const element =
    (tag: string) =>
    ({ children, role }: { children?: React.ReactNode; role?: string }) =>
      React.createElement(tag, { role }, children);
  return { Box: element('div'), Text: element('span'), color: { Critical: { Main: 'red' } } };
});
vi.mock('../../../ui/SettingTile', () => ({
  SettingTile: ({ title, after }: { title: string; after: React.ReactNode }) => (
    <label>
      {title}
      {after}
    </label>
  ),
}));
// The menu as a plain select: its value is the shown choice, and picking one chooses it.
vi.mock('../../../ui/settings/ChoiceButton', () => ({
  ChoiceButton: ({
    value,
    choices,
    onChoose,
    disabled,
  }: {
    value: string;
    choices: Array<{ value: string; label: string }>;
    onChoose: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select value={value} disabled={disabled} onChange={(evt) => onChoose(evt.target.value)}>
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('./RoomTextSettingTile.css', () => ({ VisuallyHidden: 'VisuallyHidden' }));

let eventCount = 0;
/** Sets the room's live `reply_mode` event to one with `content`. */
const setLive = (content: object | undefined, id = `$event${(eventCount += 1)}`) => {
  live.event =
    content === undefined
      ? undefined
      : ({ getId: () => id, getContent: () => content } as unknown as MatrixEvent);
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

const tile = () => <RoomChoiceSettingTile room={ROOM} definition={DEFINITION!} />;
let rerender: (ui: React.ReactElement) => void;
const mount = () => {
  ({ rerender } = render(tile()));
};
/** Draws the tile again, as a change of the room's state does. */
const refresh = () => rerender(tile());

const menu = () => screen.getByRole<HTMLSelectElement>('combobox', { name: /Agents answer/ });
const shown = () => menu().selectedOptions[0]?.textContent;
const choose = (value: string) => fireEvent.change(menu(), { target: { value } });
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

describe('RoomChoiceSettingTile', () => {
  it("shows the room's reply mode, and Default while it is unset or unknown", () => {
    mount();
    expect(live.stateArgs).toEqual([ROOM, ROOM_SETTINGS_EVENT, 'reply_mode']);
    expect(shown()).toBe('Default');

    for (const [content, label] of [
      [{ value: 'mentions' }, 'Only when mentioned'],
      [{ value: 'auto' }, 'Any message'],
      [{}, 'Default'],
      [{ value: 'paused' }, 'Default'],
      // Agents match a choice exactly, so a padded one shows as what they do: Default.
      [{ value: ' mentions ' }, 'Default'],
    ] as const) {
      setLive(content);
      refresh();
      expect(shown()).toBe(label);
    }
  });

  it('saves a choice at once, and Default clears the setting', async () => {
    mount();
    await act(async () => choose('mentions'));
    expect(client.sendStateEvent).toHaveBeenLastCalledWith(
      ROOM.roomId,
      ROOM_SETTINGS_EVENT,
      { value: 'mentions' },
      'reply_mode'
    );
    expect(shown()).toBe('Only when mentioned');
    expect(screen.getByRole('status').textContent).toBe('Saved');

    setLive({ value: 'mentions' }, '$sent0');
    refresh();
    await act(async () => choose(''));
    expect(sentContent(1)).toEqual({});
    expect(shown()).toBe('Default');
  });

  it('writes the shown choice too, so Default clears a room without the event', async () => {
    mount();
    expect(shown()).toBe('Default');
    await act(async () => choose(''));
    expect(sentContent(0)).toEqual({});

    setLive({ value: 'auto' }, '$sent0');
    refresh();
    await act(async () => choose('auto'));
    expect(sentContent(1)).toEqual({ value: 'auto' });
  });

  it('keeps the saved choice until the room shows its own or a newer event', async () => {
    setLive({ value: 'auto' }, '$before');
    mount();
    const send = deferSend();
    choose('mentions');
    expect(menu().disabled).toBe(true);
    await send.resolve();
    expect(shown()).toBe('Only when mentioned');

    // A late echo of an event older than the save does not undo it.
    setLive({ value: 'auto' }, '$before');
    refresh();
    expect(shown()).toBe('Only when mentioned');

    // Another admin's newer event wins.
    setLive({ value: 'auto' }, '$someone-else');
    refresh();
    expect(shown()).toBe('Any message');
  });

  it('says when the room refuses the change and keeps showing its value', async () => {
    setLive({ value: 'auto' });
    mount();
    const send = deferSend();
    choose('mentions');
    await send.reject();
    expect(screen.getByRole('alert').textContent).toBe(FAILED);
    expect(shown()).toBe('Any message');
    expect(menu().disabled).toBe(false);
  });

  it('is read-only for someone who may not change room settings', () => {
    live.canSend = false;
    setLive({ value: 'mentions' });
    mount();
    expect(menu().disabled).toBe(true);
    expect(shown()).toBe('Only when mentioned');
    expect(screen.getByText(READ_ONLY)).toBeTruthy();
  });
});
