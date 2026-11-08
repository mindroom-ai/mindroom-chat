// The example plugin's build module (docs/architecture.md "Client plugins"): the build runs its
// transform on the plugin's own modules, where it writes the banner's words in place of a marker.
/** @type {import('vite').Plugin} */
export default {
  name: 'example-banner-words',
  transform: (code) =>
    code.includes('__EXAMPLE_BANNER__')
      ? { code: code.replaceAll('__EXAMPLE_BANNER__', 'Example banner'), map: null }
      : null,
};
