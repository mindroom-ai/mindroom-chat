import React, { MouseEventHandler, ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { color } from 'folds';

const MAX_HEIGHT = '4.5em';

type TruncatedThreadRootBodyProps = {
  mEventId: string;
  onClick: MouseEventHandler;
  children: ReactNode;
};

export function TruncatedThreadRootBody({
  mEventId,
  onClick,
  children,
}: TruncatedThreadRootBodyProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (el) {
      setOverflowing(el.scrollHeight > el.clientHeight);
    }
  });

  return (
    <div>
      <div
        ref={contentRef}
        style={{
          maxHeight: MAX_HEIGHT,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {children}
        {overflowing && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '1.5em',
              background: `linear-gradient(transparent, ${color.Surface.Container})`,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
      {overflowing && (
        <a
          href="#"
          data-thread-root-id={mEventId}
          onClick={(e) => {
            e.preventDefault();
            onClick(e);
          }}
          style={{
            color: color.Primary.Main,
            textDecoration: 'underline',
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          [open thread]
        </a>
      )}
    </div>
  );
}
