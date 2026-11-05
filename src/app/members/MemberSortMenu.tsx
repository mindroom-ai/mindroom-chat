import { useTranslation } from 'react-i18next';
import type { MemberSortItem } from './useMemberSort';
import { ChoiceMenu } from '../ui/ChoiceMenu';

/** The menu that picks the order of a member list (A to Z, newest, ...). */
export function MemberSortMenu(props: {
  items: MemberSortItem[];
  /** Position of the current order in `items`. */
  selected: number;
  onSelect(index: number): void;
  onDismiss(): void;
}) {
  const { t } = useTranslation();
  return (
    <ChoiceMenu
      label={t('sharedUi.memberSort.label')}
      choices={props.items.map(({ name }) => ({ name }))}
      current={props.selected}
      onChoose={props.onSelect}
      onDismiss={props.onDismiss}
    />
  );
}
