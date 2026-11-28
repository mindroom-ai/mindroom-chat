// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MatrixEvent, type IContent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { clearLongTextHydrationCache, type LongTextSource } from '../../matrix/protocol/longText';
import {
  HOOK_SOURCE_KEY,
  TODO_POKE_CONTENT_KEY,
  type TodoPokeInfo,
} from '../../matrix/protocol/todoPoke';
import * as customHtmlCss from '../../rich-text/CustomHtml.css';
import { RenderMessageContent } from './RenderMessageContent';

const hydrationMocks = vi.hoisted(() => ({
  hydrateCachedLongText:
    vi.fn<(mx: MatrixClient, source: LongTextSource) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../event-store/cache/attachmentRepository', async () => {
  const actual = await vi.importActual<
    typeof import('../../event-store/cache/attachmentRepository')
  >('../../event-store/cache/attachmentRepository');
  return { ...actual, hydrateCachedLongText: hydrationMocks.hydrateCachedLongText };
});

vi.mock('../TodoPokeMarker', () => ({
  TodoPokeMarker: ({
    poke,
    ts,
    senderDisplayName,
  }: {
    poke: TodoPokeInfo;
    ts?: number;
    senderDisplayName?: string;
  }) => (
    <div
      data-todo-poke-stub="true"
      data-ts={String(ts)}
      data-sender={senderDisplayName ?? ''}
      data-total={String(poke.totalCount)}
      data-first-title={poke.items[0]?.title ?? ''}
    />
  ),
}));

const AGENT = '@mindroom_maya:example.org';
const POKE_CONTENT: IContent = {
  msgtype: 'm.text',
  body: '@mindroom_maya:example.org **2 todos ready**\n\n- Publish API changelog for v2.4 release — Medium · `a4f19c20`',
  [HOOK_SOURCE_KEY]: 'todo_poke',
  [TODO_POKE_CONTENT_KEY]: {
    version: 1,
    assigned_agent: 'maya',
    total_count: 2,
    items: [
      { id: 'a4f19c20', title: 'Publish API changelog for v2.4 release', priority: 'medium' },
    ],
  },
};

describe('RenderMessageContent todo poke', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    hydrationMocks.hydrateCachedLongText.mockReset();
    clearLongTextHydrationCache();
  });

  const renderPoke = async (
    sender: string,
    highlightRegex?: RegExp,
    content: IContent = POKE_CONTENT
  ) => {
    const mEvent = new MatrixEvent({
      type: 'm.room.message',
      room_id: '!room:example.org',
      event_id: '$poke',
      sender,
      origin_server_ts: 42_000,
      content,
    });
    const mx = {
      getUserId: () => '@reader:example.org',
      getHomeserverUrl: () => 'https://matrix.example.org',
      getRoom: () => null,
      on: () => undefined,
      removeListener: () => undefined,
    } as unknown as MatrixClient;
    await act(async () =>
      root.render(
        <MatrixClientProvider value={mx}>
          <ClientConfigProvider value={{}}>
            <RenderMessageContent
              mEvent={mEvent}
              roomId="!room:example.org"
              displayName="Maya"
              msgType={typeof content.msgtype === 'string' ? content.msgtype : 'm.text'}
              ts={42_000}
              getContent={(() => content) as never}
              urlPreview={false}
              highlightRegex={highlightRegex}
              htmlReactParserOptions={{}}
              linkifyOpts={{}}
            />
          </ClientConfigProvider>
        </MatrixClientProvider>
      )
    );
  };

  it('renders an agent todo poke as TodoPokeMarker and skips it for search highlights or persons', async () => {
    await renderPoke(AGENT);
    const stub = container.querySelector('[data-todo-poke-stub]');
    expect(stub?.getAttribute('data-sender')).toBe('Maya');
    expect(stub?.getAttribute('data-ts')).toBe('42000');
    expect(stub?.getAttribute('data-total')).toBe('2');

    await renderPoke(AGENT, /changelog/gi);
    expect(container.querySelector('[data-todo-poke-stub]')).toBeNull();
    expect(container.textContent).toContain('Publish API changelog');
    const highlighted = Array.from(container.querySelectorAll('span')).find(
      (span) =>
        span.textContent === 'changelog' &&
        (span.className === customHtmlCss.highlightText || span.style.borderRadius === '0.2em')
    );
    expect(highlighted).toBeDefined();

    await renderPoke('@person:example.org');
    expect(container.querySelector('[data-todo-poke-stub]')).toBeNull();
  });

  it('hydrates an m.file long-text todo poke preserving outer metadata while ignoring ordinary m.file', async () => {
    let resolveSidecar!: (value: Record<string, unknown>) => void;
    hydrationMocks.hydrateCachedLongText.mockReturnValue(
      new Promise((resolve) => {
        resolveSidecar = resolve;
      })
    );

    await renderPoke(AGENT, undefined, {
      msgtype: 'm.file',
      body: 'Preview...\n\n[Message continues in attached file]',
      filename: 'message.json',
      url: 'mxc://example.org/todo-sidecar',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      [HOOK_SOURCE_KEY]: 'todo_poke',
    });
    await act(async () => {
      resolveSidecar({
        msgtype: 'm.text',
        body: '@mindroom_maya:example.org Todo work is ready. Continue with these actionable items:\n- `a4f19c20` [high] `Publish API changelog for v2.4 release`',
      });
      await Promise.resolve();
    });

    const stub = container.querySelector('[data-todo-poke-stub]');
    expect(stub?.getAttribute('data-first-title')).toBe('Publish API changelog for v2.4 release');
    expect(stub?.getAttribute('data-sender')).toBe('Maya');
    // Bypassing MessageTextBody prevents compounded P400/P300 opacity on hydrated wake markers.
    expect(stub?.closest('[data-body-direction]')).toBeNull();

    await renderPoke(AGENT, undefined, {
      msgtype: 'm.file',
      body: 'tasks.json',
      url: 'mxc://example.org/tasks',
      info: { mimetype: 'application/json', size: 64 },
      [TODO_POKE_CONTENT_KEY]: POKE_CONTENT[TODO_POKE_CONTENT_KEY],
    });
    expect(container.querySelector('[data-todo-poke-stub]')).toBeNull();
    expect(container.textContent).toContain('tasks.json');
  });
});
