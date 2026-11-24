// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MatrixEvent, type IContent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { clearLongTextHydrationCache, type LongTextSource } from '../../matrix/protocol/longText';
import type { TriggerWakeInfo } from '../../matrix/protocol/triggerWake';
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
  return {
    ...actual,
    hydrateCachedLongText: hydrationMocks.hydrateCachedLongText,
  };
});

vi.mock('../TriggerWakeMarker', () => ({
  TriggerWakeMarker: ({
    wake,
    ts,
    roomId,
  }: {
    wake: TriggerWakeInfo;
    ts?: number;
    roomId?: string;
  }) => (
    <div
      data-trigger-wake-stub={wake.sourceKind}
      data-ts={String(ts)}
      data-room-id={roomId ?? ''}
      data-kind={wake.kind ?? ''}
      data-prompt={wake.prompt}
      data-event-json={wake.eventJson ?? ''}
      data-raw-body={wake.rawBody}
    >
      {wake.triggerId}
    </div>
  ),
}));

const VIEWER = '@reader:example.org';
const AGENT = '@mindroom_helper:example.org';
const PERSON = '@person:example.org';
const ROOM_ID = '!room:example.org';

const WAKE_CONTENT: IContent = {
  msgtype: 'm.text',
  body: '@mindroom_helper:example.org Check staging deploy',
  'com.mindroom.source_kind': 'external_trigger',
  'io.mindroom.external_trigger.id': 'deploy-hook',
  'io.mindroom.external_trigger.kind': 'deploy.finished',
};

describe('RenderMessageContent trigger wake', () => {
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

  const renderWake = async (
    sender: string,
    highlightRegex?: RegExp,
    content: IContent = WAKE_CONTENT
  ) => {
    const msgType = typeof content.msgtype === 'string' ? content.msgtype : 'm.text';
    const mEvent = new MatrixEvent({
      type: 'm.room.message',
      room_id: ROOM_ID,
      event_id: '$wake',
      sender,
      origin_server_ts: 42_000,
      content,
    });
    const mx = {
      getUserId: () => VIEWER,
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
              roomId={ROOM_ID}
              displayName="Helper"
              msgType={msgType}
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

  it('renders a MindRoom agent trigger wake as TriggerWakeMarker in room/non-thread views', async () => {
    await renderWake(AGENT);
    const stub = container.querySelector('[data-trigger-wake-stub]');
    expect(stub?.getAttribute('data-trigger-wake-stub')).toBe('external');
    expect(stub?.getAttribute('data-ts')).toBe('42000');
    expect(stub?.textContent).toBe('deploy-hook');
  });

  it('renders highlighted text instead of TriggerWakeMarker when highlightRegex is provided', async () => {
    await renderWake(AGENT, /staging/gi);
    expect(container.querySelector('[data-trigger-wake-stub]')).toBeNull();
    expect(container.textContent).toContain('Check staging deploy');
    const highlighted = Array.from(container.querySelectorAll('span')).find(
      (span) =>
        span.textContent === 'staging' &&
        (span.className === customHtmlCss.highlightText || span.style.borderRadius === '0.2em')
    );
    expect(highlighted).toBeDefined();
  });

  it('renders a person lookalike as regular message text', async () => {
    await renderWake(PERSON);
    expect(container.querySelector('[data-trigger-wake-stub]')).toBeNull();
    expect(container.textContent).toContain('Check staging deploy');
  });

  it('hydrates an m.file io.mindroom.long_text trigger wake into TriggerWakeMarker with full prompt, JSON, and Copy text', async () => {
    const fullBody = [
      '@mindroom_helper:example.org Full webhook summary',
      '',
      '```json',
      '{"deploy": "prod", "ok": true}',
      '```',
    ].join('\n');
    let resolveSidecar!: (value: Record<string, unknown>) => void;
    hydrationMocks.hydrateCachedLongText.mockReturnValue(
      new Promise((resolve) => {
        resolveSidecar = resolve;
      })
    );

    const longWakeContent: IContent = {
      msgtype: 'm.file',
      body: '@mindroom_helper:example.org Preview...\n\n[Message continues in attached file]',
      filename: 'message.json',
      url: 'mxc://example.org/wake-sidecar',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      'com.mindroom.source_kind': 'external_trigger',
      'io.mindroom.external_trigger.id': 'deploy-hook',
      'io.mindroom.external_trigger.kind': 'deploy.finished',
    };

    await renderWake(AGENT, undefined, longWakeContent);

    const previewStub = container.querySelector('[data-trigger-wake-stub]');
    expect(previewStub?.getAttribute('data-trigger-wake-stub')).toBe('external');
    expect(previewStub?.getAttribute('data-ts')).toBe('42000');
    expect(previewStub?.getAttribute('data-room-id')).toBe(ROOM_ID);
    expect(previewStub?.textContent).toBe('deploy-hook');

    await act(async () => {
      // Sidecar omits outer trigger keys to prove outer metadata is preserved.
      resolveSidecar({ msgtype: 'm.text', body: fullBody });
      await Promise.resolve();
    });

    const hydratedStub = container.querySelector('[data-trigger-wake-stub]');
    expect(hydratedStub?.getAttribute('data-trigger-wake-stub')).toBe('external');
    expect(hydratedStub?.getAttribute('data-kind')).toBe('deploy.finished');
    expect(hydratedStub?.getAttribute('data-prompt')).toBe('Full webhook summary');
    expect(hydratedStub?.getAttribute('data-event-json')).toBe('{"deploy": "prod", "ok": true}');
    expect(hydratedStub?.getAttribute('data-raw-body')).toBe(fullBody);
  });

  it('keeps an ordinary m.file attachment out of TriggerWakeMarker even with trigger metadata', async () => {
    const ordinaryFile: IContent = {
      msgtype: 'm.file',
      body: 'report.json',
      url: 'mxc://example.org/report',
      info: { mimetype: 'application/json', size: 128 },
      'com.mindroom.source_kind': 'external_trigger',
      'io.mindroom.external_trigger.id': 'deploy-hook',
    };

    await renderWake(AGENT, undefined, ordinaryFile);

    expect(container.querySelector('[data-trigger-wake-stub]')).toBeNull();
    expect(container.textContent).toContain('report.json');
  });
});
