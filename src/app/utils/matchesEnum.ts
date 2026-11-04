/**
 * Whether `value`, a string from the server such as an event type, a membership or an
 * authentication stage, is `member`, a value of one of the string enums that name them
 * (`EventType`, `KnownMembership`, `StateEvent`, `AuthType`, ...). The SDK types these values as
 * plain strings, and `@typescript-eslint/no-unsafe-enum-comparison` refuses `===` between a string
 * and an enum, so the check compares the two here, as strings.
 */
export const matchesEnum = (value: string | null | undefined, member: string): boolean =>
  value === member;
