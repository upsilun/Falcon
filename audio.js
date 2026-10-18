/* Falcon IR — recorded seeker clips from the user's supplied MP3,
   with procedural aircraft ambience and game effects. Entirely offline. */
(function (global) {
  'use strict';

  class FalconAudio {
    constructor() {
      this.context = null;
      this.master = null;
      this.muted = false;
      this.disposed = false;
      this.paused = false;
      this.supported = !!(global.AudioContext || global.webkitAudioContext);
      this._sources = new Set();
      this._nodes = [];
      this._lastCue = Object.create(null);
      this._mixPaused = true;
      this._masterLevel = 0.62;
    }

    async start() {
      if (!this.supported || this.disposed) return false;
      try {
        if (!this.context) {
          const Context = global.AudioContext || global.webkitAudioContext;
          this.context = new Context();
          this.master = this.context.createGain();
          this.master.gain.value = this.muted ? 0 : this._masterLevel;
          // A gentle peak limiter keeps the seeker, engine and impact mix controlled.
          if (this.context.createDynamicsCompressor) {
            const limiter = this.context.createDynamicsCompressor();
            limiter.threshold.value = -10;
            limiter.knee.value = 8;
            limiter.ratio.value = 6;
            limiter.attack.value = 0.003;
            limiter.release.value = 0.18;
            this.master.connect(limiter);
            limiter.connect(this.context.destination);
            this._nodes.push(limiter);
          } else this.master.connect(this.context.destination);
          this._flightMix = this.context.createGain();
          this._flightMix.gain.value = 0;
          this._flightMix.connect(this.master);
          this._nodes.push(this._flightMix);
          this._nodes.push(this.master);
          this._makeAmbience();
          this._makeSeeker();
        }
        if (this.context.state === 'suspended') await this.context.resume();
        return this.context.state === 'running';
      } catch (_) {
        // Audio is optional, including on browsers with restrictive policies.
        return false;
      }
    }

    setMuted(muted) {
      this.muted = !!muted;
      if (this.context && this.master && this.context.state !== 'closed') {
        this._gate(this.master.gain, this.muted ? 0 : this._masterLevel, 0.045);
      }
    }

    _gate(parameter, value, seconds) {
      try {
        const now = this.context.currentTime;
        if (parameter.cancelAndHoldAtTime) parameter.cancelAndHoldAtTime(now);
        else {
          parameter.cancelScheduledValues(now);
          parameter.setValueAtTime(parameter.value, now);
        }
        // A finite ramp reaches absolute silence, unlike an exponential tail.
        parameter.linearRampToValueAtTime(value, now + seconds);
      } catch (_) { /* A closing context is harmless. */ }
    }

    _target(parameter, value, lag) {
      try {
        parameter.setTargetAtTime(value, this.context.currentTime, lag || 0.1);
      } catch (_) { /* A closing context is harmless. */ }
    }

    _noiseBuffer(seconds) {
      const ctx = this.context;
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < samples.length; i++) {
        // Slightly soften white noise before shaping it with audio filters.
        previous = previous * 0.28 + (Math.random() * 2 - 1) * 0.72;
        samples[i] = previous;
      }
      return buffer;
    }

    _source(source, nodes) {
      this._sources.add(source);
      source.onended = () => {
        this._sources.delete(source);
        try { source.disconnect(); } catch (_) { /* Already disconnected. */ }
        if (nodes) nodes.forEach(node => {
          try { node.disconnect(); } catch (_) { /* Already disconnected. */ }
        });
      };
      return source;
    }

    _makeAmbience() {
      const ctx = this.context;
      this._noise = this._noiseBuffer(3);
      const wind = this._source(ctx.createBufferSource());
      wind.buffer = this._noise;
      wind.loop = true;
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 100;
      this._windFilter = ctx.createBiquadFilter();
      this._windFilter.type = 'lowpass';
      this._windFilter.frequency.value = 1050;
      this._windFilter.Q.value = 0.35;
      this._windGain = ctx.createGain();
      this._windGain.gain.value = 0;
      wind.connect(highpass);
      highpass.connect(this._windFilter);
      this._windFilter.connect(this._windGain);
      this._windGain.connect(this._flightMix);
      wind.start();

      const rumble = this._source(ctx.createBufferSource());
      rumble.buffer = this._noise;
      rumble.loop = true;
      rumble.playbackRate.value = 0.67;
      const rumbleFilter = ctx.createBiquadFilter();
      rumbleFilter.type = 'lowpass';
      rumbleFilter.frequency.value = 180;
      rumbleFilter.Q.value = 0.45;
      this._rumbleGain = ctx.createGain();
      this._rumbleGain.gain.value = 0;
      rumble.connect(rumbleFilter);
      rumbleFilter.connect(this._rumbleGain);
      this._rumbleGain.connect(this._flightMix);
      rumble.start();

      this._engine = this._source(ctx.createOscillator());
      this._engine.type = 'sine';
      this._engine.frequency.value = 53;
      this._engineGain = ctx.createGain();
      this._engineGain.gain.value = 0;
      this._engine.connect(this._engineGain);
      this._engineGain.connect(this._flightMix);
      this._engine.start();

      // A restrained pair of turbine tones produces a spooling engine character.
      this._turbine = this._source(ctx.createOscillator());
      this._turbine.type = 'triangle';
      this._turbine.frequency.value = 420;
      this._turbineGain = ctx.createGain();
      this._turbineGain.gain.value = 0;
      this._turbine.connect(this._turbineGain);
      this._turbineGain.connect(this._flightMix);
      this._turbine.start();
      this._turbineHarmonic = this._source(ctx.createOscillator());
      this._turbineHarmonic.type = 'sine';
      this._turbineHarmonic.frequency.value = 860;
      this._turbineHarmonicGain = ctx.createGain();
      this._turbineHarmonicGain.gain.value = 0;
      this._turbineHarmonic.connect(this._turbineHarmonicGain);
      this._turbineHarmonicGain.connect(this._flightMix);
      this._turbineHarmonic.start();
      this._nodes.push(highpass, this._windFilter, this._windGain,
        rumbleFilter, this._rumbleGain, this._engineGain,
        this._turbineGain, this._turbineHarmonicGain);
    }

    _makeSeeker() {
      this._sampleVoices = new Map();
      this.seekerSamplesReady = false;
      this.seekerSampleError = null;
      const pack = global.FalconSeekerSamples;
      if (!pack || !Array.isArray(pack.stages)) {
        this.seekerSampleError = 'Load seeker-samples.js before audio.js.';
        return;
      }
      try {
        const ctx = this.context;
        const at = ctx.currentTime + 0.01;
        for (const id of ['search', 'weak', 'strong', 'lock']) {
          const clip = pack.stages.find(stage => stage.id === id);
          if (!clip || typeof clip.pcm !== 'string') throw new Error('Missing seeker clip: ' + id);
          // Direct PCM avoids async codecs, fetch, CORS and file:// restrictions.
          // These samples are actual excerpts of the user-supplied recording.
          const bytes = global.atob(clip.pcm);
          const frames = Math.floor(bytes.length / 2);
          const buffer = ctx.createBuffer(1, frames, pack.sampleRate || 44100);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < frames; i++) {
            const word = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
            data[i] = (word > 32767 ? word - 65536 : word) / 32768;
          }
          const voice = this._source(ctx.createBufferSource());
          const gain = ctx.createGain();
          gain.gain.value = 0;
          voice.buffer = buffer;
          voice.loop = true;
          voice.loopStart = 0;
          voice.loopEnd = buffer.duration || frames / (pack.sampleRate || 44100);
          voice.playbackRate.value = 1;
          voice.connect(gain);
          gain.connect(this._flightMix);
          this._nodes.push(gain);
          this._sampleVoices.set(id, {source: voice, gain, clip});
          voice.start(at);
        }
        this.seekerSamplesReady = this._sampleVoices.size === 4;
      } catch (error) {
        // Aircraft and effects remain available if sample data is unavailable.
        this.seekerSampleError = String(error && error.message || error);
      }
    }

    _setSeekerMix(strength, tracking) {
      if (!this._sampleVoices || !this._sampleVoices.size) return;
      const weights = {search: 0, weak: 0, strong: 0, lock: 0};
      if (tracking) weights.lock = 1;
      else {
        const signal = Math.max(0, Math.min(1, Number(strength) || 0));
        // Aim proximity alone controls the recorded stages, including while the
        // acquire control is not held. Lock uses only the final recorded tone.
        const pivot = 0.45;
        const first = signal <= pivot ? 'search' : 'weak';
        const second = signal <= pivot ? 'weak' : 'strong';
        const t = signal <= pivot ? signal / pivot : (signal - pivot) / (1 - pivot);
        weights[first] = Math.cos(t * Math.PI * 0.5);
        weights[second] = Math.sin(t * Math.PI * 0.5);
      }
      this.seekerStage = Object.keys(weights).reduce((a, b) => weights[a] >= weights[b] ? a : b);
      this.seekerWeights = weights;
      for (const [id, voice] of this._sampleVoices) {
        // Equal-power stage blends plus short gain ramps prevent abrupt changes.
        // No pitch shifting, filtering, or synthesized seeker is layered in.
        this._target(voice.gain.gain, weights[id] * 0.82, 0.085);
      }
    }

    update(state) {
      const data = state || {};
      this.paused = !!data.paused;
      if (!this.context || this.disposed || this.context.state !== 'running') return;
      try {
        const bounded = (value, fallback, maximum = 1) => {
          const n = Number(value);
          return Math.max(0, Math.min(maximum, Number.isFinite(n) ? n : fallback));
        };
        let speed = Number(data.speed);
        if (!Number.isFinite(speed)) speed = 0.5;
        // Keep compatibility with the original knots-style input as well.
        if (speed > 1) speed /= 700;
        speed = bounded(speed, 0.5);
        const throttle = bounded(data.throttle, 0.5 + speed * 0.45, 1.2);
        const load = Math.max(1, bounded(data.load, 1, 5));
        const strain = (load - 1) / 4;
        const boost = Math.max(0, throttle - 1) * 5;
        if (this._mixPaused !== this.paused) {
          this._mixPaused = this.paused;
          this._gate(this._flightMix.gain, this.paused ? 0 : 1, this.paused ? 0.06 : 0.18);
        }
        const tracking = !!data.tracking;
        const acquiring = !!data.acquiring && !tracking;
        const strength = bounded(data.seekerStrength, tracking ? 1 : acquiring ? 0.76 : 0);
        const signal = tracking ? 1 : strength;

        // Flight bed: wind follows speed/load; engine spool follows throttle.
        // Pull it down slightly under a lock to keep the seeker unmistakable.
        const bed = tracking ? 0.8 : 1;
        this._target(this._windGain.gain, bed * (0.05 + speed * 0.10 + strain * 0.045), 0.28);
        this._target(this._rumbleGain.gain, bed * (0.075 + throttle * 0.12 + boost * 0.055), 0.55);
        this._target(this._engineGain.gain, bed * (0.016 + throttle * 0.035 + strain * 0.012), 0.5);
        this._target(this._engine.frequency, 43 + throttle * 49 + strain * 8, 0.65);
        this._target(this._windFilter.frequency, 650 + speed * 1900 + strain * 500, 0.35);
        this._target(this._turbine.frequency, 270 + throttle * 650 + strain * 65, 0.7);
        this._target(this._turbineGain.gain, bed * (0.012 + throttle * 0.032), 0.6);
        this._target(this._turbineHarmonic.frequency, 610 + throttle * 1420, 0.8);
        this._target(this._turbineHarmonicGain.gain, bed * (0.005 + throttle * 0.014), 0.6);

        this._setSeekerMix(signal, tracking);
      } catch (_) { /* Sound must never interrupt gameplay. */ }
    }

    _tone(frequency, duration, volume, delay, endFrequency, destination) {
      const ctx = this.context;
      const at = ctx.currentTime + (delay || 0);
      const gain = ctx.createGain();
      const oscillator = this._source(ctx.createOscillator(), [gain]);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, at);
      if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(volume, at + Math.min(0.018, duration / 4));
      gain.gain.setValueAtTime(volume, at + duration * 0.55);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      oscillator.connect(gain);
      gain.connect(destination || this._flightMix);
      oscillator.start(at);
      oscillator.stop(at + duration + 0.02);
    }

    _swell(duration, volume, startHz, endHz, attack) {
      const ctx = this.context;
      const at = ctx.currentTime;
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const source = this._source(ctx.createBufferSource(), [gain, filter]);
      source.buffer = this._noise;
      filter.type = 'lowpass';
      filter.Q.value = 0.5;
      filter.frequency.setValueAtTime(startHz, at);
      filter.frequency.exponentialRampToValueAtTime(endHz, at + duration);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(volume, at + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this._flightMix);
      source.start(at);
      source.stop(at + duration + 0.03);
    }

    cue(name) {
      if (!this.context || this.disposed || this.muted || this.context.state !== 'running') return;
      if (this.paused && name !== 'click') return;
      const now = this.context.currentTime;
      const spacing = name === 'acquire' ? 0.3 : 0.08;
      if (this._lastCue[name] !== undefined && now - this._lastCue[name] < spacing) return;
      this._lastCue[name] = now;
      try {
        switch (name) {
          case 'acquire':
            // Acquisition feedback comes from aim proximity in the sample mix.
            break;
          case 'lock':
            this._setSeekerMix(1, true);
            break;
          case 'release':
            // Short rack/drop clunk, deliberately separate from motor ignition.
            this._swell(0.14, 0.17, 1350, 240, 0.006);
            this._tone(132, 0.115, 0.085, 0, 71);
            break;
          case 'launch':
            this._swell(0.95, 0.28, 1800, 250, 0.1);
            this._tone(145, 0.55, 0.045, 0, 57);
            break;
          case 'hit':
            this._swell(1.35, 0.38, 900, 90, 0.035);
            this._tone(83, 0.7, 0.13, 0, 34);
            break;
          case 'escape':
            this._tone(490, 0.14, 0.05);
            this._tone(360, 0.22, 0.045, 0.17);
            break;
          case 'click':
            this._tone(710, 0.035, 0.025, 0, undefined, this.master);
            break;
          default:
            break;
        }
      } catch (_) { /* Interrupted or unavailable audio is safe to ignore. */ }
    }

    dispose() {
      this.disposed = true;
      this._sources.forEach(source => {
        try { source.stop(); } catch (_) { /* Already stopped. */ }
        try { source.disconnect(); } catch (_) { /* Already disconnected. */ }
      });
      this._sources.clear();
      this._nodes.forEach(node => {
        try { node.disconnect(); } catch (_) { /* Already disconnected. */ }
      });
      this._nodes.length = 0;
      if (this._sampleVoices) this._sampleVoices.clear();
      if (this.context && this.context.state !== 'closed') {
        try {
          const closing = this.context.close();
          if (closing && closing.catch) closing.catch(() => {});
        } catch (_) { /* Already closed. */ }
      }
      this.context = null;
      this.master = null;
      this._flightMix = null;
    }
  }

  global.FalconAudio = FalconAudio;
})(typeof window !== 'undefined' ? window : globalThis);
