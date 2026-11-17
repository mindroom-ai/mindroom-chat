// @vitest-environment jsdom

import React from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_SETTINGS_EVENT } from '../../../matrix/protocol/roomSettings';
import { ROOM_SETTING_DEFINITIONS } from './roomSettingDefinitions';
import { RoomTextSettingTile } from './RoomTextSettingTile';

const ROOM = { roomId: '!r:example.org' } as Room;
const [DEFINITION] = ROOM_SETTING_DEFINITIONS;
const RULES = 'Use at most 4 words';

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
  const element =
    (tag: string) =>
    ({ as, children, ...props }: { as?: string; children?: React.ReactNode }) =>
      React.createElement(as ?? tag, props, children);
  return {
    Box: element('div'),
    Button: element('button'),
    Text: element('span'),
    TextArea: (props: Record<string, unknown>) => React.createElement('textarea', props),
    color: { Critical: { Main: 'red' } },
  };
});

let eventCount = 0;
/** The room's `thread_summary_instructions` event with `content`. */
const stateEvent = (content: object) => {
  eventCount += 1;
  const id = `$event${eventCount}`;
  return { getId: () => id, getContent: () => content } as unknown as MatrixEvent;
};

let renderer: ReactTestRenderer;
const render = () => {
  act(() => {
    renderer = create(<RoomTextSettingTile room={ROOM} definition={DEFINITION!} />);
  });
};
/** Draws the tile again, as a change of the room's state does. */
const rerender = () => {
  act(() => renderer.update(<RoomTextSettingTile room={ROOM} definition={DEFINITION!} />));
};

const field = () => renderer.root.findByType('textarea');
const button = (label: string): ReactTestInstance | undefined =>
  renderer.root
    .findAllByType('button')
    .find((node) => node.findAllByType('span').some((span) => span.props.children === label));
const texts = () =>
  renderer.root.findAllByType('span').flatMap((node) => {
    const { children } = node.props as { children?: unknown };
    return typeof children === 'string' ? [children] : [];
  });
const type = (value: string) => {
  act(() => {
    field().props.onChange({ currentTarget: { value } });
  });
};
const submit = async () => {
  await act(async () => {
    renderer.root.findByType('form').props.onSubmit({ preventDefault: () => undefined });
  });
};

beforeEach(() => {
  live.event = undefined;
  live.canSend = true;
  client.sendStateEvent.mockReset();
  client.sendStateEvent.mockResolvedValue({ event_id: '$sent' });
});

afterEach(() => {
  act(() => renderer.unmount());
});

describe('RoomTextSettingTile', () => {
  it("shows the room's value with its count, Clear, and Save only once the text changes", () => {
    live.event = stateEvent({ value: `  ${RULES}\n` });
    render();

    expect(live.stateArgs).toEqual([ROOM, ROOM_SETTINGS_EVENT, 'thread_summary_instructions']);
    expect(field().props.value).toBe(RULES);
    expect(field().props.maxLength).toBe(2000);
    expect(texts()).toContain(`${RULES.length} / 2000`);
    expect(texts()).toContain('Titles already set keep their wording until the next refresh.');
    expect(button('Clear')).toBeDefined();
    expect(button('Save')!.props.disabled).toBe(true);

    // White space around the same text changes nothing.
    type(`${RULES} `);
    expect(button('Save')!.props.disabled).toBe(true);

    type('Use at most 5 words');
    expect(button('Save')!.props.disabled).toBe(false);
    expect(texts()).toContain('19 / 2000');
  });

  it('shows an unset setting as an empty field without Clear', () => {
    live.event = stateEvent({});
    render();

    expect(field().props.value).toBe('');
    expect(field().props.placeholder).toBe('For example: Use at most 4 words after the emoji');
    expect(button('Clear')).toBeUndefined();
    expect(button('Save')!.props.disabled).toBe(true);
  });

  it('saves the trimmed text under the setting as its state key', async () => {
    render();
    type(`  ${RULES}\n`);
    await submit();

    expect(client.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(client.sendStateEvent).toHaveBeenCalledWith(
      ROOM.roomId,
      ROOM_SETTINGS_EVENT,
      { value: RULES },
      'thread_summary_instructions'
    );
    expect(field().props.value).toBe(RULES);
    expect(button('Save')!.props.disabled).toBe(true);
  });

  it('clears the setting with empty content', async () => {
    live.event = stateEvent({ value: RULES });
    render();
    await act(async () => {
      button('Clear')!.props.onClick();
    });

    expect(client.sendStateEvent).toHaveBeenCalledWith(
      ROOM.roomId,
      ROOM_SETTINGS_EVENT,
      {},
      'thread_summary_instructions'
    );
    expect(field().props.value).toBe('');
  });

  it("follows the room's state, and after a save takes what the room shows next", async () => {
    live.event = stateEvent({ value: RULES });
    render();

    live.event = stateEvent({ value: 'Use at most 6 words' });
    rerender();
    expect(field().props.value).toBe('Use at most 6 words');

    type('Use at most 3 words');
    await submit();
    // The room's state catches up, and then someone else changes it.
    live.event = stateEvent({ value: 'Use at most 3 words' });
    rerender();
    live.event = stateEvent({ value: 'Name the topic first' });
    rerender();
    expect(field().props.value).toBe('Name the topic first');
    expect(button('Save')!.props.disabled).toBe(true);
  });

  it('is read-only with a note for someone who may not send the setting', () => {
    live.canSend = false;
    live.event = stateEvent({ value: RULES });
    render();

    expect(live.permissionArgs).toEqual([ROOM_SETTINGS_EVENT, '@me:example.org']);
    expect(field().props.value).toBe(RULES);
    expect(field().props.readOnly).toBe(true);
    expect(button('Save')).toBeUndefined();
    expect(button('Clear')).toBeUndefined();
    expect(texts()).toContain("Only people allowed to change this room's settings can edit this.");
  });

  it('says so when the save fails, and keeps the text', async () => {
    client.sendStateEvent.mockRejectedValue(new Error('M_FORBIDDEN'));
    render();
    type(RULES);
    await submit();

    expect(texts()).toContain("Couldn't save the setting. Try again.");
    expect(field().props.value).toBe(RULES);
    expect(button('Save')!.props.disabled).toBe(false);

    // Typing again takes the error away.
    type(`${RULES}.`);
    expect(texts()).not.toContain("Couldn't save the setting. Try again.");
  });
});
