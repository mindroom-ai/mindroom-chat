import { createRoot } from 'react-dom/client';

// Served at /e2e-plugins/sample-plugin/e2e/fixtures/page.html (scripts/e2e-plugin-pages.mjs), with React
// from this repository's packages.
const root = document.getElementById('root');
if (root) createRoot(root).render(<p>Rendered by the sample plugin&apos;s page</p>);
