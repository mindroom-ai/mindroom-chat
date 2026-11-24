// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MatrixEvent, type IContent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider } from '../../config/useClientConfig';
import type { TriggerWakeInfo } from '../../matrix/protocol/triggerWake';
import * as customHtmlCss from '../../rich-text/CustomHtml.css';
import { RenderMessageContent } from './RenderMessageContent';

vi.mock('../TriggerWakeMarker', () => ({
  TriggerWakeMarker: ({ wake, ts }: { wake: TriggerWakeInfo; ts?: number }) => (
    <div data-trigger-wake-stub={wake.sourceKind} data-ts={String(ts)}>
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
  });

  const renderWake = async (sender: string, highlightRegex?: RegExp) => {
    const mEvent = new MatrixEvent({
      type: 'm.room.message',
      room_id: ROOM_ID,
      event_id: '$wake',
      sender,
      origin_server_ts: 42_000,
      content: WAKE_CONTENT,
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
              msgType="m.text"
              ts={42_000}
              getContent={(() => WAKE_CONTENT) as never}
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
});
