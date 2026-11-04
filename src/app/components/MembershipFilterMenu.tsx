import { useTranslation } from 'react-i18next';
import { MembershipFilter, type MembershipFilterItem } from '../hooks/useMemberFilter';
import { ChoiceMenu } from './ChoiceMenu';

/** The menu that picks which members a list shows (joined, invited, banned, ...). */
export function MembershipFilterMenu(props: {
  items: MembershipFilterItem[];
  /** Position of the shown filter in `items`. */
  selected: number;
  onSelect(index: number): void;
  onDismiss(): void;
}) {
  const { t } = useTranslation();
  // Banned members read as a warning, as elsewhere in moderation.
  const choices = props.items.map(({ name, filterFn }) => ({
    name,
    critical: filterFn === MembershipFilter.filterBanned,
  }));
  return (
    <ChoiceMenu
      label={t('sharedUi.memberFilters.label')}
      choices={choices}
      current={props.selected}
      onChoose={props.onSelect}
      onDismiss={props.onDismiss}
    />
  );
}
