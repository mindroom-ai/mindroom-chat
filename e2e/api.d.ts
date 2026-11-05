// e2e/computer/computer-api-cookies.spec.ts imports `../api.js` inside the page: the test's HTTP
// server bundles the computer API client with esbuild and serves it at `/api.js`, which is where
// `../api.js` points from the page at the server's root. These are its types.
export * from '../src/app/computer/api';
