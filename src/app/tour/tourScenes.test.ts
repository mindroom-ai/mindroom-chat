import { describe, expect, it } from 'vitest';
import { sampleActivityTs } from './tourSample';
import { START_TYPING_PHASE, sceneOf, type TourScene } from './tourScenes';
import { TOUR_STEPS, type TourStepId } from './tourSteps';

const TYPED = 29;

/** The scene a step ends in. */
const lastScene = (id: TourStepId, phone = false): TourScene => {
  const step = TOUR_STEPS.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`no step ${id}`);
  return sceneOf(id, step.phases.length - 1, phone, TYPED);
};

const ids = (scene: TourScene) => scene.cards.map((card) => card.id);
const stateOf = (scene: TourScene, id: string) => scene.cards.find((card) => card.id === id)?.state;

describe('tourScenes', () => {
  it('shows four cards and marks the first for `conversation`', () => {
    [false, true].forEach((phone) => {
      const scene = lastScene('conversation', phone);
      expect(scene.view).toBe('list');
      expect(scene.header && scene.composer).toBe(true);
      expect(scene.cards).toHaveLength(4);
      expect(scene.spotlight).toBe(`card:${scene.cards[0]?.id}`);
      expect(ids(scene)).not.toContain('launch');
    });
  });

  it('types into the composer, then ends `start` in the open thread', () => {
    const empty = sceneOf('start', 0, false, TYPED);
    expect(empty).toMatchObject({ view: 'list', typed: 0, spotlight: 'composer' });
    expect(sceneOf('start', START_TYPING_PHASE, false, 7)).toMatchObject({
      view: 'list',
      typed: 7,
      spotlight: 'composer',
    });
    expect(sceneOf('start', START_TYPING_PHASE + 1, false, TYPED).typed).toBe(TYPED);

    [false, true].forEach((phone) => {
      const scene = lastScene('start', phone);
      expect(scene.view).toBe('thread');
      expect(scene.typed).toBe(0);
      expect(scene.spotlight).toBe('thread');
      expect(scene.thread?.messages.map((message) => message.sender)).toEqual(['you', 'writer']);
      expect(scene.thread?.messages[0]?.text).toBe('typed');
      expect(scene.thread?.messages[1]?.streaming).toBe(true);
    });
  });

  it('goes from the reply box over Back to the list with the new card on top for `reply`', () => {
    expect(sceneOf('reply', 0, false, TYPED)).toMatchObject({
      view: 'thread',
      spotlight: 'replyBox',
    });
    expect(sceneOf('reply', 1, false, TYPED)).toMatchObject({ view: 'thread', spotlight: 'back' });
    [false, true].forEach((phone) => {
      const scene = lastScene('reply', phone);
      expect(scene.view).toBe('list');
      expect(ids(scene)[0]).toBe('launch');
      expect(stateOf(scene, 'launch')?.title).toBe('typed');
      expect(scene.spotlight).toBe('card:launch');
    });
  });

  it("changes the new card's title from the message to a summary for `title`", () => {
    const before = sceneOf('title', 0, false, TYPED);
    expect(stateOf(before, 'launch')?.title).toBe('typed');
    expect(before.spotlight).toBe('title:launch');
    [false, true].forEach((phone) => {
      const scene = lastScene('title', phone);
      expect(scene.view).toBe('list');
      expect(stateOf(scene, 'launch')?.title).toBe('summary');
      expect(scene.spotlight).toBe('title:launch');
    });
  });

  it('moves the card that got a reply to the top for `order`', () => {
    const before = sceneOf('order', 0, false, TYPED);
    const replied = before.spotlight?.replace('card:', '');
    expect(replied).toBe('vendor');
    // A phone shows three cards under its header, so the card is among them before it moves.
    expect(ids(before).indexOf('vendor')).toBe(2);
    expect(stateOf(before, 'vendor')?.replied).toBeFalsy();

    const arrived = sceneOf('order', 1, false, TYPED);
    expect(ids(arrived)).toEqual(ids(before));
    expect(stateOf(arrived, 'vendor')).toMatchObject({ replied: true, unread: true });

    [false, true].forEach((phone) => {
      const scene = lastScene('order', phone);
      expect(ids(scene)[0]).toBe('vendor');
      expect([...ids(scene)].sort()).toEqual([...ids(before)].sort());
      expect(scene.spotlight).toBe('card:vendor');
    });
  });

  it('shows one card in each state and no spotlight for `states`, on a phone the cards alone', () => {
    [false, true].forEach((phone) => {
      const scene = lastScene('states', phone);
      expect(scene.view).toBe('list');
      expect(scene.header).toBe(!phone);
      expect(scene.composer).toBe(!phone);
      expect(scene.spotlight).toBeUndefined();
      expect(scene.cards.map((card) => Object.keys(card.state))).toEqual([
        ['streaming'],
        ['unread'],
        ['resolved'],
        ['snoozed'],
      ]);
      // In the order the step before taught: the latest activity first.
      const ages = scene.cards.map(({ id, state }) => -sampleActivityTs(id, state, 0));
      expect(ages).toEqual([...ages].sort((a, b) => a - b));
    });
  });

  it('shows the check, then the resolved mark, then drops the card for `resolve`', () => {
    const desktop = sceneOf('resolve', 0, false, TYPED);
    expect(desktop).toMatchObject({ actionsOn: 'vendor', spotlight: 'resolveButton' });
    // A phone has no check: the card is swiped, and the card is what is marked.
    expect(sceneOf('resolve', 0, true, TYPED)).toMatchObject({
      actionsOn: 'vendor',
      spotlight: 'card:vendor',
    });
    const marked = sceneOf('resolve', 1, false, TYPED);
    expect(stateOf(marked, 'vendor')?.resolved).toBe(true);
    expect(marked.spotlight).toBe('card:vendor');

    [false, true].forEach((phone) => {
      const scene = lastScene('resolve', phone);
      expect(scene.view).toBe('list');
      expect(ids(scene)).not.toContain('vendor');
      expect(ids(scene)).toHaveLength(ids(desktop).length - 1);
      expect(scene.actionsOn).toBeUndefined();
      expect(scene.spotlight).toBeUndefined();
    });
  });

  it("opens the card's menu on Snooze for `snooze`", () => {
    [false, true].forEach((phone) => {
      // First the button that opens the menu, on the card the menu will be of.
      const closed = sceneOf('snooze', 0, phone, TYPED);
      expect(closed.menuOn).toBeUndefined();
      expect(closed.spotlight).toBe(`options:${closed.cards[0]?.id}`);

      const scene = lastScene('snooze', phone);
      expect(scene.menuOn).toBe(scene.cards[0]?.id);
      expect(scene.spotlight).toBe('menuSnooze');
      // The card's buttons show under the pointer; a phone's card is not swiped for its menu.
      expect(scene.actionsOn).toBe(phone ? undefined : scene.menuOn);
    });
  });

  it('pins a card above the tagged rest for `pinAndTag`', () => {
    expect(sceneOf('pinAndTag', 0, false, TYPED).pinned).toEqual([]);
    [false, true].forEach((phone) => {
      const scene = lastScene('pinAndTag', phone);
      expect(scene.pinned).toHaveLength(1);
      const [pinned] = scene.pinned;
      expect(ids(scene)[0]).toBe(pinned);
      expect(scene.spotlight).toBe(`card:${pinned}`);
      expect(scene.cards.every((card) => card.state.tags)).toBe(true);
    });
  });

  it('marks the button, then the bar it shows, for `filters`', () => {
    expect(sceneOf('filters', 0, false, TYPED)).toMatchObject({
      filterBar: false,
      roomMenu: false,
      spotlight: 'filterButton',
    });
    // A phone keeps the button in the room menu.
    expect(sceneOf('filters', 0, true, TYPED)).toMatchObject({
      filterBar: false,
      roomMenu: true,
      spotlight: 'filterButton',
    });
    [false, true].forEach((phone) => {
      expect(lastScene('filters', phone)).toMatchObject({
        view: 'list',
        filterBar: true,
        roomMenu: false,
        spotlight: 'filterBar',
      });
    });
  });

  it('switches from cards to messages for `views`', () => {
    expect(sceneOf('views', 0, false, TYPED)).toMatchObject({
      view: 'list',
      roomMenu: false,
      spotlight: 'viewSwitch',
    });
    expect(sceneOf('views', 0, true, TYPED)).toMatchObject({
      view: 'list',
      roomMenu: true,
      spotlight: 'viewSwitch',
    });
    expect(lastScene('views')).toMatchObject({ view: 'messages', spotlight: 'viewSwitch' });
    // The switch is in a phone's room menu, which is closed again.
    const phone = lastScene('views', true);
    expect(phone).toMatchObject({ view: 'messages', roomMenu: false });
    expect(phone.spotlight).toBeUndefined();
  });

  it('opens the list of the bell for `activity`', () => {
    expect(sceneOf('activity', 0, false, TYPED)).toMatchObject({
      bell: true,
      activity: false,
      spotlight: 'bell',
    });
    [false, true].forEach((phone) => {
      expect(lastScene('activity', phone)).toMatchObject({
        bell: true,
        activity: true,
        spotlight: 'bell',
      });
    });
  });

  it('keeps the bell, the menus and the bar out of the steps that are not about them', () => {
    TOUR_STEPS.forEach((step) => {
      step.phases.forEach((_, phase) => {
        [false, true].forEach((phone) => {
          const scene = sceneOf(step.id, phase, phone, TYPED);
          expect(scene.bell, step.id).toBe(step.id === 'activity');
          if (step.id !== 'filters') expect(scene.filterBar, step.id).toBe(false);
          if (step.id !== 'snooze') expect(scene.menuOn, step.id).toBeUndefined();
          if (step.id !== 'start') expect(scene.typed, step.id).toBe(0);
          if (step.id !== 'states' || !phone)
            expect(scene.header && scene.composer, step.id).toBe(true);
          // A room menu is a phone's.
          if (!phone) expect(scene.roomMenu, step.id).toBe(false);
          expect(scene.view === 'thread', step.id).toBe(scene.thread !== undefined);
        });
      });
    });
  });

  it('has a scene for each phase a step is timed for, and none beyond', () => {
    TOUR_STEPS.forEach((step) => {
      [false, true].forEach((phone) => {
        const last = step.phases.length - 1;
        const at = (phase: number) => sceneOf(step.id, phase, phone, TYPED);
        // A scene short of the step's phases would repeat its last one; a scene too many would
        // never be reached, and shows here as a phase after the last.
        if (last > 0) expect(at(last), `${step.id}: a scene of its own`).not.toEqual(at(last - 1));
        expect(at(last + 1), `${step.id}: no scene beyond`).toEqual(at(last));
      });
    });
  });

  it('stays in the last phase for a phase past the end', () => {
    TOUR_STEPS.forEach((step) => {
      expect(sceneOf(step.id, 99, false, TYPED)).toEqual(lastScene(step.id));
    });
  });

  it('never pins a card that is resolved or snoozed', () => {
    TOUR_STEPS.forEach((step) => {
      step.phases.forEach((_, phase) => {
        const scene = sceneOf(step.id, phase, false, TYPED);
        scene.pinned.forEach((id) => {
          const state = stateOf(scene, id);
          expect(state, `${step.id} pins ${id}`).toBeDefined();
          expect(state?.resolved || state?.snoozed).toBeFalsy();
        });
      });
    });
  });
});
