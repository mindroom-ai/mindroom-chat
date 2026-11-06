// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  EventType,
  MatrixEvent,
  RelationType,
  type IEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { Relations } from 'matrix-js-sdk/lib/models/relations';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { ClientConfigProvider } from '../config/useClientConfig';
import { RenderMessageContent } from '../messages/content/RenderMessageContent';
import { MessageRowBoundary } from '../messages/content/MessageRowBoundary';
import { describeRoomStateChange, RoomStateSentence } from '../messages/roomStateChange';
import { useMemberEventParser } from '../messages/useMemberEventParser';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';
import {
  AGENT_ONLY_CONTENT_KEYS,
  installEventContentGuard,
  trustAgentsOfViewer,
} from '../matrix/protocol/untrustedContent';
import {
  getAiRunInfo,
  getStreamStatusFromContent,
  isAiRunStreaming,
} from '../matrix/protocol/aiRun';
import {
  hasMindroomAgentMessageMetadata,
  isMindroomAgentMessageEvent,
} from '../matrix/protocol/agentIdentity';
import { getLongTextSource, hasLongTextMetadata } from '../matrix/protocol/longText';
import { getThreadSummaryEventInfo } from '../matrix/protocol/threadSummary';
import { getContentToolTraceEvents } from '../matrix/protocol/toolTrace';
import { getToolApprovalRenderContent } from '../matrix/protocol/toolApproval';
import { getActiveAnnotationsByKey } from '../matrix/protocol/reactionAnnotations';
import { estimateMessageRowHeight } from './timelineRowEstimate';

// Every event from the network is untrusted input: a member can send any JSON in any field. This
// feeds events of every kind (messages, edits, relations, reactions, state, MindRoom metadata)
// with values of every JSON type through the parsing paths and the message renderer, from a
// person and from an agent, and checks that nothing throws and no row needs its error boundary.

const boundaryErrors = vi.hoisted(() => [] as unknown[]);
vi.mock('../bug-reports/error-reporting/errorReporting', () => ({
  reportBoundaryError: (error: unknown) => boundaryErrors.push(error),
}));

const VIEWER = '@reader:example.org';
const AGENT = '@mindroom_helper:example.org';
const PERSON = '@person:example.org';
const ROOM = '!room:example.org';

/** One value of every JSON type, with the shapes that broke readers before. */
const ODD_VALUES: unknown[] = [
  'not an object',
  '',
  0,
  42,
  true,
  null,
  [],
  ['a', 1, null],
  {},
  { nested: { deeper: [1, { x: 'y' }] } },
  { event_id: 7, rel_type: {}, key: [] },
  '$not-a-known-event',
];

const MINDROOM_KEYS = [
  ...AGENT_ONLY_CONTENT_KEYS,
  'io.mindroom.long_text',
  'io.mindroom.thread_summary',
  'io.mindroom.tool_approval',
  'io.mindroom.ui_action',
  'io.mindroom.canvas_response',
  'io.mindroom.paste_attachment',
];

const MESSAGE_FIELDS = [
  'body',
  'msgtype',
  'format',
  'formatted_body',
  'url',
  'info',
  'file',
  'filename',
  'm.mentions',
  'geo_uri',
];

const RELATION_FIELDS = ['rel_type', 'event_id', 'key', 'm.in_reply_to', 'is_falling_back'];

let sequence = 0;
const makeEvent = (sender: string, content: unknown, extra: Partial<IEvent> = {}): MatrixEvent => {
  sequence += 1;
  return new MatrixEvent({
    type: EventType.RoomMessage,
    room_id: ROOM,
    event_id: `$event${sequence}`,
    sender,
    origin_server_ts: sequence,
    content,
    ...extra,
  } as Partial<IEvent>);
};

type Case = {
  name: string;
  build: (sender: string) => { target: MatrixEvent; edit?: MatrixEvent };
};

const message = (fields: Record<string, unknown>) => ({
  msgtype: 'm.text',
  body: 'a message',
  ...fields,
});

const cases: Case[] = [];
ODD_VALUES.forEach((value, index) => {
  const label = `value ${index} (${JSON.stringify(value)})`;
  MESSAGE_FIELDS.forEach((field) =>
    cases.push({
      name: `message ${field} = ${label}`,
      build: (sender) => ({ target: makeEvent(sender, message({ [field]: value })) }),
    })
  );
  cases.push({
    name: `content = ${label}`,
    build: (sender) => ({ target: makeEvent(sender, value) }),
  });
  cases.push({
    name: `edit m.new_content = ${label}`,
    build: (sender) => {
      const target = makeEvent(sender, message({ body: 'original' }));
      const edit = makeEvent(sender, {
        msgtype: 'm.text',
        body: '* edit',
        'm.new_content': value,
        'm.relates_to': { rel_type: RelationType.Replace, event_id: target.getId() },
      });
      return { target, edit };
    },
  });
  MESSAGE_FIELDS.forEach((field) =>
    cases.push({
      name: `edit m.new_content.${field} = ${label}`,
      build: (sender) => {
        const target = makeEvent(sender, message({ body: 'original' }));
        const edit = makeEvent(sender, {
          msgtype: 'm.text',
          body: '* edit',
          'm.new_content': message({ [field]: value }),
          'm.relates_to': { rel_type: RelationType.Replace, event_id: target.getId() },
        });
        return { target, edit };
      },
    })
  );
  cases.push({
    name: `m.relates_to = ${label}`,
    build: (sender) => ({ target: makeEvent(sender, message({ 'm.relates_to': value })) }),
  });
  RELATION_FIELDS.forEach((field) =>
    cases.push({
      name: `m.relates_to.${field} = ${label}`,
      build: (sender) => ({
        target: makeEvent(
          sender,
          message({
            'm.relates_to': { rel_type: 'm.thread', event_id: '$root', [field]: value },
          })
        ),
      }),
    })
  );
  MINDROOM_KEYS.forEach((key) => {
    cases.push({
      name: `${key} = ${label}`,
      build: (sender) => ({ target: makeEvent(sender, message({ [key]: value })) }),
    });
    cases.push({
      name: `edit m.new_content.${key} = ${label}`,
      build: (sender) => {
        const target = makeEvent(sender, message({ body: 'original' }));
        const edit = makeEvent(sender, {
          msgtype: 'm.text',
          body: '* edit',
          [key]: value,
          'm.new_content': message({ [key]: value }),
          'm.relates_to': { rel_type: RelationType.Replace, event_id: target.getId() },
        });
        return { target, edit };
      },
    });
  });
});

/** Every reader the timeline uses on an event before and while it renders it. */
const parse = (target: MatrixEvent, edit: MatrixEvent | undefined) => {
  target.getContent();
  target.getOriginalContent();
  target.getWireContent();
  target.getRelation();
  target.isRelation();
  void target.threadRootId;
  void target.replyEventId;
  void target.relationEventId;
  const edited = getEditedEvent(target.getId() ?? '', target, undefined, edit);
  const content = getLatestMessageContent(target, edited) as Record<string, unknown>;
  estimateMessageRowHeight(target, { compact: false });
  estimateMessageRowHeight(target, { compact: true });
  getAiRunInfo(content);
  isAiRunStreaming(content);
  getStreamStatusFromContent(content);
  hasMindroomAgentMessageMetadata(content);
  isMindroomAgentMessageEvent(target);
  hasLongTextMetadata(content);
  getLongTextSource(content);
  getThreadSummaryEventInfo(target);
  getContentToolTraceEvents(content);
  getToolApprovalRenderContent(target.getOriginalContent(), edited?.getContent());
  return { content, edited };
};

const mx = { getUserId: () => VIEWER } as unknown as MatrixClient;

const renderRows = (rows: (() => JSX.Element)[]): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <MatrixClientProvider value={mx}>
        <ClientConfigProvider value={{}}>
          {rows.map((render, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <MessageRowBoundary key={index} render={render} />
          ))}
        </ClientConfigProvider>
      </MatrixClientProvider>
    );
  });
  return renderer;
};

let renderer: ReactTestRenderer | undefined;

beforeAll(() => {
  installEventContentGuard();
  trustAgentsOfViewer(VIEWER);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  boundaryErrors.length = 0;
});

describe('events of any shape', () => {
  it(`parse and render without throwing (${cases.length} shapes, from a person and an agent)`, () => {
    const failures: string[] = [];
    const rows: (() => JSX.Element)[] = [];
    [PERSON, AGENT].forEach((sender) =>
      cases.forEach(({ name, build }) => {
        const { target, edit } = build(sender);
        if (edit) target.makeReplaced(edit);
        try {
          const { content, edited } = parse(target, edit);
          const msgtype = typeof content.msgtype === 'string' ? content.msgtype : '';
          rows.push(() => (
            <RenderMessageContent
              mEvent={target}
              eventId={target.getId() ?? undefined}
              roomId={ROOM}
              displayName="Sender"
              eventType={target.getType()}
              msgType={msgtype}
              ts={target.getTs()}
              edited={!!edited}
              getContent={(() => content) as never}
              urlPreview={false}
              htmlReactParserOptions={{}}
              linkifyOpts={{}}
            />
          ));
        } catch (error) {
          failures.push(`${sender} ${name}: ${String(error)}`);
        }
      })
    );
    expect(failures).toEqual([]);
    renderer = renderRows(rows);
    expect(boundaryErrors.map(String)).toEqual([]);
  });

  it('shows an edit whose m.new_content is unusable as the original message', () => {
    for (const value of ODD_VALUES.filter(
      (odd) => !odd || typeof odd !== 'object' || Array.isArray(odd)
    )) {
      const target = makeEvent(PERSON, message({ body: 'original' }));
      const edit = makeEvent(PERSON, {
        msgtype: 'm.text',
        body: '* edit',
        'm.new_content': value,
        'm.relates_to': { rel_type: RelationType.Replace, event_id: target.getId() },
      });
      target.makeReplaced(edit);
      const { content } = parse(target, edit);
      expect(content.body).toBe('original');
    }
  });

  it('gives no agent metadata to a person and keeps it for an agent', () => {
    const fields = {
      'io.mindroom.ai_run': { version: 1, model: { display_name: 'Survey Model' } },
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.tool_trace': { version: 2, events: [{ type: 'tool_call_completed' }] },
    };
    const fromPerson = parse(makeEvent(PERSON, message(fields)), undefined).content;
    expect(getAiRunInfo(fromPerson)).toBeUndefined();
    expect(isAiRunStreaming(fromPerson)).toBe(false);
    expect(getContentToolTraceEvents(fromPerson)).toBeUndefined();
    const fromAgent = parse(makeEvent(AGENT, message(fields)), undefined).content;
    expect(getAiRunInfo(fromAgent)?.modelDisplayName).toBe('Survey Model');
    expect(isAiRunStreaming(fromAgent)).toBe(true);
    expect(getContentToolTraceEvents(fromAgent)).toHaveLength(1);
  });

  it('aggregates reactions of any shape without throwing', async () => {
    const target = makeEvent(PERSON, message({}));
    const relations = new Relations(RelationType.Annotation, EventType.Reaction, mx);
    await relations.setTargetEvent(target);
    for (const value of ODD_VALUES) {
      for (const relation of [
        value,
        { rel_type: RelationType.Annotation, event_id: target.getId(), key: value },
        { rel_type: RelationType.Annotation, event_id: value, key: '👍' },
      ]) {
        const reaction = makeEvent(
          PERSON,
          { 'm.relates_to': relation },
          { type: EventType.Reaction }
        );
        // eslint-disable-next-line no-await-in-loop
        await relations.addEvent(reaction);
      }
    }
    const entries = getActiveAnnotationsByKey(relations);
    expect(entries.every(([key]) => typeof key === 'string')).toBe(true);
  });

  it('renders state events of any shape', () => {
    function StateRow({ event }: { event: MatrixEvent }) {
      const parseMember = useMemberEventParser();
      if (event.getType() === EventType.RoomMember) return <>{parseMember(event).body}</>;
      const change = describeRoomStateChange(event);
      return change ? <RoomStateSentence change={change} sender="Sender" /> : null;
    }
    const rows: (() => JSX.Element)[] = [];
    const stateFields: [string, string[]][] = [
      [EventType.RoomName, ['name']],
      [EventType.RoomTopic, ['topic']],
      [EventType.RoomAvatar, ['url', 'info']],
      [EventType.RoomMember, ['membership', 'displayname', 'avatar_url', 'reason']],
    ];
    ODD_VALUES.forEach((value) =>
      stateFields.forEach(([type, fields]) => {
        const all = [value, ...fields.map((field) => ({ [field]: value }))];
        all.forEach((content) => {
          const event = makeEvent(PERSON, content, {
            type,
            state_key: type === EventType.RoomMember ? PERSON : '',
            unsigned: { prev_content: value as never },
          });
          rows.push(() => <StateRow event={event} />);
        });
      })
    );
    renderer = renderRows(rows);
    expect(boundaryErrors.map(String)).toEqual([]);
  });

  it('keeps the other rows when one row fails to render', () => {
    // A row can fail while it is built and while one of its components renders.
    const Throws = (): JSX.Element => {
      throw new TypeError('Invalid value used as weak map key');
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderer = renderRows([
      () => <p>first row</p>,
      () => {
        throw new TypeError('Invalid value used as weak map key');
      },
      () => <Throws />,
      () => <p>fourth row</p>,
    ]);
    consoleError.mockRestore();
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('first row');
    expect(text).toContain('fourth row');
    expect(text.match(/Broken message/g)).toHaveLength(2);
    expect(boundaryErrors).toHaveLength(2);
  });
});
