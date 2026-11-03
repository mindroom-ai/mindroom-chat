import React from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { Text, as } from 'folds';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import { getMemberDisplayName } from '../../utils/room';
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




















  const names = events.map((event) => {
    const sender = event.getSender() ?? '';
    return getMemberDisplayName(room, sender) ?? sender;
  });
  const shortcode = events
    .map((event) => event.getContent().shortcode)
    .find((value): value is string => typeof value === 'string');
  const shown = reaction.startsWith('mxc://') ? `:${shortcode ?? 'emoji'}:` : reaction;

  return (
    <>
      {t('sharedUi.reaction.reactedWith', {
        names: new Intl.ListFormat(undefined, { type: 'conjunction' }).format(names),
        reaction: shown,
      })}
    </>
  );
}
