// 音效全部即時合成，不需要音檔。
let ctx = null;
let soundOn = false; // 廟裡與家中都預設靜音

export function setSound(on) {
  soundOn = on;
  if (on) unlockAudio();
}

export function unlockAudio() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume();
}

function tone(freq, duration, gain) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(gain, ctx.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function noiseBurst(duration, freq, gain) {
  const samples = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / samples) ** 3;
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const amp = ctx.createGain();
  src.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  amp.gain.value = gain;
  src.connect(filter).connect(amp).connect(ctx.destination);
  src.start();
}

export function playBell() {
  if (!ctx || !soundOn) return;
  tone(392, 2.6, 0.16);
  tone(784.7, 1.8, 0.08);
  tone(1180, 1, 0.04);
}

export function playClack() {
  if (!ctx || !soundOn) return;
  noiseBurst(0.09, 1500, 1.2);
  tone(620, 0.09, 0.14);
}

export function playRattle() {
  if (!ctx || !soundOn) return;
  noiseBurst(0.05, 2600 + Math.random() * 1600, 0.7);
}

export function buzz(pattern) {
  navigator.vibrate?.(pattern);
}
