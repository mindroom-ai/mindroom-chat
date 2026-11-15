import type { SampleCardState, SampleMessage, SampleThreadId } from './tourSample';
import type { TourStepId } from './tourSteps';

/** A part of the stage a step can point at; the stage marks each with `data-tour-part`. */
export type TourPart =
  | 'composer'
  | 'thread'
  | 'replyBox'
  | 'back'
  | `card:${SampleThreadId}`
  | `title:${SampleThreadId}`
  | 'resolveButton'
  | 'menuSnooze'
  | 'filterButton'
  | 'filterBar'
  | 'viewSwitch'
  | 'bell';

/** A card of the stage's list: its thread and what the card shows of it. */
export type SceneCard = { id: SampleThreadId; state: SampleCardState };

/** What the stage shows at one moment of a step. */
export type TourScene = {
  /** The Compact list of cards, an open thread, or the Threads view's messages. */
  view: 'list' | 'thread' | 'messages';
  /** Whether the room's header and its composer show; a scene of cards alone has neither. */
  header: boolean;
  composer: boolean;
  /** How many characters of the sample message the composer holds. */
  typed: number;
  /** The cards of the Pinned section; each is also in `cards`. */
  pinned: readonly SampleThreadId[];
  /** The room's cards in the list's order, the pinned ones first. */
  cards: readonly SceneCard[];
  /** The card whose buttons show; on a phone, the card that is swiped aside. */
  actionsOn?: SampleThreadId;
  /** The card whose Thread options menu is open. */
  menuOn?: SampleThreadId;
  /** Whether a phone's room menu is open. */
  roomMenu: boolean;
  /** Whether the thread filters' bar shows under the header. */
  filterBar: boolean;
  /** Whether the Activity bell shows: on the rail, or in a phone's top bar. */
  bell: boolean;
  /** Whether the bell's list is open. */
  activity: boolean;
  /** The open thread's messages, while `view` is `thread`. */
  thread?: { messages: readonly SampleMessage[] };
  /** The part the step is about, which the spotlight rings; none for the whole list. */
  spotlight?: TourPart;
};

/** The phase of `start` in which the message is typed into the composer. */
export const START_TYPING_PHASE = 1;

const card = (id: SampleThreadId, state: SampleCardState = {}): SceneCard => ({ id, state });

/** The cards with one of them moved to the top. */
const toTop = (cards: readonly SceneCard[], top: SampleThreadId): readonly SceneCard[] => [
  ...cards.filter(({ id }) => id === top),
  ...cards.filter(({ id }) => id !== top),
];

/** The room as every step starts from it: the list, with nothing open. */
const room = (cards: readonly SceneCard[]): TourScene => ({
  view: 'list',
  header: true,
  composer: true,
  typed: 0,
  pinned: [],
  cards,
  roomMenu: false,
  filterBar: false,
  bell: false,
  activity: false,
});

/** The room before the tour's thread is started, newest first. */
const BEFORE: readonly SceneCard[] = [
  card('budget'),
  card('vendor'),
  card('website'),
  card('survey'),
];

/** The cards once the new thread heads the list; `launch` is what its card shows. */
const withLaunch = (launch: SampleCardState): readonly SceneCard[] => [
  card('launch', launch),
  card('budget'),
  card('vendor'),
  card('website'),
];

/** The list after the vendor thread got its reply and moved up. */
const AFTER_REPLY: readonly SceneCard[] = [
  card('vendor', { replied: true }),
  card('launch'),
  card('budget'),
  card('website'),
];

/** The list after the vendor thread was resolved, as the second and third chapter show it. */
const TIDY: readonly SceneCard[] = [card('launch'), card('budget'), card('website')];
const TAGGED: readonly SceneCard[] = TIDY.map(({ id }) => card(id, { tags: true }));

const QUESTION: SampleMessage = { sender: 'you', text: 'typed' };
const ANSWER: SampleMessage = { sender: 'writer', text: 'launchReply' };

/** The new thread, open, with the room's list behind it. */
const openThread = (messages: readonly SampleMessage[], launch: SampleCardState): TourScene => ({
  ...room(withLaunch(launch)),
  view: 'thread',
  thread: { messages },
});

const scenesOf = (step: TourStepId, phone: boolean, typedLength: number): TourScene[] => {
  switch (step) {
    case 'conversation':
      return [{ ...room(BEFORE), spotlight: 'card:budget' }];
    case 'start': {
      const composing = (typed: number): TourScene => ({
        ...room(BEFORE),
        typed,
        spotlight: 'composer',
      });
      const sent: SampleCardState = { title: 'typed', noReplies: true };
      return [
        composing(0),
        composing(typedLength),
        composing(typedLength),
        { ...openThread([QUESTION], sent), spotlight: 'thread' },
        {
          ...openThread([QUESTION, { ...ANSWER, streaming: true }], {
            title: 'typed',
            streaming: true,
          }),
          spotlight: 'thread',
        },
      ];
    }
    case 'reply': {
      const answered = openThread([QUESTION, ANSWER], { title: 'typed' });
      return [
        { ...answered, spotlight: 'replyBox' },
        { ...answered, spotlight: 'back' },
        { ...room(withLaunch({ title: 'typed' })), spotlight: 'card:launch' },
      ];
    }
    case 'title':
      return [
        { ...room(withLaunch({ title: 'typed' })), spotlight: 'title:launch' },
        { ...room(withLaunch({ title: 'summary' })), spotlight: 'title:launch' },
      ];
    case 'order': {
      const arrived = withLaunch({}).map(({ id, state }) =>
        id === 'vendor' ? card(id, { replied: true, unread: true }) : card(id, state)
      );
      return [
        { ...room(withLaunch({})), spotlight: 'card:vendor' },
        { ...room(arrived), spotlight: 'card:vendor' },
        { ...room(toTop(arrived, 'vendor')), spotlight: 'card:vendor' },
      ];
    }
    case 'states':
      return [
        {
          ...room([
            card('launch', { streaming: true }),
            card('budget', { unread: true }),
            card('website', { resolved: true }),
            card('vendor', { snoozed: true }),
          ]),
          header: false,
          composer: false,
        },
      ];
    case 'resolve': {
      const resolved = AFTER_REPLY.map(({ id, state }) =>
        id === 'vendor' ? card(id, { ...state, resolved: true }) : card(id, state)
      );
      return [
        {
          ...room(AFTER_REPLY),
          actionsOn: 'vendor',
          // A touch screen has no check on the card: the card is swiped.
          spotlight: phone ? 'card:vendor' : 'resolveButton',
        },
        { ...room(resolved), spotlight: 'card:vendor' },
        room(TIDY),
      ];
    }
    case 'snooze': {
      // A phone's cards always show their Thread options button; a wider screen's show it with
      // the card's other buttons while the pointer is on the card.
      const pointed: TourScene = { ...room(TIDY), actionsOn: phone ? undefined : 'launch' };
      return [pointed, { ...pointed, menuOn: 'launch', spotlight: 'menuSnooze' }];
    }
    case 'pinAndTag':
      return [
        { ...room(TAGGED), spotlight: 'card:budget' },
        { ...room(toTop(TAGGED, 'budget')), pinned: ['budget'], spotlight: 'card:budget' },
      ];
    case 'filters':
      return [
        // A phone keeps the button in its room menu.
        { ...room(TIDY), roomMenu: phone, spotlight: 'filterButton' },
        { ...room(TIDY), filterBar: true, spotlight: 'filterBar' },
      ];
    case 'views':
      return [
        { ...room(TIDY), roomMenu: phone, spotlight: 'viewSwitch' },
        // A phone's switch is in its room menu, which has closed again.
        { ...room(TIDY), view: 'messages', spotlight: phone ? undefined : 'viewSwitch' },
      ];
    case 'activity':
      return [
        { ...room(TIDY), bell: true, spotlight: 'bell' },
        { ...room(TIDY), bell: true, activity: true, spotlight: 'bell' },
      ];
  }
};

/**
 * What the stage shows in a phase of a step, on a phone or a wider screen. `typedLength` is how
 * much of the sample message is typed so far, which only the composer of `start` shows. A phase
 * past the step's last one shows the last.
 */
export const sceneOf = (
  step: TourStepId,
  phase: number,
  phone: boolean,
  typedLength: number
): TourScene => {
  const scenes = scenesOf(step, phone, typedLength);
  const scene = scenes[Math.max(0, Math.min(phase, scenes.length - 1))];
  if (!scene) throw new Error(`The tour's step ${step} has no scene`);
  return scene;
};
