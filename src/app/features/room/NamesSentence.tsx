import { Trans } from 'react-i18next';
import type { ParseKeys } from 'i18next';

const NAME = <b />;
const NAMES = { name: NAME, first: NAME, second: NAME, third: NAME, others: NAME };

/**
 * A sentence that names up to three people in bold and counts the rest ("Avery, Blake and 2
 * others are typing"). One name fills `name`; more fill `first`, `second`, `third` and `count`.
 */
export function NamesSentence<K extends ParseKeys>({
  keys,
  names,
}: {
  /** The sentences for one, two, three and four names, then the one for five or more. */
  keys: readonly [K, K, K, K, K];
  names: string[];
}) {
  const [first, second, third] = names;
  const key = keys[Math.min(names.length, keys.length) - 1];
  const values =
    names.length === 1
      ? { name: first }
      : { first, second, third, count: Math.max(0, names.length - 3) };
  return <Trans i18nKey={key} values={values} components={NAMES} />;
}
