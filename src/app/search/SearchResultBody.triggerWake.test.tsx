// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../config/useClientConfig';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { SearchResultBody } from './SearchResultBody';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  const { translateFromEn } = await import('../../test/utils/i18n');
  return {
    ...actual,
    useTranslation: () => ({
      t: translateFromEn,
      i18n: { language: 'en', resolvedLanguage: 'en' },
    }),
  };
});

vi.mock('../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

const ROOM_ID = '!ops:example.org';

afterEach(() => {
  cleanup();
});

describe('SearchResultBody trigger wake preview', () => {
  it('renders TriggerWakeMarker trigger ID as plain text without a View trigger link', () => {
    const room = {
      roomId: ROOM_ID,
      name: 'Ops',
      getMember: () => null,
      getJoinedMembers: () => [],
      getCanonicalAlias: () => null,
      getAltAliases: () => [],
    } as unknown as Room;
    const client = {
      getUserId: () => '@reader:example.org',
      getRoom: (id: string) => (id === ROOM_ID ? room : null),
      getRooms: () => [room],
      on: () => undefined,
      removeListener: () => undefined,
    } as unknown as MatrixClient;

    render(
      <JotaiProvider store={createStore()}>
        <MatrixClientProvider value={client}>
          <ClientConfigProvider value={{}}>
            <MemoryRouter>
              <SearchResultBody
                room={room}
                highlights={[]}
                item={{
                  rank: 1,
                  context: { events_before: [], events_after: [], profile_info: {} },
                  event: {
                    type: 'm.room.message',
                    room_id: ROOM_ID,
                    event_id: '$wake',
                    sender: '@mindroom_helper:example.org',
                    origin_server_ts: 42_000,
                    content: {
                      msgtype: 'm.text',
                      body: '@mindroom_helper:example.org Check staging deploy',
                      'com.mindroom.source_kind': 'external_trigger',
                      'io.mindroom.external_trigger.id': 'deploy-hook',
                      'io.mindroom.external_trigger.kind': 'deploy.finished',
                    },
                  },
                }}
              />
            </MemoryRouter>
          </ClientConfigProvider>
        </MatrixClientProvider>
      </JotaiProvider>
    );

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(document.querySelector('[data-trigger-wake-link]')).toBeNull();
    expect(screen.queryByRole('button', { name: /View trigger/ })).toBeNull();
    expect(document.querySelector('[data-trigger-wake-details]')?.textContent).toContain(
      'Trigger deploy-hook'
    );
  });
});
