const transparentCallBackground =
  '<style>html,body{background-color:transparent!important}</style>';

export const injectElementCallTransparentBackground = (html) => {
  if (!html.includes('<head>')) {
    throw new Error('Element Call index is missing its <head> element');
  }
  return html.replace('<head>', `<head>${transparentCallBackground}`);
};
