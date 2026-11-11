// Server wall-clock reference, advanced using local monotonic elapsed time.
export class TrustedClock {
  constructor(monotonicNow = () => performance.now()) {
    this.monotonicNow = monotonicNow;
    this.anchor = null;
    this.last = null;
  }
  synchronize(value, requestedAt = this.monotonicNow()) {
    const timestamp = Date.parse(value);
    const at = this.monotonicNow();
    if (!Number.isFinite(timestamp) || !Number.isFinite(requestedAt) || requestedAt > at) return false;
    if (at - requestedAt > 10000) return false;
    if (this.anchor && requestedAt < this.anchor.requestedAt) return false;
    if (this.anchor) this.now();
    this.anchor = { timestamp: timestamp + (at - requestedAt) / 2, at, requestedAt };
    return true;
  }
  isReady() { return this.anchor !== null; }
  now() {
    if (!this.anchor) throw new Error('Conecta con el servidor antes de iniciar el seguimiento para verificar la hora.');
    this.last = Math.max(this.last ?? -Infinity, this.anchor.timestamp + Math.max(0, this.monotonicNow() - this.anchor.at));
    return this.last;
  }
  date() { return new Date(this.now()); }
}
export default new TrustedClock();
