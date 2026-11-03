import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import classNames from 'classnames';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { Text, as } from 'folds';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import { getMemberDisplayName } from '../../utils/room';
import { getEmojiByUnicode } from '../../plugins/emoji';
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

/** One reaction chip with its count; pressed when the user reacted with it. */
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
          <img className={css.ReactionImg} src={imageSrc} alt={reaction} />
        ) : (
          <Text as="span" size="Inherit" className={css.ReactionText}>














  events: MatrixEvent[];
};

const MAX_NAMED_REACTORS = 5;

/** "Alice, Bob and 3 others reacted with :thumbsup:" for a reaction chip's tooltip. */
export function ReactionTooltipMsg({ room, reaction, events }: ReactionTooltipMsgProps) {
  const { t, i18n } = useTranslation();
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
    : getEmojiByUnicode(reaction)?.shortcode ?? customShortcode ?? reaction;

  return (
    <Trans
      i18nKey="sharedUi.reaction.reactionSummary"
      values={{
        names: new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(listed),
        reaction: shortcode,
      }}
      components={{ names: <b />, reaction: <span /> }}
    />
  );
}
