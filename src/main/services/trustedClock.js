export class TrustedClock {
  constructor(monotonicNow = () => performance.now()) {
    this.monotonicNow = monotonicNow;
    this.anchor = null;
  }

  synchronize(serverTime) {
    if (this.anchor) return;
    const timestamp = Date.parse(serverTime);
    if (Number.isFinite(timestamp)) {
      this.anchor = { timestamp, at: this.monotonicNow() };
    }
  }

  isReady() {
    return this.anchor !== null;
  }

  now() {
    if (!this.anchor) {
      throw new Error('Conecta con el servidor antes de iniciar el seguimiento para verificar la hora.');
    }
    return this.anchor.timestamp + Math.max(0, this.monotonicNow() - this.anchor.at);
  }

  date() {
    return new Date(this.now());
  }
}

export default new TrustedClock();
