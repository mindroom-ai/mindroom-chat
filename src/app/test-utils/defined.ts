/**
 * `value` when it is there; otherwise throws, naming `what`. Unit tests and e2e specs read list
 * entries and lookups through it where the test has made sure they exist, so a miss fails with a
 * message instead of a `TypeError` further down.
 */
export const defined = <T>(value: T | null | undefined, what: string): T => {
  if (value === undefined || value === null) throw new Error(`Expected ${what}, found none`);
  return value;
};
