import { ReactNode, type Ref, useId, useRef } from 'react';
import { Icon, Icons, IconSrc, Spinner } from 'folds';
import * as css from './ThreadActivity.css';
import { IsolatedText, ownDirectionLine } from './directional';
import { useRevealOnOpen } from './disclosureReveal';
import { usePersistedDisclosure } from './manualExpansionState';

export type ActivityTone = keyof typeof css.Icon;

/** Small rounded tile for an activity line or a panel row. */
export function ActivityIcon({
  src,
  tone = 'neutral',
  pending = false,
}: {
  src: IconSrc;
  tone?: ActivityTone;
  pending?: boolean;
}) {
  return (
    <span className={css.Icon[tone]} aria-hidden>
      {pending ? <Spinner size="50" variant="Secondary" /> : <Icon size="50" src={src} />}
    </span>
  );
}

/**
 * What an agent did, as one quiet line in the message: icon, bold title, muted detail.
 * The line toggles a panel with the details.
 */
export function ThreadActivity({
  rootRef,
  icon,
  title,
  detail,
  aside,
  preview,
  disclosureKey,
  children,
}: {
  rootRef?: Ref<HTMLDivElement>;
  icon: ReactNode;
  title: string;
  detail?: string;
  // Shown at the end of the line, after the detail, which gives way first.
  aside?: ReactNode;
  // Shown under the line whether or not the panel is open.
  preview?: ReactNode;
  disclosureKey?: string | readonly string[];
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = usePersistedDisclosure(disclosureKey, false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const armReveal = useRevealOnOpen(expanded, toggleRef, panelRef);
  return (
    // Keeps the interface's direction in a message that reads the other way (index.css).
    <div ref={rootRef} className={css.Activity} data-message-disclosure="">
      <button
        ref={toggleRef}
        type="button"
        className={css.Line}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => {
          if (!expanded) armReveal();
          setExpanded((value) => !value);
        }}
      >
        {icon}
        <span className={css.Title}>
          <IsolatedText text={title} />
        </span>
        {detail && (
          <span className={css.Detail} {...ownDirectionLine}>
            {detail}
          </span>
        )}
        {aside}
        <Icon size="50" className={css.Chevron} src={Icons.ChevronRight} aria-hidden />
      </button>
      {preview}
      {expanded && (
        <div ref={panelRef} id={panelId} className={css.Panel}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A tool result shown on one line; selecting it shows the whole text. It reads in its own
 * direction, so `8 results` keeps its order in a right-to-left interface.
 */
export function ActivityResult({ text, disclosureKey }: { text: string; disclosureKey?: string }) {
  const [full, setFull] = usePersistedDisclosure(disclosureKey, false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const armReveal = useRevealOnOpen(full, buttonRef, buttonRef);
  return (
    <button
      ref={buttonRef}
      type="button"
      className={css.Result}
      aria-expanded={full}
      onClick={() => {
        if (!full) armReveal();
        setFull((value) => !value);
      }}
      {...ownDirectionLine}
    >
      {text}
    </button>
  );
}
