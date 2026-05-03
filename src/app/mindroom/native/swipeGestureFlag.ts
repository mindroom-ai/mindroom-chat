const INTERACTIVE_SWIPE_OWNED_EVENT_FLAG = '__mindroomInteractiveSwipeOwned';

export type TouchEventWithInteractiveSwipeFlag = TouchEvent & {
  [INTERACTIVE_SWIPE_OWNED_EVENT_FLAG]?: boolean;
};

export const markInteractiveSwipeOwned = (evt: TouchEvent): void => {
  (evt as TouchEventWithInteractiveSwipeFlag)[INTERACTIVE_SWIPE_OWNED_EVENT_FLAG] = true;
};

export const hasInteractiveSwipeOwnership = (evt: TouchEvent): boolean =>
  (evt as TouchEventWithInteractiveSwipeFlag)[INTERACTIVE_SWIPE_OWNED_EVENT_FLAG] === true;
