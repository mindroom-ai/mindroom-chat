import { describe, expect, it } from 'vitest';
import type { PushRuleAction } from 'matrix-js-sdk';
import { isHighlightNotification } from './inboxNotification';

const withActions = (actions: unknown[]) => ({ actions: actions as PushRuleAction[] });

describe('isHighlightNotification', () => {
  it('is a highlight when the highlight tweak is set without a value or to true', () => {
    expect(isHighlightNotification(withActions(['notify', { set_tweak: 'highlight' }]))).toBe(true);
    expect(
      isHighlightNotification(withActions(['notify', { set_tweak: 'highlight', value: true }]))
    ).toBe(true);
  });

  it('is no highlight without the tweak or with it set to false', () => {
    expect(isHighlightNotification(withActions(['notify']))).toBe(false);
    expect(
      isHighlightNotification(
        withActions(['notify', { set_tweak: 'sound', value: 'default' }, 'dont_notify'])
      )
    ).toBe(false);
    expect(
      isHighlightNotification(withActions(['notify', { set_tweak: 'highlight', value: false }]))
    ).toBe(false);
  });
});
