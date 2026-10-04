const STORAGE_KEY = 'mortal_sales_muted';
const MASTER_VOLUME = 0.6;

/**
 * Purely-synthesized sound effects via the raw Web Audio API — there are no
 * audio files to load, so Phaser's Sound manager (built around loaded audio
 * assets) doesn't fit here. Defaults to muted (this is an always-on office
 * display, not something that should make noise unprompted); the mute
 * button's own first click is the user gesture that satisfies the browser's
 * autoplay policy and creates/resumes the AudioContext.
 */
class AudioSystemImpl {
    private ctx: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private muted = localStorage.getItem(STORAGE_KEY) !== 'false';

    /** Safe to call repeatedly — a no-op after the first call. Must run inside a user-gesture handler. */
    init() {
        if (this.ctx) return;
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.muted ? 0 : MASTER_VOLUME;
        this.masterGain.connect(this.ctx.destination);
    }

    /**
     * Sound that was switched on once should come back after a reload, but a browser only lets audio start after a click.
     * So, when sound is on, the first click or key press anywhere on the page creates/resumes the audio context
     * (an office browser started with --autoplay-policy=no-user-gesture-required does not need the click at all).
     */
    unlockOnGesture() {
        const unlock = () => {
            if (this.muted) return;
            try {
                this.init();
                void this.ctx?.resume();
            } catch { /* no audio in this browser: the display stays silent */ }
        };
        // Allowed to try straight away (works with the autoplay flag); otherwise the context waits, suspended, for the gesture.
        unlock();
        for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, unlock, { passive: true });
    }

    toggleMute(): boolean {
        this.muted = !this.muted;
        localStorage.setItem(STORAGE_KEY, String(this.muted));
        if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : MASTER_VOLUME;
        if (!this.muted) void this.ctx?.resume();
        return this.muted;
    }

    get isMuted() {
        return this.muted;
    }

    playHitThud() {
        this.tone(110, 'sine', 0.001, 0.12);
        this.noiseBurst(0.05, 0.15);
    }

    /** The heavy blow: a deep body thump with a crack on top. */
    playHeavyHit() {
        this.tone(78, 'sine', 0.001, 0.26);
        this.tone(140, 'square', 0.001, 0.08);
        this.noiseBurst(0.16, 0.24, 'lowpass', 900);
    }

    /** Whoosh of a fighter sent flying. */
    playLaunch() {
        if (!this.ctx || !this.masterGain) return;
        const t0 = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(700, t0);
        osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.7);
        gain.gain.setValueAtTime(0.18, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.7);
        osc.connect(gain).connect(this.masterGain);
        osc.start(t0);
        osc.stop(t0 + 0.75);
        this.noiseBurst(0.6, 0.12, 'bandpass', 1200);
    }

    /** Dazed: two wobbling notes. */
    playStun() {
        this.tone(660, 'triangle', 0.01, 0.18);
        this.tone(520, 'triangle', 0.01, 0.22, 0.2);
    }

    /** A star of the day's winner lighting up: a short rising chime with a sparkle on top. */
    playStarGain() {
        this.tone(880, 'triangle', 0.002, 0.14);
        this.tone(1175, 'triangle', 0.002, 0.14, 0.09);
        this.tone(1568, 'triangle', 0.002, 0.3, 0.18);
        this.noiseBurst(0.16, 0.06, 'highpass', 4000);
    }

    /** "FIGHT!" stand-in until a real voice file is dropped in: a rising power chord and a crash. */
    playFightStinger() {
        [98, 147, 196].forEach((f, i) => this.tone(f, 'sawtooth', 0.01, 0.55, i * 0.03));
        this.noiseBurst(0.5, 0.18, 'lowpass', 1500);
    }

    /** A heavy thump — a hero keeling over. */
    playFall() {
        this.tone(85, 'sine', 0.002, 0.22);
        this.noiseBurst(0.12, 0.1, 'lowpass', 380);
    }

    playFanfare() {
        [523, 659, 784, 1047].forEach((freq, i) => this.tone(freq, 'triangle', 0.005, 0.25, i * 0.12));
    }

    private tone(freq: number, type: OscillatorType, attack: number, duration: number, delay = 0) {
        if (!this.ctx || !this.masterGain) return;
        const t0 = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.5, t0 + attack);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + attack + duration);
        osc.connect(gain).connect(this.masterGain);
        osc.start(t0);
        osc.stop(t0 + attack + duration + 0.02);
    }

    private noiseBurst(duration: number, gainLevel: number, filterType?: BiquadFilterType, freq?: number) {
        if (!this.ctx || !this.masterGain) return;
        const bufferSize = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

        const src = this.ctx.createBufferSource();
        src.buffer = buffer;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(gainLevel, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

        let node: AudioNode = src;
        if (filterType) {
            const filter = this.ctx.createBiquadFilter();
            filter.type = filterType;
            filter.frequency.value = freq ?? 1000;
            src.connect(filter);
            node = filter;
        }
        node.connect(gain).connect(this.masterGain);
        src.start();
    }
}

export const AudioSystem = new AudioSystemImpl();
