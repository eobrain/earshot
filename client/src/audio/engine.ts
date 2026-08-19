// Per-peer audio graph (architecture §5):
//   remote stream → GainNode (hush) → StereoPannerNode (pan) → destination
// Plus AnalyserNode taps for VAD on every peer and on the local mic.
//
// Chrome gotcha handled here: a remote WebRTC MediaStream stays silent when
// routed only through WebAudio unless it is ALSO attached to a media element;
// we attach each stream to a hidden muted <audio> to keep samples flowing.

const RAMP_S = 0.5;               // matches the UI's animated pins
const VAD_ON = 0.02, VAD_OFF = 0.008;  // RMS hysteresis
const VAD_POLL_MS = 150;

interface Peer {
  gain: GainNode;
  panner: StereoPannerNode;
  analyser: AnalyserNode;
  el: HTMLAudioElement;
  buf: Float32Array<ArrayBuffer>;
  talking: boolean;
}

export class AudioEngine {
  private ctx = new AudioContext();
  private peers = new Map<string, Peer>();
  private micAnalyser?: AnalyserNode;
  private micBuf?: Float32Array<ArrayBuffer>;
  private micTalking = false;
  mic?: MediaStream;
  onTalking: (id: string, talking: boolean) => void = () => {};

  /** Call from the "Headphones on!" OK tap — the user gesture that unlocks audio. */
  async unlock(): Promise<void> {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  async openMic(): Promise<MediaStream> {
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const src = this.ctx.createMediaStreamSource(this.mic);
    this.micAnalyser = this.ctx.createAnalyser();
    this.micAnalyser.fftSize = 512;
    this.micBuf = new Float32Array(this.micAnalyser.fftSize);
    src.connect(this.micAnalyser); // analysis only; never to destination (no self-echo)
    return this.mic;
  }

  attach(id: string, stream: MediaStream): void {
    this.detach(id);
    const el = document.createElement("audio");
    el.muted = true;
    el.srcObject = stream;
    el.play().catch(() => {});
    document.body.appendChild(el);

    const src = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(gain).connect(panner).connect(this.ctx.destination);
    gain.connect(analyser);
    this.peers.set(id, { gain, panner, analyser, el, buf: new Float32Array(analyser.fftSize), talking: false });
  }

  detach(id: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    p.el.remove();
    p.gain.disconnect(); p.panner.disconnect(); p.analyser.disconnect();
    this.peers.delete(id);
    if (p.talking) this.onTalking(id, false);
  }

  setPan(id: string, pan: number): void {
    const p = this.peers.get(id);
    p?.panner.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, pan)), this.ctx.currentTime + RAMP_S);
  }

  /** hush count n → gain 10^(−10n/20) (spec: −10 dB per active hush). */
  setHushCount(id: string, n: number): void {
    const p = this.peers.get(id);
    p?.gain.gain.linearRampToValueAtTime(Math.pow(10, -n / 2), this.ctx.currentTime + RAMP_S);
  }

  startVad(): void {
    window.setInterval(() => {
      for (const [id, p] of this.peers) {
        p.analyser.getFloatTimeDomainData(p.buf);
        const talking = this.hyst(rms(p.buf), p.talking);
        if (talking !== p.talking) { p.talking = talking; this.onTalking(id, talking); }
      }
      if (this.micAnalyser && this.micBuf) {
        this.micAnalyser.getFloatTimeDomainData(this.micBuf);
        const talking = this.hyst(rms(this.micBuf), this.micTalking);
        if (talking !== this.micTalking) { this.micTalking = talking; this.onTalking("me", talking); }
      }
    }, VAD_POLL_MS);
  }

  private hyst(level: number, was: boolean): boolean {
    return was ? level > VAD_OFF : level > VAD_ON;
  }
}

function rms(buf: Float32Array<ArrayBuffer>): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}
