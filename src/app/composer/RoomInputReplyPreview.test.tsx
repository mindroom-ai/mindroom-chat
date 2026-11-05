import React from 'react';
import type { Room } from 'matrix-js-sdk';
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
  useAccessiblePowerTagColors: () => new Map(),
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

const renderPreview = (draft: Partial<IReplyDraft>) => {
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
