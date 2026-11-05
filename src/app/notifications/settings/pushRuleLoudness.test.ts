import { describe, expect, it } from 'vitest';
import { type IPushRule, PushRuleActionName, TweakName } from 'matrix-js-sdk';
import { actionsFor, loudnessOf } from './pushRuleLoudness';

const SOUND = { set_tweak: TweakName.Sound, value: 'default' } as const;
const HIGHLIGHT = { set_tweak: TweakName.Highlight } as const;

const rule = (actions: IPushRule['actions'], enabled = true): IPushRule => ({
  rule_id: '.m.rule.contains_display_name',
  default: true,
  enabled,
  actions,
});

describe('loudnessOf', () => {
  it('reads a rule that notifies with a sound as loud, with or without highlight', () => {
    expect(loudnessOf(rule([PushRuleActionName.Notify, SOUND]))).toBe('loud');
    expect(loudnessOf(rule([PushRuleActionName.Notify, SOUND, HIGHLIGHT]))).toBe('loud');
  });

  it('reads a rule that notifies without a sound as silent', () => {
    expect(loudnessOf(rule([PushRuleActionName.Notify]))).toBe('silent');
    expect(loudnessOf(rule([PushRuleActionName.Notify, HIGHLIGHT]))).toBe('silent');
  });

  it('reads a rule without notify, or a disabled rule, as off', () => {
    expect(loudnessOf(rule([]))).toBe('off');
    expect(loudnessOf(rule([PushRuleActionName.DontNotify]))).toBe('off');
    expect(loudnessOf(rule([PushRuleActionName.Notify, SOUND], false))).toBe('off');
  });
});

describe('actionsFor', () => {
  it('writes no actions for off, so the rule stops notifying', () => {
    expect(actionsFor('off', false)).toEqual([]);
    expect(actionsFor('off', true)).toEqual([]);
  });

  it('writes notify, then the sound for loud, then the highlight for mentions', () => {
    expect(actionsFor('silent', false)).toEqual([PushRuleActionName.Notify]);
    expect(actionsFor('silent', true)).toEqual([PushRuleActionName.Notify, HIGHLIGHT]);
    expect(actionsFor('loud', false)).toEqual([PushRuleActionName.Notify, SOUND]);
    expect(actionsFor('loud', true)).toEqual([PushRuleActionName.Notify, SOUND, HIGHLIGHT]);
  });

  it('reads back as the loudness it was written for', () => {
    (['off', 'silent', 'loud'] as const).forEach((loudness) => {
      [false, true].forEach((highlight) => {
        expect(loudnessOf(rule(actionsFor(loudness, highlight)))).toBe(loudness);
      });
    });
  });
});
