import { type IPushRule, type PushRuleAction, PushRuleActionName, TweakName } from 'matrix-js-sdk';

/** How a rule notifies: not at all, without sound, or with the default sound. */
export type Loudness = 'off' | 'silent' | 'loud';

export const loudnessOf = (rule: IPushRule): Loudness => {
  if (!rule.enabled || !rule.actions.includes(PushRuleActionName.Notify)) return 'off';
  const sounds = rule.actions.some(
    (action) => typeof action === 'object' && action.set_tweak === TweakName.Sound
  );
  return sounds ? 'loud' : 'silent';
};

/** Push actions for a loudness (client-server API, "Push Rules: Actions"); mentions highlight. */
export const actionsFor = (loudness: Loudness, highlight: boolean): PushRuleAction[] => {
  if (loudness === 'off') return [];
  const actions: PushRuleAction[] = [PushRuleActionName.Notify];
  if (loudness === 'loud') actions.push({ set_tweak: TweakName.Sound, value: 'default' });
  if (highlight) actions.push({ set_tweak: TweakName.Highlight });
  return actions;
};
