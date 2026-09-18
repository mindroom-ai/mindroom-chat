window.routingBootId = crypto.randomUUID();
document.querySelector('#app').append(` at ${location.pathname}`);
if (new URLSearchParams(location.search).has('resumeProbe')) {
  import('./resume.js');
}
