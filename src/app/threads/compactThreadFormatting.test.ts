import { describe, expect, it } from 'vitest';
import {
  formatCompactThreadMessageCount,
  getCompactThreadMessageCountLabel,
} from './overview/compactThreadCardViewModel';

describe('compact thread count formatting under streaming refreshes', () => {
  it('reuses the current locale formatter across changing counts and follows language changes', () => {
    // Counts the formatters made. A spy on Intl.NumberFormat would not do: Vitest 4 builds the
    // object under the spy's prototype, which has no `format`.
    const NumberFormat = Intl.NumberFormat;
    let made = 0;
    Intl.NumberFormat = class extends NumberFormat {
      constructor(...args: ConstructorParameters<typeof NumberFormat>) {
        super(...args);
        made += 1;
      }
    } as typeof NumberFormat;
    try {
      expect(getCompactThreadMessageCountLabel(1234, undefined, 'en-US')).toBe('1,234 msgs');
      expect(getCompactThreadMessageCountLabel(5678, undefined, 'en-US')).toBe('5,678 msgs');
      expect(made).toBe(1);
      expect(getCompactThreadMessageCountLabel(1234, undefined, 'de-DE')).toBe('1.234 msgs');
      expect(getCompactThreadMessageCountLabel(5678, undefined, 'de-DE')).toBe('5.678 msgs');
      expect(made).toBe(2);
      expect(getCompactThreadMessageCountLabel(1, undefined, 'en-US')).toBe('1 msg');
      expect(getCompactThreadMessageCountLabel(0, undefined, 'en-US')).toBe('0 replies');
      expect(formatCompactThreadMessageCount(1234, 'en-US')).toBe('1,234');
      expect(formatCompactThreadMessageCount(0, 'en-US')).toBe('0');
    } finally {
      Intl.NumberFormat = NumberFormat;
    }
  });
});
