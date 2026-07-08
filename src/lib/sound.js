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

// Explode: a quick descending three-note tumble — things spilling out,
// deliberately the inverse shape of the rising merge ding.
export function playExplode() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    tone(740, now, 0.12, 0.09);
    tone(587, now + 0.06, 0.14, 0.09);
    tone(440, now + 0.13, 0.22, 0.08);
  } catch {
    // Audio is decoration — never let it break an explode.
  }
}

// Per-level win: a rising major arpeggio, one note longer per hierarchy
// level (folder=3 notes, box=4, collection=5) so bigger completions sound
// bigger. Distinct from the two-note per-merge ding.
export function playLevelWin(level = 2) {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const steps = [0, 4, 7, 12, 16]; // major arpeggio in semitones
    const count = Math.min(3 + Math.max(0, level - 2), steps.length);
    for (let i = 0; i < count; i++) {
      tone(523 * 2 ** (steps[i] / 12), now + i * 0.09, 0.35, 0.11);
    }
  } catch {
    /* same */
  }
}

// The whole-workspace win: a fuller two-octave fanfare with a held chord.
export function playGrandWin() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const melody = [0, 4, 7, 12, 16, 19, 24];
    melody.forEach((s, i) => tone(392 * 2 ** (s / 12), now + i * 0.1, 0.4, 0.1));
    // Held closing chord.
    for (const s of [12, 16, 19, 24]) {
      tone(392 * 2 ** (s / 12), now + melody.length * 0.1, 1.1, 0.07);
    }
  } catch {
    /* same */
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
