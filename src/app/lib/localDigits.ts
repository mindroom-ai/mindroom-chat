// Intl writes numbers in a language's own digits: Bengali with ০ to ৯, the app's other languages
// with 0 to 9. Numbers the app puts into text itself (an unread count, a translation's
// `{{count}}`, a date dayjs formats) take the same digits, so one screen never mixes the two.

const digitSets = new Map<string, readonly string[] | null>();
const numberFormats = new Map<string, Intl.NumberFormat>();

/** The digits 0 to 9 as `language` writes them; null for 0 to 9 themselves. */
const digitsOf = (language: string | undefined): readonly string[] | null => {
  const key = language ?? '';
  const known = digitSets.get(key);
  if (known !== undefined) return known;
  let digits: readonly string[] | null = null;
  try {
    const format = new Intl.NumberFormat(language, { useGrouping: false });
    const own = Array.from({ length: 10 }, (_, digit) => format.format(digit));
    if (own.join('') !== '0123456789') digits = own;
  } catch {
    // Not a language tag Intl knows (i18next's `cimode`): the text stays as it is.
  }
  digitSets.set(key, digits);
  return digits;
};

/** `text` with its digits 0 to 9 written in `language`'s own digits. */
export const localDigits = (text: string, language?: string): string => {
  const digits = digitsOf(language);
  return digits ? text.replace(/[0-9]/g, (digit) => digits[Number(digit)] ?? digit) : text;
};

/** A number as `language` writes it, thousands grouped: "1,234" in English, "১,২৩৪" in Bengali. */
export const formatNumber = (value: number, language?: string): string => {
  const key = language ?? '';
  let format = numberFormats.get(key);
  if (!format) {
    try {
      format = new Intl.NumberFormat(language);
    } catch {
      format = new Intl.NumberFormat();
    }
    numberFormats.set(key, format);
  }
  return format.format(value);
};
