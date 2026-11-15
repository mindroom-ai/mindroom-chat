import { describe, expect, it } from 'vitest';
import { translateFromEn } from '../../test/utils/i18n';
import {
  QUICK_STEP_COUNT,
  SCENE_START_DELAY_MS,
  TOUR_STEPS,
  nextStep,
  previousStep,
  stepAt,
  stepsOf,
} from './tourSteps';

const STATE_LINES = ['streaming', 'unread', 'resolved', 'snoozed'];

describe('tourSteps', () => {
  it('lists the twelve steps in three chapters, in order', () => {
    expect(TOUR_STEPS.map((step) => step.id)).toEqual([
      'conversation',
      'start',
      'reply',
      'title',
      'order',
      'states',
      'resolve',
      'filters',
      'snooze',
      'pinAndTag',
      'views',
      'activity',
    ]);
    expect(TOUR_STEPS.map((step) => step.chapter)).toEqual([
      ...Array<string>(6).fill('basics'),
      ...Array<string>(4).fill('tidy'),
      ...Array<string>(2).fill('finding'),
    ]);
    expect(new Set(TOUR_STEPS.map((step) => step.id)).size).toBe(TOUR_STEPS.length);
  });

  it("makes the Quick tour the Full tour's first eight steps, ending with the filters", () => {
    expect(QUICK_STEP_COUNT).toBe(8);
    expect(stepsOf('full')).toEqual(TOUR_STEPS);
    expect(stepsOf('quick')).toEqual(TOUR_STEPS.slice(0, QUICK_STEP_COUNT));
    // A thread is resolved before the filters show where it went.
    expect(
      stepsOf('quick')
        .slice(-2)
        .map((step) => step.id)
    ).toEqual(['resolve', 'filters']);
  });

  it('has an English title and text for each step', () => {
    TOUR_STEPS.forEach((step) => {
      const title = `tour.steps.${step.id}.title`;
      expect(translateFromEn(title), title).not.toBe(title);
      const texts =
        step.id === 'states'
          ? STATE_LINES.map((line) => `tour.steps.states.${line}`)
          : [`tour.steps.${step.id}.text`];
      texts.forEach((key) => expect(translateFromEn(key), key).not.toBe(key));
      const chapter = `tour.chapters.${step.chapter}`;
      expect(translateFromEn(chapter), chapter).not.toBe(chapter);
    });
  });

  it('gives each step at least one phase, with no negative length', () => {
    TOUR_STEPS.forEach((step) => {
      expect(step.phases.length, step.id).toBeGreaterThan(0);
      step.phases.forEach((ms) => expect(ms, step.id).toBeGreaterThanOrEqual(0));
    });
    expect(SCENE_START_DELAY_MS).toBe(450);
  });

  it('stops the moves at both ends of a level', () => {
    expect(previousStep(0)).toBe(0);
    expect(previousStep(3)).toBe(2);
    expect(nextStep('quick', 0)).toBe(1);
    expect(nextStep('quick', QUICK_STEP_COUNT - 1)).toBe(QUICK_STEP_COUNT - 1);
    expect(nextStep('full', QUICK_STEP_COUNT - 1)).toBe(QUICK_STEP_COUNT);
    expect(nextStep('full', TOUR_STEPS.length - 1)).toBe(TOUR_STEPS.length - 1);
  });

  it('gives the nearest step for an index past either end', () => {
    expect(stepAt('quick', 2).id).toBe('reply');
    expect(stepAt('quick', 99).id).toBe('filters');
    expect(stepAt('full', 99).id).toBe('activity');
    expect(stepAt('full', -1).id).toBe('conversation');
  });

  it('says in Keep going how many steps the Full tour adds', () => {
    expect(translateFromEn('tour.dialog.keepGoing')).toContain(
      String(TOUR_STEPS.length - QUICK_STEP_COUNT)
    );
  });
});
