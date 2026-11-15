import type { TourLevel } from '../navigation/tourState';

/** Names a step of the tour; its title and text are `tour.steps.<id>` in the catalogs. */
export type TourStepId =
  | 'conversation'
  | 'start'
  | 'reply'
  | 'title'
  | 'order'
  | 'states'
  | 'resolve'
  | 'snooze'
  | 'pinAndTag'
  | 'filters'
  | 'views'
  | 'activity';

/** The chapter a step belongs to; its name is `tour.chapters.<chapter>`. */
export type TourChapter = 'basics' | 'tidy' | 'finding';

/** One step: what it is about, its chapter, and how its scene on the stage is timed. */
export type TourStep = {
  id: TourStepId;
  chapter: TourChapter;
  /** How many ms each phase of the scene lasts; the last phase stays. */
  phases: readonly number[];
};

/** The tour's steps in the order they are shown. */
export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'conversation', chapter: 'basics', phases: [0] },
  // The empty composer, the message being typed, the whole message, the new thread, the answer.
  { id: 'start', chapter: 'basics', phases: [350, 1200, 450, 1000, 0] },
  // The reply box, Back, the list with the new card.
  { id: 'reply', chapter: 'basics', phases: [1700, 1400, 0] },
  // The typed message as the title, then the title an agent wrote.
  { id: 'title', chapter: 'basics', phases: [1300, 0] },
  // The list, the reply arriving, the card on top.
  { id: 'order', chapter: 'basics', phases: [900, 800, 0] },
  { id: 'states', chapter: 'basics', phases: [0] },
  // The card's buttons, the resolved mark, the list without the card.
  { id: 'resolve', chapter: 'tidy', phases: [1300, 1000, 0] },
  // The card's buttons, then its menu.
  { id: 'snooze', chapter: 'tidy', phases: [700, 0] },
  // The tagged cards, then one of them pinned.
  { id: 'pinAndTag', chapter: 'tidy', phases: [1000, 0] },
  // The button, then the bar it shows.
  { id: 'filters', chapter: 'finding', phases: [1200, 0] },
  // The switch, then the other view.
  { id: 'views', chapter: 'finding', phases: [1200, 0] },
  // The bell, then its list.
  { id: 'activity', chapter: 'finding', phases: [900, 0] },
];

/** How many steps the Quick tour has: the first chapter. */
export const QUICK_STEP_COUNT = 6;

/** The steps of a level: the Quick tour is the Full tour's first chapter. */
export const stepsOf = (level: TourLevel): readonly TourStep[] =>
  level === 'quick' ? TOUR_STEPS.slice(0, QUICK_STEP_COUNT) : TOUR_STEPS;

/** The step at `index` of a level; an index past either end gives the nearest step. */
export const stepAt = (level: TourLevel, index: number): TourStep => {
  const steps = stepsOf(level);
  const step = steps[Math.max(0, Math.min(index, steps.length - 1))];
  if (!step) throw new Error('The tour has no steps');
  return step;
};

/** How many ms pass before a step's scene starts, so the eye is on the stage. */
export const SCENE_START_DELAY_MS = 450;

/** The index of the step after `index` in a level; the last step stays where it is. */
export const nextStep = (level: TourLevel, index: number): number =>
  Math.min(index + 1, stepsOf(level).length - 1);

/** The index of the step before `index`; the first step stays where it is. */
export const previousStep = (index: number): number => Math.max(index - 1, 0);
