const STORAGE_KEY = 'mortal_sales_muted';
const MASTER_VOLUME = 0.6;

/**
 * Recorded clips in public/assets/audio: the announcer's calls and the fight theme. They are fetched at start and decoded
 * once the audio context exists; a missing file is fine — the synthesized stand-ins below play instead.
 */
export const CLIP_FILES = {
    fight: 'fight.mp3',
    round1: 'round1.mp3',
    round2: 'round2.mp3',
    round3: 'round3.mp3',
    finish: 'finish-her.mp3',
    fatality: 'fatality.mp3',
    flawless: 'flawless-victory.mp3',
    theme: 'theme.mp3',
} as const;
export type Clip = keyof typeof CLIP_FILES;
export type Voice = Exclude<Clip, 'theme'>;

/** Rounds of a day that have their own call ("Round one" ... "Round three"); later rounds only get "Fight!". */
export const VOICED_ROUNDS = 3;

const THEME_VOLUME = 0.32;
/** The theme steps back while the announcer speaks. */
const THEME_DUCKED = 0.1;
const THEME_FADE_IN_S = 0.6;
const THEME_FADE_OUT_S = 1.8;
/** The theme plays on this long after the last fight / finale before it fades, so back-to-back animations keep one tune. */
const THEME_TAIL_MS = 2500;

interface DecodedClip {
    buffer: AudioBuffer;
    /** The audible part, seconds: recordings come with silence around the call, which would put the voice late. */
    start: number;
    end: number;
}

/** Where the sound in a buffer begins and ends (anything below 4 % of the peak counts as silence). */
function audibleRange(buffer: AudioBuffer): { start: number; end: number } {
    const data = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    const threshold = Math.max(0.005, peak * 0.04);
    let first = 0;
    while (first < data.length && Math.abs(data[first]) < threshold) first++;
    let last = data.length - 1;
    while (last > first && Math.abs(data[last]) < threshold) last--;
    if (first >= last) return { start: 0, end: buffer.duration };
    return { start: Math.max(0, first / buffer.sampleRate - 0.015), end: Math.min(buffer.duration, last / buffer.sampleRate + 0.06) };
}

/**
 * The display's sound through the raw Web Audio API: synthesized effects (hits, falls, stars) plus the recorded
 * announcer calls and fight theme, all through one master gain, so the mute button covers everything. Phaser's Sound
 * manager is not used: most sounds are generated, and one graph is simpler to mute and duck. Defaults to muted (this is
 * an always-on office display, not something that should make noise unprompted); the mute button's own first click is
 * the user gesture that satisfies the browser's autoplay policy and creates/resumes the AudioContext.
 */
class AudioSystemImpl {
    private ctx: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private muted = localStorage.getItem(STORAGE_KEY) !== 'false';

    /** Fetched but not yet decoded (no audio context yet), and decoded clips. */
    private fetched = new Map<Clip, ArrayBuffer>();
    private clips = new Map<Clip, DecodedClip>();

    private theme: { src: AudioBufferSourceNode; gain: GainNode; startedAt: number; offset: number } | null = null;
    /** Where the theme stopped last time (seconds into the audible part), so the office does not hear the same intro all day. */
    private themeResumeAt = 0;
    private themeHolds = 0;
    private themeStopTimer: number | null = null;

    /** Safe to call repeatedly — a no-op after the first call. Must run inside a user-gesture handler. */
    init() {
        if (this.ctx) return;
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.muted ? 0 : MASTER_VOLUME;
        this.masterGain.connect(this.ctx.destination);
        this.decodeFetched();
    }

    /** Starts fetching every recorded clip (relative to the page, like the other assets). Call once at start. */
    loadClips(base = 'assets/audio/') {
        for (const [name, file] of Object.entries(CLIP_FILES) as [Clip, string][]) {
            fetch(base + file)
                .then(res => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`${file}: ${res.status}`))))
                .then(bytes => {
                    this.fetched.set(name, bytes);
                    this.decodeFetched();
                })
                .catch(() => { /* no such file: the synthesized stand-in plays instead */ });
        }
    }

    private decodeFetched() {
        const ctx = this.ctx;
        if (!ctx) return;
        for (const [name, bytes] of this.fetched) {
            this.fetched.delete(name);
            ctx.decodeAudioData(bytes)
                .then(buffer => {
                    this.clips.set(name, { buffer, ...audibleRange(buffer) });
                    if (name === 'theme' && this.themeHolds > 0) this.startTheme(); // a fight is already on
                })
                .catch(() => { /* undecodable file: stays silent */ });
        }
    }

    hasClip(name: Clip): boolean {
        return this.clips.has(name);
    }

    /** Plays an announcer call from its first audible sound. False when the clip is not there (not loaded, no sound yet). */
    voice(name: Voice): boolean {
        const clip = this.clips.get(name);
        if (!clip || !this.ctx || !this.masterGain) return false;
        const src = this.ctx.createBufferSource();
        src.buffer = clip.buffer;
        src.connect(this.masterGain);
        src.start(0, clip.start, clip.end - clip.start);
        this.duckTheme(clip.end - clip.start);
        return true;
    }

    /** "Fight!" — the recorded call, or the synthesized stinger when there is none. */
    announceFight() {
        if (!this.voice('fight')) this.playFightStinger();
    }

    /** "Round one/two/three" for the first rounds of the day; nothing for later ones (the "Fight!" follows anyway). */
    announceRound(round: number) {
        if (round >= 1 && round <= VOICED_ROUNDS) this.voice(`round${round}` as Voice);
    }

    /** "Finish her!" — or the stinger. */
    announceFinish() {
        if (!this.voice('finish')) this.playFightStinger();
    }

    /* ----------------------------------------------------------- theme */

    /**
     * The fight theme plays while something is fighting: every round and finale holds it (a counter, they can queue up
     * back to back) and lets it go at the end; after the last release it plays on for a moment and fades out.
     */
    holdTheme() {
        this.themeHolds++;
        if (this.themeStopTimer !== null) {
            clearTimeout(this.themeStopTimer);
            this.themeStopTimer = null;
        }
        this.startTheme();
    }

    releaseTheme() {
        this.themeHolds = Math.max(0, this.themeHolds - 1);
        if (this.themeHolds > 0 || this.themeStopTimer !== null) return;
        this.themeStopTimer = window.setTimeout(() => {
            this.themeStopTimer = null;
            if (this.themeHolds === 0) this.stopTheme();
        }, THEME_TAIL_MS);
    }

    private startTheme() {
        const clip = this.clips.get('theme');
        const ctx = this.ctx;
        if (!clip || !ctx || !this.masterGain) return;
        const now = ctx.currentTime;
        if (this.theme) { // still playing (or fading out): bring it back up
            const g = this.theme.gain.gain;
            g.cancelScheduledValues(now);
            g.setValueAtTime(g.value, now);
            g.linearRampToValueAtTime(THEME_VOLUME, now + THEME_FADE_IN_S);
            return;
        }
        const src = ctx.createBufferSource();
        src.buffer = clip.buffer;
        src.loop = true;
        src.loopStart = clip.start;
        src.loopEnd = clip.end;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(THEME_VOLUME, now + THEME_FADE_IN_S);
        src.connect(gain).connect(this.masterGain);
        src.start(now, clip.start + this.themeResumeAt);
        this.theme = { src, gain, startedAt: now, offset: this.themeResumeAt };
    }

    private stopTheme() {
        const ctx = this.ctx;
        const clip = this.clips.get('theme');
        if (!this.theme || !ctx || !clip) return;
        const { src, gain, startedAt, offset } = this.theme;
        const now = ctx.currentTime;
        const length = clip.end - clip.start;
        this.themeResumeAt = length > 0 ? (offset + (now - startedAt) + THEME_FADE_OUT_S) % length : 0;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + THEME_FADE_OUT_S);
        src.stop(now + THEME_FADE_OUT_S + 0.05);
        this.theme = null;
    }

    private duckTheme(seconds: number) {
        if (!this.theme || !this.ctx) return;
        const g = this.theme.gain.gain;
        const now = this.ctx.currentTime;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(THEME_DUCKED, now + 0.08);
        g.setValueAtTime(THEME_DUCKED, now + seconds);
        g.linearRampToValueAtTime(THEME_VOLUME, now + seconds + 0.5);
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

    /** Stand-in for a missing announcer call: a rising power chord and a crash. */
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
