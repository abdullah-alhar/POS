/** Short sounds so the cashier knows a scan worked without looking at the screen. */
let ctx: AudioContext | null = null;

function tone(frequency: number, ms: number, type: OscillatorType = 'sine', volume = 0.08) {
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
    osc.start(now);
    osc.stop(now + ms / 1000);
  } catch {
    /* no sound available */
  }
}

export const beep = {
  ok: () => tone(1400, 70),
  error: () => tone(180, 260, 'square', 0.06),
  done: () => {
    tone(880, 90);
    setTimeout(() => tone(1320, 140), 100);
  },
};
