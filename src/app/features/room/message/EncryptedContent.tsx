import { type ReactNode } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';

type EncryptedContentProps = {
  mEvent: MatrixEvent;
  /** Reads the event's type and content at render time, so the clear ones once decrypted. */
  children: ReactNode | (() => ReactNode);
};

/**
 * The row of an encrypted event. Its owner repaints the row when the event decrypts, so this
 * defers reading what the event is until the row renders.
 */
export function EncryptedContent({ children }: EncryptedContentProps) {
  return <>{typeof children === 'function' ? children() : children}</>;
}
