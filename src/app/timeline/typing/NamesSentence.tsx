import { Trans } from 'react-i18next';

// Each name reads in its own direction, whatever the sentence's.
const NAME = <b dir="auto" />;
const NAMES = { name: NAME, first: NAME, second: NAME, third: NAME, others: NAME };

type NamesSentenceKeyTuple<Prefix extends 'featureUi.room.typing' | 'featureUi.room.following'> =
  readonly [
    `${Prefix}.one`,
    `${Prefix}.two`,
    `${Prefix}.three`,
    `${Prefix}.four`,
    `${Prefix}.many`
  ];

type NamesSentenceKeys =
  | NamesSentenceKeyTuple<'featureUi.room.typing'>
  | NamesSentenceKeyTuple<'featureUi.room.following'>;

/**
 * A sentence that names up to three people in bold and counts the rest ("Avery, Blake and 2
 * others are typing"). One name fills `name`; more fill `first`, `second`, `third` and `count`.
 */
export function NamesSentence({
  keys,
  names,
}: {
  /** The sentences for one, two, three and four names, then the one for five or more. */
  keys: NamesSentenceKeys;
  names: string[];
}) {
  const [first, second, third] = names;
  const [one, two, three, four, many] = keys;
  if (names.length === 1) {
    return <Trans i18nKey={one} values={{ name: first }} components={NAMES} />;
  }
  const rest = [two, three, four, many] as const;
  const key = rest[Math.min(names.length, keys.length) - 2];
  return (
    <Trans
      i18nKey={key}
      values={{ first, second, third, count: Math.max(0, names.length - 3) }}
      components={NAMES}
    />
  );
}
