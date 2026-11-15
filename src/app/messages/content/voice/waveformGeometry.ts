// Sizes in px that VoiceWaveform.tsx and VoiceWaveform.css.ts share.
export const BAR_WIDTH = 2;
export const BAR_GAP = 1;
// One bar and its gap: how far the bars move per new sample, and the dotted line's repeat.
export const BAR_STEP = BAR_WIDTH + BAR_GAP;
// The farthest a live glide starts from rest, in bar steps; the strip reaches this far past
// its start so a glide never bares the edge. More samples at once jump the rest of the way.
export const GLIDE_MAX_STEPS = 2;
