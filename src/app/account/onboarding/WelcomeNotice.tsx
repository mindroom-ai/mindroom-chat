import { Icon, Text, type IconSrc } from 'folds';
import * as css from './WelcomeNotice.css';

type WelcomeNoticeProps = {
  icon: IconSrc;
  /** The link that acts on the notice. */
  action: string;
  onAction: () => void;
  /** One grey sentence after it on why. */
  text: string;
  /** Names the notice as a region of the page. */
  label?: string;
};

/**
 * A quiet row of Home under the recent threads: an icon, a link that acts, and one sentence, with
 * no fill and no close button. It goes once what it asks for is done.
 */
export function WelcomeNotice({ icon, action, onAction, text, label }: WelcomeNoticeProps) {
  return (
    <div className={css.Notice} role={label ? 'region' : undefined} aria-label={label}>
      <Icon size="100" src={icon} className={css.NoticeIcon} aria-hidden="true" />
      <p className={css.NoticeText}>
        <button type="button" className={css.NoticeAction} onClick={onAction}>
          <Text as="span" size="T300">
            {action}
          </Text>
        </button>{' '}
        <Text as="span" size="T300" priority="300">
          {text}
        </Text>
      </p>
    </div>
  );
}
