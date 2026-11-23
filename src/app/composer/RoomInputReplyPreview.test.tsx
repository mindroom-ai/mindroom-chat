import React from 'react';
import { RelationType, type Room } from 'matrix-js-sdk';
import { Icon, Icons } from 'folds';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import type { IReplyDraft } from './roomInputDrafts';
import { RoomInputReplyPreview } from './RoomInputReplyPreview';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('../messages/layout/layout', () => ({
  ReplyLayout: ({
    username,
    children,
  }: {
    username: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      {username}
      {children}
    </div>
  ),
}));
vi.mock('./RoomInputExtensions', () => ({
  RoomInputReplyContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../members/useMemberPowerTag', () => ({
  useGetMemberPowerTag: () => () => undefined,
}));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevelsContext: () => ({}) }));
vi.mock('../matrix/hooks/useRoom', () => ({ useIsDirectRoom: () => false }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../members/usePowerLevelTags', () => ({ usePowerLevelTags: () => ({}) }));
vi.mock('../theme/useTheme', () => ({ useTheme: () => ({ kind: 'light' }) }));
vi.mock('../preferences/useSetting', () => ({ useSetting: () => [false] }));

const room = {
  getMember: (userId: string) =>
    userId === '@alice:server' ? { userId, rawDisplayName: 'Alice' } : null,
} as unknown as Room;

const mountPreview = (draft: Partial<IReplyDraft>) => {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <RoomInputReplyPreview
        room={room}
        replyDraft={{ userId: '@mindroom_atlas:server', eventId: '$reply', body: '', ...draft }}
        submitPending={false}
        onCancel={() => undefined}
      />
    );
  });
  return renderer;
};

const renderPreview = (draft: Partial<IReplyDraft>) => {
  const renderer = mountPreview(draft);
  const text = JSON.stringify(renderer.toJSON());
  act(() => renderer.unmount());
  return text;
};

it('shows a canvas title as written, not as Markdown', () => {
  const body = 'Interactive panel: 1. Pick a time. Open it in MindRoom Chat to respond.';
  expect(renderPreview({ body, previewText: '1. Pick a time' })).toContain('"1. Pick a time"');
  // A title that would preview as a Markdown rule still shows.
  expect(renderPreview({ body, previewText: '---' })).toContain('"---"');
  // Members are named as in the sent quote.
  expect(renderPreview({ body, previewText: 'Pick a time with @alice:server' })).toContain(
    '"Pick a time with @Alice"'
  );
});

it('previews a message body without its Markdown', () => {
  expect(renderPreview({ body: '**Done** with `config.yaml`' })).toContain(
    '"Done with config.yaml"'
  );
});

it('shows the direction controls of a message or a canvas title as code points', () => {
  expect(renderPreview({ body: 'Open invoice‮txt.exe‬ now.' })).toContain(
    '"Open invoice<U+202E>txt.exe<U+202C> now."'
  );
  expect(renderPreview({ body: 'Interactive panel', previewText: 'Plan‮ weiver‬' })).toContain(
    '"Plan<U+202E> weiver<U+202C>"'
  );
});

it('shows a non-shrinking reply icon before the preview and cancel button after it for normal replies', () => {
  const renderer = mountPreview({ body: 'A very long reply body' });
  const row = renderer.toJSON() as {
    type: string;
    children: Array<{ type: string; props: Record<string, unknown> }>;
  };
  expect(row.children).toHaveLength(3);
  expect(row.children[0]?.type).toBe('svg');
  expect(row.children[1]?.type).toBe('div');
  expect(row.children[2]?.type).toBe('button');
  expect(row.children[2]?.props).toMatchObject({
    'aria-label': 'Cancel reply',
    style: { flexShrink: 0 },
  });

  const icons = renderer.root.findAllByType(Icon);
  expect(icons.map((icon) => icon.props.src)).toEqual([Icons.ReplyArrow, Icons.Cross]);
  expect(icons[0]?.props.style).toEqual({ flexShrink: 0 });
  expect(icons[0]?.props['data-directional']).toBe(true);
  act(() => renderer.unmount());
});

it('omits the reply arrow for thread replies and keeps the non-shrinking trailing cancel button', () => {
  const renderer = mountPreview({
    body: 'A very long thread reply body',
    relation: { rel_type: RelationType.Thread, event_id: '$root' },
  });
  const row = renderer.toJSON() as {
    type: string;
    children: Array<{ type: string; props: Record<string, unknown> }>;
  };
  expect(row.children).toHaveLength(2);
  expect(row.children[0]?.type).toBe('div');
  expect(row.children[1]?.type).toBe('button');
  expect(row.children[1]?.props).toMatchObject({
    'aria-label': 'Cancel reply',
    style: { flexShrink: 0 },
  });

  const icons = renderer.root.findAllByType(Icon);
  expect(icons.map((icon) => icon.props.src)).toEqual([Icons.Cross]);
  act(() => renderer.unmount());
});
