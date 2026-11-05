import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Text } from 'folds';
import type { TriState } from '../../event-store/threads/roomThreadOverviewModel';
import { tagColor } from '../tags/threadTagColor';
import { ThreadFilterDropdown, ThreadFilterPanel } from './ThreadFilterDropdown';
import * as css from './ThreadFilterDropdown.css';
import { buildThreadTagOptions, matchesThreadTagSearch } from './threadTagOptions';

export type ThreadTagFilterProps = {
  /** Every tag of the room's threads. */
  tags: readonly string[];
  /** How many of the room's threads carry each tag. */
  counts?: Readonly<Record<string, number>>;
  /** The tag filters: an included tag keeps the threads that carry it, an excluded one hides them. */
  selected: ReadonlyMap<string, TriState>;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  onClear: () => void;
};

/**
 * The filter bar's Tags dropdown: a search field over a checkbox for every tag of the room's
 * threads. A thread stays when it carries every checked tag; a tag excluded through the search
 * (`-tag:name`) shows checked and marked, and unchecking it drops that filter.
 */
export function ThreadTagFilter({
  tags,
  counts,
  selected,
  onAdd,
  onRemove,
  onClear,
}: ThreadTagFilterProps) {
  const { t } = useTranslation();
  const count = selected.size;
  const [only] = selected;
  const label = t('mindroomUi.threads.threadTagFilter.ariaLabel');

  return (
    <ThreadFilterDropdown
      name="tag"
      label={t('mindroomUi.threads.threadTagFilter.label')}
      value={count === 1 && only?.[1] === 'include' ? only[0] : undefined}
      count={count}
      ariaLabel={
        count > 0
          ? t('mindroomUi.threads.threadTagFilter.ariaLabelActive', { number: count })
          : label
      }
    >
      <ThreadFilterPanel
        name="tag"
        optionAttribute="data-tag-option"
        label={label}
        searchLabel={t('mindroomUi.threads.threadTagFilter.search')}
        noMatchLabel={t('mindroomUi.threads.threadTagFilter.noMatch')}
        options={(query) =>
          buildThreadTagOptions(tags, counts, selected)
            .filter((option) => matchesThreadTagSearch(option.tag, query))
            .map((option) => ({
              id: option.tag,
              checked: option.state !== 'any',
              excluded: option.state === 'exclude',
              count: option.count,
              content: (
                <>
                  <span
                    className={css.Swatch}
                    style={{ backgroundColor: tagColor(option.tag) }}
                    aria-hidden="true"
                  />
                  <Text as="span" size="T300" truncate className={css.Name}>
                    {option.tag}
                  </Text>
                  {option.state === 'exclude' && (
                    <Text
                      as="span"
                      size="L400"
                      className={classNames(css.Marker, css.MarkerExcluded)}
                    >
                      {t('mindroomUi.threads.threadTagFilter.excluded')}
                    </Text>
                  )}
                </>
              ),
            }))
        }
        onToggle={(tag) => (selected.has(tag) ? onRemove(tag) : onAdd(tag))}
        onClear={count > 0 ? onClear : undefined}
      />
    </ThreadFilterDropdown>
  );
}
