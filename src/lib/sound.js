// The Filing Mode "did it" chime — generated with WebAudio so there's no
// audio asset to load. A quick two-note major-third ding with fast decay,
// pitched up slightly each time merges chain quickly (combo feel).
let ctx = null;
let lastDing = 0;
let combo = 0;

function tone(freq, start, duration, gainPeak) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(gainPeak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

export function playMergeDing() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    // Merges within 2s of each other climb a step — a tiny reward loop.
    combo = performance.now() - lastDing < 2000 ? Math.min(combo + 1, 6) : 0;
    lastDing = performance.now();
    const base = 660 * 2 ** (combo / 12);
    tone(base, now, 0.28, 0.12);
    tone(base * 1.26, now + 0.07, 0.32, 0.1);
  } catch {
    // Audio is decoration — never let it break a merge.
  }
}

// Softer "nope" for an invalid merge target (e.g. file onto box).
export function playNope() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    tone(220, now, 0.15, 0.06);
    tone(196, now + 0.09, 0.18, 0.06);
  } catch {
    /* same */
  }
}
