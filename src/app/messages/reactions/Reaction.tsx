import { Trans, useTranslation } from 'react-i18next';
import classNames from 'classnames';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { Text, as } from 'folds';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { getMemberDisplayName } from '../../matrix/room';
import { useEmojiData } from '../../emoji/emojiData';
import { revealDirectionControls } from '../../ui/directional';
import * as css from './Reaction.css';

type ReactionProps = {
  mx: MatrixClient;
  /** Unicode emoji, or the mxc URI of a custom emoji. */
  reaction: string;
  count: number;
  /** Replaces the emoji with text, such as an agent's stop control. */
  label?: string;
  useAuthentication?: boolean;
};

/**
 * One reaction chip with its count; pressed when the user reacted with it. A key is any text its
 * sender chose, so it shows its direction controls as code points.
 */
export const Reaction = as<'button', ReactionProps>(
  ({ className, mx, reaction, count, label, useAuthentication, onClick, ...props }, ref) => {
    const imageSrc = reaction.startsWith('mxc://')
      ? mxcUrlToHttp(mx, reaction, useAuthentication) ?? undefined
      : undefined;
    return (
      <button
        type="button"
        className={classNames(css.Reaction, className)}
        disabled={!onClick}
        onClick={onClick}
        {...props}
        ref={ref}
      >
        {label ? (
          <Text as="span" size="L400" className={css.ReactionText}>
            {label}
          </Text>
        ) : imageSrc ? (
          <img className={css.ReactionImg} src={imageSrc} alt={revealDirectionControls(reaction)} />
        ) : (
          <Text as="span" size="Inherit" className={css.ReactionText}>
            {revealDirectionControls(reaction)}
          </Text>
        )}
        {/* A labelled chip is a control, not a tally. */}
        {!label && (
          <Text as="span" size="T300">
            {count}
          </Text>
        )}
      </button>
    );
  }
);

type ReactionTooltipMsgProps = {
  room: Room;
  /** The annotation key: a Unicode emoji or an mxc URI. */
  reaction: string;
  events: MatrixEvent[];
};

const MAX_NAMED_REACTORS = 5;

/** "Alice, Bob and 3 others reacted with :thumbsup:" for a reaction chip's tooltip. */
export function ReactionTooltipMsg({ room, reaction, events }: ReactionTooltipMsgProps) {
  const { t, i18n } = useTranslation();
  // A Unicode reaction shows itself until the emoji data, asked for here, gives its shortcode.
  const emojiData = useEmojiData();
  const names = events.map((event) => {
    const sender = event.getSender() ?? '';
    return getMemberDisplayName(room, sender) ?? sender;
  });
  const shown = names.slice(0, MAX_NAMED_REACTORS);
  const others = names.length - shown.length;
  const listed = others > 0 ? [...shown, t('sharedUi.reaction.others', { count: others })] : shown;
  const customShortcode = events
    .map((event) => event.getContent().shortcode)
    .find((value): value is string => typeof value === 'string');
  const shortcode = reaction.startsWith('mxc://')
    ? customShortcode ?? reaction
    : emojiData?.getEmojiByUnicode(reaction)?.shortcode ?? customShortcode ?? reaction;

  return (
    <Trans
      i18nKey="sharedUi.reaction.reactionSummary"
      values={{
        names: new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(listed),
        reaction: revealDirectionControls(shortcode),
      }}
      components={{ names: <b />, reaction: <span /> }}
      // Escaped, a key's `<U+202E>` and a name's `<` stay text instead of reading as tags.
      tOptions={{ interpolation: { escapeValue: true } }}
      shouldUnescape
    />
  );
}
