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

function NothingLoaded() {
  return null;
}

/**
 * `React.lazy` for a part of a screen that loads on demand. The service worker keeps such a chunk
 * only once a page has loaded it (src/swRuntimeAssets.ts), so it can be missing offline, or gone
 * from the server after a deploy while an older page still runs. Then the part renders
 * `Unavailable` with its props (nothing by default; a popover or panel can close itself there)
 * instead of taking the whole app down with it, and the next mount tries the load again.
 *
 * A ref given to the part reaches the loaded component, as with `React.lazy`; while the part
 * loads, and when it could not, the ref stays empty.
 */
export function lazyPart<P extends object>(
  load: () => Promise<PartModule<P>>,
  Unavailable: ComponentType<P> = NothingLoaded
): ComponentType<P> {
  const attempt = (): Attempt<P> => {
    const current: Attempt<P> = {
      Part: lazy(() =>
        load().catch((error: unknown) => {
          console.warn('[lazy-part] could not load a part of the app', error);
          // Parts mount from the attempt they started with; only once this failure is on screen
          // do later mounts get a fresh one. A mount that suspends is thrown away and starts
          // over, so switching any earlier would load again and again while it fails.
          // `Unavailable` gets the props without the ref, which has nothing to point at here.
          function Failed(props: P, _ref: ForwardedRef<unknown>) {
            useEffect(() => {
              if (latest === current) latest = attempt();
            }, []);
            return createElement(Unavailable, props);
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
