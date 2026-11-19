import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from '../../ui/styles/Motion.css';
import { transition } from '../../ui/styles/transition';
import { tagColor } from './threadTagColor';

export interface ThreadTagPillProps {
  name: string;
  onRemove?: () => void; // undefined = read-only (no x button)
}

// Neutral on every surface and theme: the text around it, a little quieter, on a faint tint of it.
// The tag's own colour stays only in a small dot, as in the tag filter's list.
const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  fontSize: '0.65rem',
  fontWeight: 500,
  padding: '0.1rem 0.4rem',
  borderRadius: '0.5rem',
  maxWidth: '8rem',
  color: 'color-mix(in srgb, currentColor 80%, transparent)',
  backgroundColor: 'color-mix(in srgb, currentColor 8%, transparent)',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
};

const dotStyle: React.CSSProperties = {
  flexShrink: 0,
  width: '0.375rem',
  height: '0.375rem',
  borderRadius: '50%',
};

const labelStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const removeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
  fontSize: '0.6rem',
  lineHeight: 1,
  color: 'inherit',
  transition: transition(['opacity'], motion.duration.Normal),
  display: 'inline-flex',
  alignItems: 'center',
};

export function ThreadTagPill({ name, onRemove }: ThreadTagPillProps) {
  const { t } = useTranslation();
  return (
    <span style={pillStyle} title={name} className="thread-tag-pill">
      <span style={{ ...dotStyle, backgroundColor: tagColor(name) }} aria-hidden="true" />
      <span style={labelStyle} dir="auto">
        {name}
      </span>
      {onRemove && (
        <button
          type="button"
          style={removeButtonStyle}
          className="thread-tag-pill-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={t('mindroomUi.threads.threadTagPill.removeTag', { tag: name })}
        >
          ×
        </button>
      )}
    </span>
  );
}
