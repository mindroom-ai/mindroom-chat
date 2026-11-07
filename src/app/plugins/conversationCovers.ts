import type { ComponentType } from 'react';
import type { Room } from 'matrix-js-sdk';
import { isRecord } from '../lib/isRecord';

/**
 * A layer a plugin draws over a room's conversation, under the room header, such as a full view
 * of something the room works on. `covers` and `subscribe` follow React's `useSyncExternalStore`.
 */
export type ConversationCover = {
  /** Whether it covers the room's conversation now; pure and synchronous. */
  covers: (room: Room) => boolean;
  /** Calls `onChange` whenever `covers` may answer differently for the room; returns its stop. */
  subscribe: (room: Room, onChange: () => void) => () => void;
  /** What it shows over the conversation. */
  Component: ComponentType<{ room: Room }>;
  /** Escape in the cover calls it; without it, Escape leaves the cover where it is. */
  close?: (room: Room) => void;
};

/** Whether a plugin's contribution is a conversation cover; the build does not type-check plugins. */
export const isConversationCover = (value: unknown): value is ConversationCover =>
  isRecord(value) &&
  typeof value.covers === 'function' &&
  typeof value.subscribe === 'function' &&
  (typeof value.Component === 'function' || isRecord(value.Component)) &&
  (value.close === undefined || typeof value.close === 'function');
