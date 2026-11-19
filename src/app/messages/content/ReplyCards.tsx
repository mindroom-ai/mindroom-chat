import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Text, type IconSrc } from 'folds';
import { ChatUiActionContext } from '../../ui-actions/ChatUiActionProvider';
import { useClientConfig } from '../../config/useClientConfig';
import { parseScheduleTimestamp } from '../../matrix/protocol/scheduledTaskContract';
import type { ReplyCard } from '../replyCards';
import * as css from './ReplyCards.css';

type Drawn = { key: string; icon: IconSrc; title?: string; detail: string; open?: () => void };

/**
 * What an agent's reply left behind, as cards under it (replyCards.ts): a canvas, which opens on
 * click or says why it cannot now (no card with canvases turned off), and a reminder it scheduled.
 */
export function ReplyCards({ cards }: { cards: readonly ReplyCard[] }) {
  const { t, i18n } = useTranslation();
  const actions = useContext(ChatUiActionContext);
  const canvasEnabled = useClientConfig().mindroom?.canvas?.enabled === true;
  const formatter = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const drawn = cards.flatMap((card): Drawn[] => {
    if ('reminder' in card) {
      const { reminder } = card;
      const time = parseScheduleTimestamp(reminder.executeAt);
      const when =
        reminder.cronDescription ??
        (time === undefined ? t('roomSchedules.unknownTime') : formatter.format(time));
      const detail = t('mindroomUi.uiActions.reminderCard', { when });
      return [{ key: reminder.taskId, icon: Icons.Clock, title: reminder.description, detail }];
    }
    const action = canvasEnabled ? actions?.read(card.canvas) : undefined;
    if (!actions || action?.action !== 'show_canvas') return [];
    const detail = actions.unavailable(action) ?? t('mindroomUi.uiActions.canvasCard');
    const { title } = action.canvas;
    const open = () => actions.activate(card.canvas);
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
