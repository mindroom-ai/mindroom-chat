import {
  type ComponentType,
  type ForwardedRef,
  type LazyExoticComponent,
  createElement,
  forwardRef,
  lazy,
  useEffect,
  useState,
} from 'react';

type PartModule<P> = { default: ComponentType<P> };
type Attempt<P> = { Part: LazyExoticComponent<ComponentType<P>> };

/** What a part's `Unavailable` view gets besides the part's props. */
export type PartLoadRetry = {
  /**
   * Loads the part again. When the load succeeds the part replaces its `Unavailable` view; when it
   * fails the promise rejects and `Unavailable` stays.
   */
  retryLoad: () => Promise<void>;
};

function NothingLoaded() {
  return null;
}

const warnFailed = (error: unknown) =>
  console.warn('[lazy-part] could not load a part of the app', error);

/**
 * `React.lazy` for a part of a screen that loads on demand. The service worker keeps such a chunk
 * only once a page has loaded it (src/sw/swRuntimeAssets.ts), so it can be missing offline, or gone
 * from the server after a deploy while an older page still runs. Then the part renders
 * `Unavailable` with its props and `retryLoad` (nothing by default) instead of taking the whole app
 * down with it, and the next mount tries the load again.
 *
 * A ref given to the part reaches the loaded component, as with `React.lazy`; while the part
 * loads, and when it could not, the ref stays empty.
 */
export function lazyPart<P extends object>(
  load: () => Promise<PartModule<P>>,
  Unavailable: ComponentType<P & PartLoadRetry> = NothingLoaded
): ComponentType<P> {
  const loaded = (module: PartModule<P>): Attempt<P> => ({
    Part: lazy(() => Promise.resolve(module)),
  });
  const attempt = (): Attempt<P> => {
    const current: Attempt<P> = {
      Part: lazy(() =>
        load().catch((error: unknown) => {
          warnFailed(error);
          // Parts mount from the attempt they started with; only once this failure is on screen
          // do later mounts get a fresh one. A mount that suspends is thrown away and starts
          // over, so switching any earlier would load again and again while it fails.
          function Failed(props: P, ref: ForwardedRef<unknown>) {
            const [Loaded, setLoaded] = useState<ComponentType<P>>();
            useEffect(() => {
              if (latest === current) latest = attempt();
            }, []);
            if (Loaded) return createElement(Loaded, { ...props, ref });
            // `Unavailable` gets the props without the ref, which has nothing to point at here.
            const retryLoad = () =>
              load().then(
                (module) => {
                  latest = loaded(module);
                  setLoaded(() => module.default);
                },
                (retryError: unknown) => {
                  warnFailed(retryError);
                  throw retryError;
                }
              );
            return createElement(Unavailable, { ...props, retryLoad });
          }
          return { default: forwardRef(Failed) as unknown as ComponentType<P> };
        })
      ),
    };
    return current;
  };
  let latest = attempt();

  function LazyPart(props: P, ref: ForwardedRef<unknown>) {
    // A lazy component takes the props of the one it loads; React's types cannot say so for P.
    const [Part] = useState(() => latest.Part as unknown as ComponentType<P>);
    return createElement(Part, { ...props, ref });
  }
  return forwardRef(LazyPart) as unknown as ComponentType<P>;
}
