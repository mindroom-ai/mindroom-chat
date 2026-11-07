import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import type { CDPSession, Page } from '@playwright/test';
import {
  DISPOSABLE_HOMESERVER,
  registerDisposableUser,
  type DisposableUser,
} from './disposableAccounts';
import {
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  type MatrixSession,
} from './matrix';

/**
 * A room with many threads written the way MindRoom's agents write them, agents that keep
 * streaming in it, and a recorder of what the reader sees in every animation frame while they
 * scroll it (e2e/perf/thread-scroll-jitter.live.spec.ts and the scroll stability specs).
 */

export type RoomView = 'compact' | 'threaded' | 'classic';

export const send = async (
  session: MatrixSession,
  roomId: string,
  type: string,
  content: Record<string, unknown>
): Promise<string> => {
  const body = await matrixFetch<{ event_id: string }>(
    DISPOSABLE_HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/send/${type}/${randomUUID()}`,
    { method: 'PUT', accessToken: session.accessToken, body: JSON.stringify(content) }
  );
  return body.event_id;
};

const redact = async (session: MatrixSession, roomId: string, eventId: string) =>
  matrixFetch(
    DISPOSABLE_HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${randomUUID()}`,
    { method: 'PUT', accessToken: session.accessToken, body: JSON.stringify({}) }
  );

const upload = async (session: MatrixSession, bytes: Buffer, type: string): Promise<string> => {
  const response = await fetch(`${DISPOSABLE_HOMESERVER}/_matrix/media/v3/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': type },
    body: bytes,
  });
  const body = (await response.json()) as { content_uri: string };
  return body.content_uri;
};

const setProfile = async (session: MatrixSession, displayname: string, avatarUrl?: string) => {
  const path = `/profile/${encodeURIComponent(session.userId)}`;
  await matrixFetch(DISPOSABLE_HOMESERVER, `${path}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname }),
  });
  if (avatarUrl) {
    await matrixFetch(DISPOSABLE_HOMESERVER, `${path}/avatar_url`, {
      method: 'PUT',
      accessToken: session.accessToken,
      body: JSON.stringify({ avatar_url: avatarUrl }),
    });
  }
};

const inThread = (rootId: string, replyTo: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: replyTo },
  },
});

/** Runs `work` over `items` with at most `limit` at a time. */
const pool = async <T>(items: T[], limit: number, work: (item: T) => Promise<void>) => {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    })
  );
};

export const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** A `width` x `height` PNG with a colour gradient, so pictures and avatars have real bytes to decode. */
const png = (width: number, height: number, hue: number): Buffer => {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(2, 9);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = (hue + x) % 256;
      raw[row + 2 + x * 3] = (y * 255) / height;
      raw[row + 3 + x * 3] = 160;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const TOPICS = [
  'the release checklist for the mobile build',
  'why the nightly import job ran twice',
  'a budget summary for the next quarter',
  'the onboarding guide for new contributors',
  'which cache settings the staging cluster uses',
  'a plan for the database migration',
  'the failing integration test on the payments page',
  'notes from the design review',
];

export const question = (index: number): string => {
  const topic = TOPICS[index % TOPICS.length] ?? 'the plan';
  const lengths = [
    `Can you look at ${topic}?`,
    `Can you look at ${topic}? I need a short answer before the meeting this afternoon, with the open questions listed.`,
    `I went through ${topic} this morning and something does not add up. The numbers in the second table do not match what we saw last week, and the comments disagree about who owns the follow-up. Could you compare both versions, tell me which one is right, and draft a reply for the team?`,
  ];
  return `${lengths[index % lengths.length]} (#${index})`;
};

/** An agent's finished answer: Markdown with a heading, paragraphs, a list and a code block. */
const answer = (index: number): { body: string; html: string } => {
  const topic = TOPICS[index % TOPICS.length] ?? 'the plan';
  const paragraphs = 1 + (index % 4);
  const sentence = `I compared the current version of ${topic} with the previous one and checked each change against the notes from last week.`;
  const text = Array.from({ length: paragraphs }, (_, p) =>
    Array.from({ length: 2 + ((index + p) % 3) }, () => sentence).join(' ')
  );
  const items = ['Owner and due date are set', 'Two numbers changed', 'One question is still open'];
  const code = index % 3 === 0 ? `\n\n\`\`\`bash\nnpm run check -- --thread ${index}\n\`\`\`` : '';
  const body = `## Summary for #${index}\n\n${text.join('\n\n')}\n\n${items
    .map((item) => `- ${item}`)
    .join('\n')}${code}`;
  const codeHtml =
    index % 3 === 0
      ? `<pre><code class="language-bash">npm run check -- --thread ${index}\n</code></pre>\n`
      : '';
  const html = `<h2>Summary for #${index}</h2>\n${text
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join('\n')}\n<ul>\n${items.map((item) => `<li>${item}</li>`).join('\n')}\n</ul>\n${codeHtml}`;
  return { body, html };
};

/** An agent's reply as MindRoom writes it: "Thinking...", a stop reaction, edits, the final edit. */
export const agentReply = async (
  agent: MatrixSession,
  roomId: string,
  rootId: string,
  replyTo: string,
  index: number,
  edits = 1,
  editMs = 700
): Promise<string> => {
  const replyId = await send(agent, roomId, 'm.room.message', {
    msgtype: 'm.text',
    body: 'Thinking...',
    format: 'org.matrix.custom.html',
    formatted_body: '<p>Thinking...</p>\n',
    'io.mindroom.stream_status': 'pending',
    ...inThread(rootId, replyTo),
  });
  const stopId = await send(agent, roomId, 'm.reaction', {
    'm.relates_to': { rel_type: 'm.annotation', event_id: replyId, key: '🛑' },
  });
  const final = answer(index);
  for (let edit = 1; edit <= edits; edit += 1) {
    const last = edit === edits;
    const cut = last ? final.body.length : Math.round((final.body.length * edit) / edits);
    const body = final.body.slice(0, cut);
    const content = {
      msgtype: 'm.text',
      body,
      format: 'org.matrix.custom.html',
      formatted_body: last ? final.html : `<p>${body}</p>`,
      'io.mindroom.stream_status': last ? 'completed' : 'streaming',
    };
    await send(agent, roomId, 'm.room.message', {
      ...content,
      body: `* ${body}`,
      'm.new_content': content,
      'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
    });
    if (!last) await wait(editMs);
  }
  await redact(agent, roomId, stopId);
  return replyId;
};

const title = (
  agent: MatrixSession,
  roomId: string,
  rootId: string,
  replyTo: string,
  text: string
) =>
  send(agent, roomId, 'm.room.message', {
    msgtype: 'm.notice',
    body: text,
    'io.mindroom.thread_summary': {
      version: 1,
      summary: text,
      message_count: 2,
      generated_at: new Date().toISOString(),
      model: 'test',
    },
    ...inThread(rootId, replyTo),
  });

export type BusyThreadRoom = {
  reader: DisposableUser;
  peer: DisposableUser;
  agents: MatrixSession[];
  roomId: string;
  rootIds: string[];
  pictureUri: string;
};

/**
 * A room of `threads` threads the way MindRoom writes them, for a reader with `otherRooms` other
 * rooms: a person's question (some of them pictures), an agent's "Thinking..." reply finished by
 * an edit with a Markdown answer and its stop reaction redacted, a title notice in three threads
 * of four, a thumbs up in one of five, and in one of three a follow-up question answered again,
 * which leaves the title out of the thread's newest event.
 */
export const buildBusyThreadRoom = async ({
  threads,
  otherRooms = 25,
  password,
}: {
  threads: number;
  otherRooms?: number;
  password: string;
}): Promise<BusyThreadRoom> => {
  const run = randomUUID().slice(0, 8);
  const reader = await registerDisposableUser(`busy-reader-${run}`, password);
  const peer = await registerDisposableUser(`busy-peer-${run}`, password);
  await setProfile(reader, 'Reader');
  await setProfile(peer, 'Sam Rivera');
  const picture = png(640, 400, 40);
  const pictureUri = await upload(peer, picture, 'image/png');
  const agents = await Promise.all(
    ['research', 'code', 'writer', 'ops'].map((name) =>
      registerAgentAccount(DISPOSABLE_HOMESERVER, name)
    )
  );
  await Promise.all(
    agents.map(async (agent, index) =>
      setProfile(
        agent,
        ['Research', 'Code', 'Writer', 'Ops'][index] ?? 'Agent',
        await upload(agent, png(96, 96, index * 60), 'image/png')
      )
    )
  );
  const roomId = await createPrivateRoom(DISPOSABLE_HOMESERVER, reader.accessToken, {
    name: 'Planning',
    topic: 'Questions for the agents',
    invite: [peer.userId, ...agents.map((agent) => agent.userId)],
  });
  await Promise.all(
    [peer, ...agents].map((session) => joinRoom(DISPOSABLE_HOMESERVER, session.accessToken, roomId))
  );
  await pool(
    Array.from({ length: otherRooms }, (_, index) => index),
    6,
    async (index) => {
      const other = await createPrivateRoom(DISPOSABLE_HOMESERVER, peer.accessToken, {
        name: `Project ${index + 1}`,
        topic: 'Another room',
        invite: [reader.userId],
      });
      await joinRoom(DISPOSABLE_HOMESERVER, reader.accessToken, other);
      await send(peer, other, 'm.room.message', {
        msgtype: 'm.text',
        body: `Status update ${
          index + 1
        }: the review is done and the notes are in the shared folder.`,
      });
    }
  );

  const rootIds: string[] = new Array<string>(threads);
  await pool(
    Array.from({ length: threads }, (_, index) => index),
    12,
    async (index) => {
      const asker = index % 3 === 0 ? peer : reader;
      const agent = agents[index % agents.length] ?? agents[0]!;
      const rootId =
        index % 11 === 5
          ? await send(asker, roomId, 'm.room.message', {
              msgtype: 'm.image',
              body: `screenshot-${index}.png`,
              url: pictureUri,
              // Every other picture comes without its size, as some uploads do.
              ...(index % 22 === 5
                ? {}
                : { info: { mimetype: 'image/png', w: 640, h: 400, size: picture.length } }),
            })
          : await send(asker, roomId, 'm.room.message', {
              msgtype: 'm.text',
              body: question(index),
            });
      rootIds[index] = rootId;
      let last = await agentReply(agent, roomId, rootId, rootId, index);
      if (index % 4 !== 3) {
        last = await title(
          agent,
          roomId,
          rootId,
          last,
          `${TOPICS[index % TOPICS.length]} #${index}`
        );
      }
      if (index % 5 === 0) {
        await send(peer, roomId, 'm.reaction', {
          'm.relates_to': { rel_type: 'm.annotation', event_id: last, key: '👍' },
        });
      }
      if (index % 3 === 1) {
        const followUp = await send(asker, roomId, 'm.room.message', {
          msgtype: 'm.text',
          body: `Thanks. One more thing about #${index}: can you add the dates?`,
          ...inThread(rootId, last),
        });
        await agentReply(agent, roomId, rootId, followUp, index + 1);
      }
    }
  );
  return { reader, peer, agents, roomId, rootIds, pictureUri };
};

export type AgentStreams = { stop: () => Promise<void> };

/** Agents keep streaming: new threads, and replies in older ones the reader scrolls past. */
export const startAgentStreams = (
  world: BusyThreadRoom,
  streams: number,
  editMs = 700
): AgentStreams => {
  let running = true;
  const stream = async (agent: MatrixSession, index: number) => {
    await wait(index * 400);
    for (let round = 0; running; round += 1) {
      const n = world.rootIds.length + index * 1000 + round;
      if (round % 2 === 0) {
        const rootId = await send(world.peer, world.roomId, 'm.room.message', {
          msgtype: 'm.text',
          body: question(n),
        });
        await agentReply(agent, world.roomId, rootId, rootId, n, 8, editMs);
      } else {
        const rootId = world.rootIds[(index * 37 + round * 13) % world.rootIds.length]!;
        await agentReply(agent, world.roomId, rootId, rootId, n, 8, editMs);
      }
    }
  };
  const done = Promise.all(
    world.agents
      .slice(0, streams)
      .map((agent, index) => stream(agent, index).catch(() => undefined))
  );
  return {
    stop: async () => {
      running = false;
      await done;
    },
  };
};

/** Installed before the app: React commits, long tasks, frames and layout shifts. */
export const instrumentScrolling = () => {
  type Row = { top: number; h: number; text: string };
  const state = {
    recording: false,
    rowSelector: '',
    keyAttribute: '',
    scroller: null as HTMLElement | null,
    frames: [] as number[],
    commits: 0,
    longTasks: [] as number[],
    loaf: [] as { duration: number; blocking: number; scripts: string[] }[],
    layoutShifts: [] as { value: number; sources: string[] }[],
    writes: [] as { kind: string; value: number; from: number; t: number; stack: string }[],
    lastInput: 0,
    driving: false,
    quietMs: 400,
    writeDelta: 0,
    moveFrames: 0,
    layoutFrames: 0,
    quietFrames: 0,
    moves: [] as {
      t: number;
      kind: string;
      px: number;
      median: number;
      dScroll: number;
      appDelta: number;
      inputAge: number;
      dHeight?: number;
      mounted?: number;
      first?: string;
      rows: string[];
    }[],
    heightChanges: [] as {
      t: number;
      key: string;
      from: number;
      to: number;
      before: string;
      after: string;
    }[],
    textChanges: [] as { t: number; key: string; before: string; after: string }[],
    maxMove: 0,
    totalMove: 0,
    scrolled: 0,
    prev: new Map<string, Row>(),
    prevTop: 0,
    prevHeight: 0,
    last: 0,
  };
  (window as unknown as { __jitter: typeof state }).__jitter = state;

  // React announces each commit to the developer tools hook; count them while recording.
  const hookWindow = window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
  if (!hookWindow.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    let renderer = 0;
    hookWindow.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      isDisabled: false,
      renderers: new Map(),
      inject() {
        renderer += 1;
        return renderer;
      },
      checkDCE() {},
      onScheduleFiberRoot() {},
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      onCommitFiberRoot() {
        if (state.recording) state.commits += 1;
      },
    };
  }

  const describe = (node: Node | null | undefined): string => {
    const element = node instanceof Element ? node : node?.parentElement;
    if (!element) return '?';
    const row = element.closest('[data-scroll-anchor],[data-message-id]');
    const key = row?.getAttribute('data-scroll-anchor') ?? row?.getAttribute('data-message-id');
    const own = `${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0] ?? ''}`;
    return key ? `${own} in ${key.slice(0, 12)}` : own;
  };
  try {
    new PerformanceObserver((entries) => {
      if (!state.recording) return;
      entries.getEntries().forEach((entry) => state.longTasks.push(Math.round(entry.duration)));
    }).observe({ type: 'longtask', buffered: false });
  } catch {
    // WebKit has no long task entries.
  }
  try {
    new PerformanceObserver((entries) => {
      if (!state.recording) return;
      entries.getEntries().forEach((entry) => {
        const frame = entry as PerformanceEntry & {
          blockingDuration: number;
          scripts: { invoker: string; sourceFunctionName: string; duration: number }[];
        };
        state.loaf.push({
          duration: Math.round(frame.duration),
          blocking: Math.round(frame.blockingDuration),
          scripts: frame.scripts
            .filter((script) => script.duration > 5)
            .map(
              (script) =>
                `${script.invoker}|${script.sourceFunctionName}|${Math.round(script.duration)}`
            ),
        });
      });
    }).observe({ type: 'long-animation-frame', buffered: false });
  } catch {
    // Only Chromium reports long animation frames.
  }
  try {
    new PerformanceObserver((entries) => {
      if (!state.recording) return;
      entries.getEntries().forEach((entry) => {
        const shift = entry as PerformanceEntry & {
          value: number;
          sources: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[];
        };
        state.layoutShifts.push({
          value: shift.value,
          sources: shift.sources.map(
            (source) =>
              `${describe(source.node)} ${Math.round(source.previousRect.top)}/${Math.round(
                source.previousRect.height
              )} -> ${Math.round(source.currentRect.top)}/${Math.round(source.currentRect.height)}`
          ),
        });
      });
    }).observe({ type: 'layout-shift', buffered: false });
  } catch {
    // Only Chromium reports layout shifts.
  }

  // The app's own writes of the scroll offset.
  const record = (kind: string, element: unknown, value: number) => {
    if (!state.recording || state.driving || element !== state.scroller || !state.scroller) return;
    state.writeDelta += value - state.scroller.scrollTop;
    state.writes.push({
      kind,
      value: Math.round(value),
      from: Math.round(state.scroller.scrollTop),
      t: Math.round(performance.now()),
      stack: (new Error().stack ?? '').split('\n').slice(2, 7).join(' < '),
    });
  };
  const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  if (scrollTop?.get && scrollTop.set) {
    const { get, set } = scrollTop;
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get() {
        return get.call(this);
      },
      set(value: number) {
        record('scrollTop', this, value);
        set.call(this, value);
      },
    });
  }
  (['scrollTo', 'scrollBy'] as const).forEach((name) => {
    const original = Element.prototype[name] as (...args: unknown[]) => void;
    Element.prototype[name] = function wrapped(this: Element, ...args: unknown[]) {
      const first = args[0];
      const top =
        typeof first === 'object' && first !== null ? (first as { top?: number }).top : args[1];
      if (typeof top === 'number')
        record(name, this, name === 'scrollBy' ? this.scrollTop + top : top);
      original.apply(this, args);
    } as typeof Element.prototype.scrollTo;
  });

  const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').slice(0, 160);
  // Input the reader gave: wheel, touch and keys. Rows may move only while it scrolls them.
  ['wheel', 'touchstart', 'touchmove', 'touchend', 'keydown'].forEach((type) =>
    window.addEventListener(
      type,
      () => {
        state.lastInput = performance.now();
      },
      { capture: true, passive: true }
    )
  );
  const tick = (now: number) => {
    if (state.recording && state.scroller) {
      if (state.last) state.frames.push(now - state.last);
      state.last = now;
      const scroller = state.scroller;
      const top = scroller.scrollTop;
      const dScroll = top - state.prevTop;
      const appDelta = state.writeDelta;
      state.writeDelta = 0;
      state.scrolled += Math.abs(dScroll);
      const view = scroller.getBoundingClientRect();
      const current = new Map<string, Row>();
      const moved: { key: string; d: number }[] = [];
      scroller.querySelectorAll(state.rowSelector).forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.bottom <= view.top || rect.top >= view.bottom || rect.height === 0) return;
        const key = element.getAttribute(state.keyAttribute);
        if (!key) return;
        const row = { top: rect.top, h: rect.height, text: text(element) };
        current.set(key, row);
        const before = state.prev.get(key);
        if (!before) return;
        // Only rows on screen in both frames, by more than a sliver, count.
        const shown = Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top);
        if (shown > 8 && before.top < view.bottom - 8 && before.top + before.h > view.top + 8) {
          moved.push({ key, d: row.top - before.top });
        }
        if (Math.abs(row.h - before.h) >= 1 && state.heightChanges.length < 300) {
          state.heightChanges.push({
            t: Math.round(now),
            key: key.slice(0, 14),
            from: Math.round(before.h),
            to: Math.round(row.h),
            before: before.text,
            after: row.text,
          });
        }
        if (row.text !== before.text && state.textChanges.length < 300) {
          state.textChanges.push({
            t: Math.round(now),
            key: key.slice(0, 14),
            before: before.text,
            after: row.text,
          });
        }
      });
      if (moved.length > 0) {
        const ds = moved.map((row) => row.d).sort((x, y) => x - y);
        const median = ds[Math.floor(ds.length / 2)] ?? 0;
        // Rows that moved apart: something on screen changed its size or was put between them.
        const spread = Math.max(...ds.map((d) => Math.abs(d - median)));
        // Rows that moved together while the reader gave no input for a while, other than by a
        // scroll the browser made (a wheel's smooth scroll that ends late): the app wrote no
        // offset and the rows moved by exactly as much as the list scrolled.
        const inputAge = now - state.lastInput;
        const quiet = inputAge > state.quietMs;
        const browserScroll = appDelta === 0 && Math.abs(median + dScroll) < 2;
        const quietMove = quiet && !browserScroll ? Math.abs(median) : 0;
        const px = Math.max(spread, quietMove);
        if (px >= 2) {
          state.moveFrames += 1;
          if (spread >= 2) state.layoutFrames += 1;
          if (quietMove >= 2) state.quietFrames += 1;
          state.maxMove = Math.max(state.maxMove, px);
          state.totalMove += px;
          if (state.moves.length < 400) {
            state.moves.push({
              t: Math.round(now),
              kind: spread >= 2 ? 'layout' : 'quiet',
              px: Math.round(px),
              median: Math.round(median),
              dScroll: Math.round(dScroll),
              appDelta: Math.round(appDelta),
              inputAge: Math.round(inputAge),
              dHeight: Math.round(scroller.scrollHeight - state.prevHeight),
              mounted: scroller.querySelectorAll(state.rowSelector).length,
              first: (
                scroller.querySelector(state.rowSelector)?.getAttribute(state.keyAttribute) ?? ''
              ).slice(0, 12),
              rows: moved
                .filter((row) => Math.abs(row.d - (quiet ? 0 : median)) >= 2)
                .slice(0, 4)
                .map((row) => `${row.key.slice(0, 12)}:${Math.round(row.d)}`),
            });
          }
        }
      }
      state.prev = current;
      state.prevTop = top;
      state.prevHeight = scroller.scrollHeight;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

export type ScrollRecording = {
  frames: number[];
  commits: number;
  longTasks: number[];
  loaf: { duration: number; blocking: number; scripts: string[] }[];
  layoutShifts: { value: number; sources: string[] }[];
  writes: { kind: string; value: number; from: number; t: number; stack: string }[];
  moveFrames: number;
  layoutFrames: number;
  quietFrames: number;
  moves: {
    t: number;
    kind: string;
    px: number;
    median: number;
    dScroll: number;
    appDelta: number;
    inputAge: number;
    dHeight?: number;
    mounted?: number;
    first?: string;
    rows: string[];
  }[];
  heightChanges: {
    t: number;
    key: string;
    from: number;
    to: number;
    before: string;
    after: string;
  }[];
  textChanges: { t: number; key: string; before: string; after: string }[];
  maxMove: number;
  totalMove: number;
  scrolled: number;
};

export const startRecording = (page: Page, view: RoomView, touchInput: boolean) =>
  page.evaluate(
    ({ compact, touchInput }) => {
      const state = (
        window as unknown as { __jitter: Record<string, unknown> & { prev: Map<string, unknown> } }
      ).__jitter;
      let scroller: HTMLElement | null = null;
      if (compact) {
        scroller = document.querySelector<HTMLElement>('[data-compact-room-view="true"]');
      } else {
        let element = document.querySelector('[data-message-item]')?.parentElement ?? null;
        while (element) {
          const { overflowY } = getComputedStyle(element);
          if (
            (overflowY === 'auto' || overflowY === 'scroll') &&
            element.scrollHeight > element.clientHeight
          ) {
            scroller = element;
            break;
          }
          element = element.parentElement;
        }
      }
      if (!scroller) throw new Error('no scroller');
      Object.assign(state, {
        scroller,
        rowSelector: compact ? '[data-scroll-anchor]' : '[data-message-item]',
        keyAttribute: compact ? 'data-scroll-anchor' : 'data-message-id',
        frames: [],
        commits: 0,
        longTasks: [],
        loaf: [],
        layoutShifts: [],
        writes: [],
        moveFrames: 0,
        layoutFrames: 0,
        quietFrames: 0,
        moves: [],
        writeDelta: 0,
        quietMs: touchInput ? 1500 : 400,
        heightChanges: [],
        textChanges: [],
        maxMove: 0,
        totalMove: 0,
        scrolled: 0,
        prev: new Map(),
        prevTop: scroller.scrollTop,
        prevHeight: scroller.scrollHeight,
        last: 0,
        recording: true,
      });
      const box = scroller.getBoundingClientRect();
      const max = scroller.scrollHeight - scroller.clientHeight;
      return {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        // Newest-first lists open at their top and scroll down into history; Classic opens at its end.
        direction: scroller.scrollTop < max / 2 ? 1 : -1,
        scrollHeight: scroller.scrollHeight,
      };
    },
    { compact: view === 'compact', touchInput }
  );

export const stopRecording = (page: Page): Promise<ScrollRecording> =>
  page.evaluate(() => {
    const state = (
      window as unknown as {
        __jitter: ScrollRecording & {
          recording: boolean;
          scroller: HTMLElement | null;
          prev: unknown;
        };
      }
    ).__jitter;
    state.recording = false;
    const { scroller: _scroller, prev: _prev, ...rest } = state;
    return JSON.parse(JSON.stringify(rest)) as ScrollRecording;
  });

export type ScrollInput = 'wheel' | 'touch' | 'drag';

/**
 * Scrolls the list the way a reader does: `flicks` fast flicks through it, then `readingSteps`
 * steps at a reading pace with pauses, then `backFlicks` flicks back. `wheel` turns the mouse
 * wheel; `touch` sends Chromium touch flings; `drag` (WebKit on a phone, which has neither) moves
 * the list by a finger's speed each frame from inside the page.
 */
export const scrollRoom = async (
  page: Page,
  cdp: CDPSession | undefined,
  input: ScrollInput,
  at: { x: number; y: number; direction: number },
  { flicks = 8, readingSteps = 16, backFlicks = 4 } = {}
) => {
  if (input !== 'drag') await page.mouse.move(at.x, at.y);
  const flick = async (direction: number, distance: number, slow: boolean) => {
    if (input === 'touch' && cdp) {
      await cdp.send('Input.synthesizeScrollGesture', {
        x: Math.round(at.x),
        y: Math.round(at.y),
        yDistance: -direction * distance,
        speed: slow ? 600 : 2400,
        gestureSourceType: 'touch',
        preventFling: slow,
      });
      return;
    }
    if (input === 'drag') {
      await page.evaluate(
        ({ by, pxPerMs }) =>
          new Promise<void>((resolve) => {
            const state = (
              window as unknown as {
                __jitter: { scroller: HTMLElement; driving: boolean; lastInput: number };
              }
            ).__jitter;
            let left = Math.abs(by);
            let last = performance.now();
            const step = (now: number) => {
              const move = Math.min(left, Math.max(1, (now - last) * pxPerMs));
              last = now;
              left -= move;
              state.driving = true;
              state.scroller.scrollTop += Math.sign(by) * move;
              state.driving = false;
              state.lastInput = now;
              if (left > 0) requestAnimationFrame(step);
              else resolve();
            };
            requestAnimationFrame(step);
          }),
        { by: direction * distance, pxPerMs: slow ? 0.6 : 2.4 }
      );
      return;
    }
    const notches = Math.max(1, Math.round(distance / 100));
    for (let notch = 0; notch < notches; notch += 1) {
      await page.mouse.wheel(0, direction * 100);
      await page.waitForTimeout(slow ? 40 : 16);
    }
  };
  // Fast: skimming through the list.
  for (let burst = 0; burst < flicks; burst += 1) {
    await flick(at.direction, 1200, false);
    await page.waitForTimeout(250);
  }
  // Reading: a little at a time, long enough on screen for each card to load its thread.
  for (let step = 0; step < readingSteps; step += 1) {
    await flick(at.direction, 300, true);
    await page.waitForTimeout(800);
  }
  // Back the other way.
  for (let burst = 0; burst < backFlicks; burst += 1) {
    await flick(-at.direction, 1200, false);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1_000);
};
