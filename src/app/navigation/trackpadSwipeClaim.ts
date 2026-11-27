export type TrackpadSwipeClaim = {
  move: (deltaX: number, deltaY: number) => void;
  end: () => void;
  cancel: () => void;
  /** When true, `scroll-gesture: end` commits immediately without waiting 1 animation frame. */
  isReadyToCommit?: () => boolean;
};

export type TrackpadSwipeCandidate = {
  path: readonly Element[];
  deltaX: number;
  deltaY: number;
  rtl: boolean;
  blockedByDom: boolean;
};

export type TrackpadSwipeClaimer = {
  /** Called when a horizontal trackpad gesture locks; return a claim to own the gesture. */
  claim: (candidate: TrackpadSwipeCandidate) => TrackpadSwipeClaim | undefined;
  /** Called when a trackpad gesture locks vertically over `path`. */
  onVerticalScroll?: (path: readonly Element[]) => void;
  /** Called when the desktop window hides. */
  onWindowHidden?: () => void;
};

/** Active trackpad swipe claimers registered by views (read by `desktopHistorySwipe`). */
export const trackpadSwipeClaimers = new Set<TrackpadSwipeClaimer>();

/** Registers a macOS Electron trackpad swipe claimer (arbitrated before Back/Forward history). */
export const registerTrackpadSwipeClaimer = (claimer: TrackpadSwipeClaimer): (() => void) => {
  trackpadSwipeClaimers.add(claimer);
  return () => {
    trackpadSwipeClaimers.delete(claimer);
  };
};
