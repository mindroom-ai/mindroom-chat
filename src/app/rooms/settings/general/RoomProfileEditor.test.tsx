// @vitest-environment jsdom

import React from 'react';
import type { Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { RoomProfileEditor } from './RoomProfileEditor';

// A room's name and topic show their direction controls as code points, while editing them
// starts from, and saves, the exact text.

const NAME = 'Payroll ‮sevihcra‬';
const TOPIC = 'Where we file ‮stpiecer‬ for the audit';

const client = {
  getSafeUserId: () => '@me:example.org',
  setRoomName: vi.fn(async () => ({})),
  setRoomTopic: vi.fn(async () => ({})),
};

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('../../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../../../matrix/hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../../../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../../../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ stateEvent: () => true }),
}));
vi.mock('../../../matrix/hooks/useRoomMeta', () => ({
  useRoomName: () => NAME,
  useRoomTopic: () => TOPIC,
}));
vi.mock('../../../ui/SettingTile', () => ({
  SettingTile: ({
    title,
    description,
    after,
  }: {
    title: string;
    description?: string;
    after?: React.ReactNode;
  }) => React.createElement('div', null, title, description, after),
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
    Input: (props: Record<string, unknown>) => React.createElement('input', props),
    TextArea: (props: Record<string, unknown>) => React.createElement('textarea', props),
    color: { Critical: { Main: 'red' } },
  };
});

it('shows the name and topic with code points and edits their exact text', () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<RoomProfileEditor room={{ roomId: '!r:example.org' } as Room} />);
  });
  const shown = JSON.stringify(renderer.toJSON());
  expect(shown).toContain('Payroll <U+202E>sevihcra<U+202C>');
  expect(shown).toContain('Where we file <U+202E>stpiecer<U+202C> for the audit');
  expect(shown).not.toMatch(/[‪-‮]/);

  act(() => {
    renderer.root.findByType('button').props.onClick();
  });
  expect(renderer.root.findByProps({ id: 'room-profile-name' }).props.value).toBe(NAME);
  expect(renderer.root.findByProps({ id: 'room-profile-topic' }).props.value).toBe(TOPIC);

  // Saving without a change writes nothing back.
  act(() => {
    renderer.root.findByType('form').props.onSubmit({ preventDefault: () => undefined });
  });
  expect(client.setRoomName).not.toHaveBeenCalled();
  expect(client.setRoomTopic).not.toHaveBeenCalled();
  act(() => renderer.unmount());
});
