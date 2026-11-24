import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Text, type IconSrc } from 'folds';
import { ChatUiActionContext } from '../../ui-actions/ChatUiActionProvider';
import type { ChatUiAction } from '../../matrix/protocol/chatUiProtocol';
import {
  parseScheduleTimestamp,
  type ParsedScheduledTask,
} from '../../matrix/protocol/scheduledTaskContract';
import * as css from './ReplyCards.css';

/** A canvas as the viewer may open it (`readChatUiAction`), or a task. */
export type ReplyCard =
  { canvas: Extract<ChatUiAction, { action: 'show_canvas' }> } | { reminder: ParsedScheduledTask };

const dateTime = (time: number, locale?: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(time);

type Drawn = { key: string; icon: IconSrc; title?: string; detail: string; open?: () => void };

/** Cards under an agent's reply (timeline/replyCards.ts): a canvas it shared, which opens on click
 * or says why not, and a reminder it scheduled. */
export function ReplyCards({ cards }: { cards: readonly ReplyCard[] }) {
  const { t, i18n } = useTranslation();
  const actions = useContext(ChatUiActionContext);
  const drawn = cards.flatMap((card): Drawn[] => {
    if ('reminder' in card) {
      const { reminder } = card;
      const time = parseScheduleTimestamp(reminder.executeAt);
      const when =
        reminder.cronDescription ??
        (time === undefined
          ? t('roomSchedules.unknownTime')
          : dateTime(time, i18n.resolvedLanguage));
      const detail = t('mindroomUi.uiActions.reminderCard', { when });
      return [{ key: reminder.taskId, icon: Icons.Clock, title: reminder.description, detail }];
    }
    const action = card.canvas;
    if (!actions) return [];
    const detail = actions.unavailable(action) ?? t('mindroomUi.uiActions.canvasCard');
    const { title } = action.canvas;
    const open = () => actions.activate(action.event);
    return [{ key: action.eventId, icon: Icons.Category, title, detail, open }];
  });
  if (drawn.length === 0) return null;
  return (
    <div className={css.Cards}>
      {drawn.map(({ key, icon, title, detail, open }) => {
        const Card = open ? 'button' : 'div';
        return (
          <Card key={key} className={css.Card} {...(open && { type: 'button', onClick: open })}>
            <Icon size="200" src={icon} />
            <span className={css.Text}>
              <Text size="T300" truncate dir="auto">
                {title}
              </Text>
              <Text size="T200" priority="300" dir="auto">
                {detail}
              </Text>
            </span>
          </Card>
        );
      })}
    </div>
  );
}
