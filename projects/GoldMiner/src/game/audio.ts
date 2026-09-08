// 轻量 WebAudio 音效：全部用振荡器/噪声合成，无外部资源。
// AudioContext 在第一次用户交互后懒创建（浏览器自动播放策略）。

export type SfxName =
  | 'fire'
  | 'grab'
  | 'coin'
  | 'rock'
  | 'boom'
  | 'tick'
  | 'buy'
  | 'levelup'
  | 'fail';

export class Sfx {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  enabled = true;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    let ctx = this.ctx;
    if (!ctx) {
      const Ctor =
        (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
      if (!Ctor) return null;
      try {
        ctx = new Ctor() as AudioContext;
      } catch {
        return null;
      }
      this.ctx = ctx;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  /** 在用户手势（pointerdown/keydown）里调用，解除自动播放限制 */
  unlock() {
    this.ensure();
  }

  play(name: SfxName) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'fire':
        this.tone(t, 340, 180, 0.12, 'square', 0.05);
        break;
      case 'grab':
        this.tone(t, 520, 660, 0.08, 'triangle', 0.08);
        break;
      case 'coin':
        this.tone(t, 880, 880, 0.06, 'square', 0.06);
        this.tone(t + 0.07, 1320, 1320, 0.09, 'square', 0.06);
        break;
      case 'rock':
        this.tone(t, 140, 90, 0.14, 'sawtooth', 0.07);
        break;
      case 'boom':
        this.noise(t, 0.4, 0.22, 900);
        this.tone(t, 120, 40, 0.3, 'sawtooth', 0.12);
        break;
      case 'tick':
        this.tone(t, 1000, 1000, 0.04, 'square', 0.045);
        break;
      case 'buy':
        this.tone(t, 620, 930, 0.09, 'triangle', 0.07);
        break;
      case 'levelup':
        this.tone(t, 523, 523, 0.09, 'square', 0.06);
        this.tone(t + 0.1, 659, 659, 0.09, 'square', 0.06);
        this.tone(t + 0.2, 784, 784, 0.14, 'square', 0.06);
        break;
      case 'fail':
        this.tone(t, 330, 220, 0.2, 'sawtooth', 0.08);
        this.tone(t + 0.22, 220, 140, 0.3, 'sawtooth', 0.08);
        break;
    }
  }

  private tone(
    at: number,
    fromFreq: number,
    toFreq: number,
    dur: number,
    type: OscillatorType,
    gain: number
  ) {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, fromFreq), at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, toFreq), at + dur);
    amp.gain.setValueAtTime(gain, at);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private noise(at: number, dur: number, gain: number, lowpass = 1200) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.noiseBuffer) {
      const len = Math.floor(ctx.sampleRate * 0.5);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, at);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  destroy() {
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}
