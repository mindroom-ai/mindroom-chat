// Sizes in SVG user units that VoiceWaveform.tsx and VoiceWaveform.css.ts share. The compact
// waveform is toRem(32) tall and as wide as its viewBox makes it, so a unit is toRem(1): one px at
// the default root font size, scaled with page zoom.
export const BAR_WIDTH = 2;
export const BAR_GAP = 1;
// One bar and its gap: how far the bars move per new sample, and the dotted line's repeat.
export const BAR_STEP = BAR_WIDTH + BAR_GAP;
// The farthest a live glide starts from rest, in bar steps; the strip reaches this far past
// its start so a glide never bares the edge. More samples at once jump the rest of the way.
export const GLIDE_MAX_STEPS = 2;
