// Tiny synthesized sound effects (no audio files needed).
let ctx = null;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noise(duration, { freq = 1200, q = 1, gain = 0.3, type = 'bandpass' } = {}) {
  const a = ac();
  if (!a) return;
  const len = Math.floor(a.sampleRate * duration);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

function tone(freq, start, dur, gain = 0.15) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, a.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.05);
}

export const sfx = {
  enabled: true,
  place() { if (this.enabled) tone(520 + Math.random() * 80, 0, 0.08, 0.08); },
  remove() { if (this.enabled) tone(260, 0, 0.1, 0.08); },
  crack() { if (this.enabled) noise(0.25, { freq: 900 + Math.random() * 900, q: 0.8, gain: 0.5 }); },
  splash() { if (this.enabled) noise(0.9, { freq: 500, q: 0.5, gain: 0.6, type: 'lowpass' }); },
  success() { if (this.enabled) [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.11, 0.35)); },
  fail() { if (this.enabled) [392, 330, 262].forEach((f, i) => tone(f, i * 0.15, 0.4)); },
};
