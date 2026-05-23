// ============================================================
// shared/audio.js — Web Audio synthesized sound effects
// (no external audio files required).
// ============================================================

let ac = null;
function ctx() {
  if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
  return ac;
}

export function beep({ freq = 660, dur = 0.12, type = "sine", gain = 0.18, sweep = 0 } = {}) {
  const a = ctx();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (sweep) {
    o.frequency.exponentialRampToValueAtTime(
      Math.max(40, freq + sweep),
      a.currentTime + dur,
    );
  }
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}

function noise({ dur = 0.15, gain = 0.18, hp = 800 } = {}) {
  const a = ctx();
  const bufferSize = Math.floor(a.sampleRate * dur);
  const buffer = a.createBuffer(1, bufferSize, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
  const src = a.createBufferSource();
  src.buffer = buffer;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  const f = a.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hp;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
  src.stop(a.currentTime + dur);
}

export const sfx = {
  catch: () => {
    beep({ freq: 880, dur: 0.09, type: "triangle", sweep: 400 });
    setTimeout(() => beep({ freq: 1320, dur: 0.1, type: "triangle", sweep: 200 }), 60);
  },
  pop: () => {
    beep({ freq: 1400, dur: 0.05, type: "sawtooth", sweep: -1000, gain: 0.22 });
    noise({ dur: 0.08, gain: 0.15, hp: 1200 });
  },
  slice: () => {
    beep({ freq: 2000, dur: 0.07, type: "sawtooth", sweep: -1600, gain: 0.18 });
    noise({ dur: 0.12, gain: 0.12, hp: 2000 });
  },
  wrong: () => beep({ freq: 220, dur: 0.22, type: "sawtooth", sweep: -120, gain: 0.22 }),
  miss: () => beep({ freq: 180, dur: 0.15, type: "square", gain: 0.15 }),
  bomb: () => {
    beep({ freq: 90, dur: 0.45, type: "sawtooth", gain: 0.3 });
    noise({ dur: 0.4, gain: 0.25, hp: 200 });
  },
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => beep({ freq: f, dur: 0.18, type: "triangle" }), i * 120),
    );
  },
  lose: () => {
    [440, 330, 220].forEach((f, i) =>
      setTimeout(() => beep({ freq: f, dur: 0.25, type: "sawtooth" }), i * 180),
    );
  },
  tick: () => beep({ freq: 880, dur: 0.04, type: "sine", gain: 0.08 }),
  spawn: () => beep({ freq: 1200, dur: 0.04, type: "sine", gain: 0.05 }),
  click: () => beep({ freq: 620, dur: 0.06, type: "square", gain: 0.12 }),
  bgmStart: () => bgm.start(),
  bgmStop:  () => bgm.stop(),
  bgmVolume: (v) => bgm.setVolume(v),
};

// ============================================================
// Background music — simple looped chiptune.
// Pleasant C–Am–F–G feel; runs through a master gain node so we
// can fade in/out without clicks. Tab-aware: pauses on hidden.
// ============================================================
export const bgm = (() => {
  // Eighth-note melody (Hz). 16 steps = 1 loop bar.
  const MELODY = [
    523, 659, 784, 1046, 784, 659, 523, 587,
    440, 523, 659, 784, 659, 523, 440, 392,
  ];
  // Bass on every 4th step.
  const BASS = [131, 0, 0, 0, 165, 0, 0, 0, 110, 0, 0, 0, 147, 0, 0, 0];

  let timer = null;
  let step = 0;
  let master = null;
  let melodyGain = null;
  let bassGain = null;
  let volume = 0.07;

  function ensureNodes() {
    const a = ctx();
    if (!master) {
      master = a.createGain();
      master.gain.value = 0;
      master.connect(a.destination);
      melodyGain = a.createGain(); melodyGain.gain.value = 1.0; melodyGain.connect(master);
      bassGain   = a.createGain(); bassGain.gain.value   = 0.7; bassGain.connect(master);
    }
  }

  function note(dest, freq, dur, type, gain) {
    if (!freq) return;
    const a = ctx();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, a.currentTime);
    g.gain.exponentialRampToValueAtTime(gain, a.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(dest);
    o.start();
    o.stop(a.currentTime + dur + 0.05);
  }

  function tick() {
    const i = step % MELODY.length;
    note(melodyGain, MELODY[i], 0.22, "triangle", 0.18);
    if (BASS[i]) note(bassGain, BASS[i], 0.45, "sine", 0.32);
    // Sparkle every 8 steps
    if (i % 8 === 0) note(melodyGain, MELODY[i] * 2, 0.15, "sine", 0.06);
    step++;
  }

  function start() {
    ensureNodes();
    const a = ctx();
    if (a.state === "suspended") a.resume();
    if (timer) return;
    // Fade in
    master.gain.cancelScheduledValues(a.currentTime);
    master.gain.setValueAtTime(master.gain.value, a.currentTime);
    master.gain.linearRampToValueAtTime(volume, a.currentTime + 0.6);
    tick();
    timer = setInterval(tick, 200); // 150 BPM eighths
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (master) {
      const a = ctx();
      master.gain.cancelScheduledValues(a.currentTime);
      master.gain.setValueAtTime(master.gain.value, a.currentTime);
      master.gain.linearRampToValueAtTime(0, a.currentTime + 0.4);
    }
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(0.3, v));
    if (master) {
      const a = ctx();
      master.gain.cancelScheduledValues(a.currentTime);
      master.gain.linearRampToValueAtTime(volume, a.currentTime + 0.2);
    }
  }

  // Pause when tab hidden
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (timer) { clearInterval(timer); timer = null; }
      } else if (master && master.gain.value > 0.001) {
        if (!timer) timer = setInterval(tick, 200);
      }
    });
  }

  return { start, stop, setVolume };
})();
