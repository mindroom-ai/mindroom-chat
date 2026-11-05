import { loadKatex } from '../app/rich-text/lazyKatex';

// The app loads KaTeX with the first message that has math (`app/plugins/lazyKatex.tsx`). Tests
// render math in one pass, so they start with KaTeX loaded; `lazyKatex.test.tsx` covers the
// render before it arrives.
await loadKatex();
