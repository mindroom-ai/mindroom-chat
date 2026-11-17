import type { TFunction } from 'i18next';
import type { CompactThreadCardViewModel } from '../event-store/threads/types';
import {
  formatCompactThreadMessageCount,
  getCompactThreadAttentionState,
  getCompactThreadAttentionStatusText,
  getCompactThreadMessageCountLabel,
} from '../threads/overview/compactThreadCardViewModel';

/** The threads of the tour's sample room. */
export type SampleThreadId = 'launch' | 'budget' | 'website' | 'vendor' | 'survey';

/** The people of the sample room: the person taking the tour, a colleague and two agents. */
export type SampleSender = 'you' | 'ana' | 'writer' | 'analyst';

/** A text of the sample room: `tour.sample.<key>` in the catalogs. */
export type SampleTextKey =
  | 'typed'
  | `${SampleThreadId}Title`
  | `${SampleThreadId}Reply`
  | 'vendorNewReply';

/** What a sample thread's card shows besides its thread; every part is off unless set. */
export type SampleCardState = {
  /** `typed`: the first message as the title, before an agent wrote the `summary`. */
  title?: 'typed' | 'summary';
  streaming?: boolean;
  unread?: boolean;
  resolved?: boolean;
  snoozed?: boolean;
  /** Shows the thread's tag. */
  tags?: boolean;
  /** A reply just came in: its text, one more reply, and the time of now. */
  replied?: boolean;
  /** Nobody answered the first message yet. */
  noReplies?: boolean;
};

/** A message in the sample room; `text` is its key under `tour.sample`. */
export type SampleMessage = { sender: SampleSender; text: SampleTextKey; streaming?: boolean };

/** The sample room's ID, which its avatar's color follows. */
export const SAMPLE_ROOM_ID = '!room:sample.mindroom';

/** A sample person's user ID, which their avatar's color follows. */
export const sampleUserId = (sender: SampleSender): string => `@${sender}:sample.mindroom`;

/** A sample person's name; the person taking the tour is "You", as in the app's previews. */
export const sampleName = (sender: SampleSender, t: TFunction): string =>
  sender === 'you' ? t('threadPreview.you') : t(`tour.sample.${sender}`);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type SampleThread = {
  /** Who wrote the first message. */
  starter: SampleSender;
  /** Who wrote the last reply. */
  replier: SampleSender;
  replies: number;
  /** How long ago the last reply came. */
  age: number;
  tag?: 'tagLaunch' | 'tagFinance';
};

// Ordered by age, as the list sorts them: the newest first.
const THREADS: Record<SampleThreadId, SampleThread> = {
  launch: { starter: 'you', replier: 'writer', replies: 1, age: MINUTE, tag: 'tagLaunch' },
  budget: { starter: 'ana', replier: 'analyst', replies: 4, age: 14 * MINUTE, tag: 'tagFinance' },
  vendor: { starter: 'you', replier: 'ana', replies: 3, age: 2 * HOUR, tag: 'tagFinance' },
  website: { starter: 'ana', replier: 'writer', replies: 6, age: 5 * HOUR, tag: 'tagLaunch' },
  survey: { starter: 'ana', replier: 'analyst', replies: 2, age: 26 * HOUR },
};

/** How long a snoozed sample thread stays hidden. */
const SNOOZE_LENGTH = 3 * HOUR;

/** How many replies a sample thread has in a state. */
export const sampleReplyCount = (id: SampleThreadId, state: SampleCardState): number => {
  if (state.noReplies) return 0;
  return THREADS[id].replies + (state.replied ? 1 : 0);
};

/**
 * A sample thread's first message, as the Threads view shows it. The new thread's is the message
 * typed in the tour; the others show their title.
 */
export const sampleRootMessage = (id: SampleThreadId): SampleMessage => ({
  sender: THREADS[id].starter,
  text: id === 'launch' ? 'typed' : `${id}Title`,
});

/** When a sample thread last had a message, counted back from `now`. */
export const sampleActivityTs = (id: SampleThreadId, state: SampleCardState, now: number): number =>
  state.replied || state.noReplies || state.streaming ? now : now - THREADS[id].age;

/** The key of a thread's last reply in a state. */
const replyKey = (id: SampleThreadId, state: SampleCardState): SampleTextKey =>
  id === 'vendor' && state.replied ? 'vendorNewReply' : `${id}Reply`;

/**
 * The view model of a sample thread's card, as the Compact view would build it from a real
 * thread: the texts come from `t`, the times count back from `now`, and the count takes the
 * digits of `locale`.
 */
export const sampleCard = (
  id: SampleThreadId,
  state: SampleCardState,
  t: TFunction,
  now: number,
  locale?: string
): CompactThreadCardViewModel => {
  const thread = THREADS[id];
  const typedTitle = id === 'launch' && state.title === 'typed';
  const titleText = typedTitle ? t('tour.sample.typed') : t(`tour.sample.${id}Title`);
  const messageCount = sampleReplyCount(id, state);
  const answered = messageCount > 0;
  const lastSender = answered ? thread.replier : thread.starter;
  const isResolved = state.resolved === true;
  const isStreaming = state.streaming === true;
  const snoozedUntilTs = state.snoozed && !isResolved ? now + SNOOZE_LENGTH : undefined;
  const attentionState = getCompactThreadAttentionState({
    isResolved,
    isStreaming,
    now,
    scheduledTaskCount: 0,
    snoozedUntilTs,
    lastSenderId: sampleUserId(lastSender),
    currentUserId: sampleUserId('you'),
  });
  const lastActivityTs = sampleActivityTs(id, state, now);
  const participants = answered ? [thread.starter, thread.replier] : [thread.starter];

  return {
    id: { roomId: SAMPLE_ROOM_ID, threadRootId: `$tour-${id}` },
    titleText,
    displayTitleText: titleText,
    previewText: answered
      ? t('tour.sample.preview', {
          name: sampleName(lastSender, t),
          text: t(`tour.sample.${replyKey(id, state)}`),
        })
      : t('mindroomUi.threads.compactThreadCardViewModel.noRepliesYet'),
    primarySummaryText: typedTitle ? undefined : titleText,
    messageCount,
    messageCountLabel: getCompactThreadMessageCountLabel(messageCount, t, locale),
    messageCountText: formatCompactThreadMessageCount(messageCount, locale),
    attentionState,
    attentionStatusText: getCompactThreadAttentionStatusText(attentionState, t),
    participants: participants.map((sender) => ({
      userId: sampleUserId(sender),
      displayName: sampleName(sender, t),
    })),
    tags: state.tags && thread.tag ? [t(`tour.sample.${thread.tag}`)] : [],
    isResolved,
    isUnread: state.unread === true,
    isStreaming,
    // A resolved thread shows as resolved only, as in the app.
    snoozedUntilTs,
    lastActivityTs,
    lastActivityTitle: new Date(lastActivityTs).toLocaleString(locale),
  };
};

/**
 * A text cut into what a person sees as its characters, so the composer types an accented letter
 * or an emoji in one piece. Where the browser cannot tell, it falls back to code points.
 */
export const sampleGraphemes = (text: string): string[] => {
  if (typeof Intl.Segmenter !== 'function') return Array.from(text);
  return Array.from(new Intl.Segmenter().segment(text), (part) => part.segment);
};
