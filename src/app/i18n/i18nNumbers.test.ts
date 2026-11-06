import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The app's i18n runtime writes the numbers a translation puts into its text in the language's
// own digits, as Intl does for the times on the same screen (Bengali ০ to ৯).
describe('numbers in translations', () => {
  let runtime: typeof import('./i18n').default;

  beforeAll(async () => {
    runtime = (await import('./i18n')).default;
    runtime.addResourceBundle(
      'bn',
      'translation',
      {
        featureUi: {
          room: {
            membersDrawer: {
              memberCount_one: '{{count}} সদস্য',
              memberCount_other: '{{count}} সদস্য',
            },
          },
        },
        sharedUi: {
          threadPreviews: {
            tools_one: '{{count, number}} টুল',
            tools_other: '{{count, number}} টুল',
          },
        },
      },
      true,
      true
    );
  });

  afterAll(() => runtime.removeResourceBundle('bn', 'translation'));

  it("write a count in the language's digits", () => {
    const bn = runtime.getFixedT('bn');
    expect(bn('featureUi.room.membersDrawer.memberCount', { count: 4 })).toBe('৪ সদস্য');
    expect(bn('sharedUi.threadPreviews.tools', { count: 1234 })).toBe('১,২৩৪ টুল');
  });

  it('group thousands only where the translation asks for a number format', () => {
    const en = runtime.getFixedT('en');
    expect(en('featureUi.room.membersDrawer.memberCount', { count: 1234 })).toBe('1234 Members');
    expect(en('sharedUi.threadPreviews.tools', { count: 1234 })).toBe('1,234 tools');
  });

  it('leave text values alone', () => {
    const bn = runtime.getFixedT('bn');
    expect(bn('sharedUi.time.yesterdayValue1', { value1: '02:40' })).toBe('Yesterday 02:40');
  });
});
