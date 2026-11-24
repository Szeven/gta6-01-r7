// Neon Bay — synthesized sound effects (WebAudio, no audio files).
// Everything is generated: engine hum, siren, gunshot, crash, pickup, punch.
// The engine only starts after a user gesture (autoplay policy).
(function (global) {
  'use strict';

  function AudioEngine() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = 0;
  }

  AudioEngine.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    } catch (e) { this.ctx = null; }
  };

  AudioEngine.prototype.setMuted = function (m) {
    this.muted = m;
    if (this.engineGain) this.engineGain.gain.value = m ? 0 : 0.05;
    if (this.sirenGain) this.sirenGain.gain.value = m ? 0 : 0.03;
  };

  AudioEngine.prototype._noise = function (dur, freq, vol) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    src.start();
  };

  AudioEngine.prototype._blip = function (f0, f1, dur, vol, type) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(f0, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), ctx.currentTime + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + dur);
  };

  AudioEngine.prototype.shot = function () { this._noise(0.12, 2400, 0.5); this._blip(220, 60, 0.09, 0.25, 'sawtooth'); };
  AudioEngine.prototype.punch = function () { this._noise(0.08, 500, 0.4); };
  AudioEngine.prototype.crash = function () { this._noise(0.3, 900, 0.6); };
  AudioEngine.prototype.pickup = function () { this._blip(660, 990, 0.12, 0.25, 'sine'); };
  AudioEngine.prototype.cash = function () { this._blip(880, 1320, 0.18, 0.25, 'sine'); this._blip(1320, 1760, 0.2, 0.18, 'sine'); };
  AudioEngine.prototype.missionDone = function () {
    const self = this;
    [523, 659, 784, 1047].forEach(function (f, i) {
      setTimeout(function () { self._blip(f, f, 0.22, 0.25, 'triangle'); }, i * 110);
    });
  };
  AudioEngine.prototype.busted = function () { this._blip(400, 110, 0.7, 0.3, 'sawtooth'); };

  AudioEngine.prototype.startEngine = function () {
    if (!this.ctx || this.engineOsc) return;
    const ctx = this.ctx;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = this.muted ? 0 : 0.05;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 420;
    this.engineOsc.connect(filter); filter.connect(this.engineGain); this.engineGain.connect(ctx.destination);
    this.engineOsc.start();
  };

  AudioEngine.prototype.setEngine = function (speed01) {
    if (this.engineOsc) this.engineOsc.frequency.value = 50 + speed01 * 130;
  };

  AudioEngine.prototype.stopEngine = function () {
    if (this.engineOsc) {
      try { this.engineOsc.stop(); } catch (e) {}
      this.engineOsc = null; this.engineGain = null;
    }
  };

  AudioEngine.prototype.startSiren = function () {
    if (!this.ctx || this.sirenOsc) return;
    const ctx = this.ctx;
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'sine';
    this.sirenOsc.frequency.value = 720;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = this.muted ? 0 : 0.03;
    this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(ctx.destination);
    this.sirenOsc.start();
  };

  AudioEngine.prototype.updateSiren = function (dt) {
    if (!this.sirenOsc) return;
    this.sirenTimer += dt;
    const f = (Math.floor(this.sirenTimer * 1.6) % 2 === 0) ? 720 : 980;
    this.sirenOsc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
  };

  AudioEngine.prototype.stopSiren = function () {
    if (this.sirenOsc) {
      try { this.sirenOsc.stop(); } catch (e) {}
      this.sirenOsc = null; this.sirenGain = null;
    }
  };

  global.NB = global.NB || {};
  global.NB.AudioEngine = AudioEngine;
})(typeof window !== 'undefined' ? window : globalThis);
