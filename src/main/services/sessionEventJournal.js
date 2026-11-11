import { describeSessionSyncError } from './sessionSyncErrors.js';
// Durable start/stop events. A server acknowledgement never redefines the interval.
export class SessionEventJournal {
  constructor({ read, write }) {
    this.write = write;
    this.records = read();
    if (!Array.isArray(this.records) || this.records.some(item => !item?.localId || !item.ownerId || !Number.isFinite(Date.parse(item.startTime)))) throw new Error('Registro de sesiones inválido');
    this.inFlight = null;
  }
  commit(records) {
    this.write(records); // Persist BEFORE publishing the new state or acknowledging the UI.
    this.records = records;
  }
  find(id) { if (!id) return undefined; return this.records.find(item => item.localId === id || item.remoteId === id); }
  update(id, patch) {
    this.commit(this.records.map(item => item.localId === id ? { ...item, ...patch } : item));
    return this.find(id);
  }
  start(record) {
    if (this.find(record.localId)) throw new Error('La sesión local ya existe');
    this.commit([...this.records, { ...record, lastObservedAt: record.startTime, endTime: null }]);
  }
  checkpoint(id, time) {
    const item = this.find(id);
    if (item && !item.endTime) this.update(item.localId, { lastObservedAt: time });
  }
  stop(id, endTime, reason = 'manual', notes = null, activity = {}) {
    const item = this.find(id);
    if (!item) throw new Error('No existe el inicio local de la sesión');
    return this.update(item.localId, { endTime, lastObservedAt: endTime, reason, notes,
      activeTime: activity.activeTime, idleTime: activity.idleTime,
      pausedTime: activity.pausedTime, activitySnapshots: activity.activitySnapshots,
    });
  }
  remove(id) { this.commit(this.records.filter(item => item.localId !== id)); }
  recover() {
    // Never count time while the app was not running. Recover the last durable observation.
    this.commit(this.records.map(item => item.endTime ? item : {
      ...item, endTime: item.lastObservedAt || item.startTime, reason: 'system',
    }));
  }
  retryBlocked(ownerId) {
    this.commit(this.records.map(item => item.ownerId === ownerId && item.blocked
      ? { ...item, blocked: false, lastError: null } : item));
  }
  pending(ownerId) {
    return this.records.filter(item => item.ownerId === ownerId && (!item.remoteId || item.endTime));
  }
  async sync(ownerId, { create, stop, linked, closed, rejected }) {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.flush(ownerId, { create, stop, linked, closed, rejected });
    try { return await this.inFlight; } finally { this.inFlight = null; }
  }
  async flush(ownerId, handlers) {
    let count = 0;
    for (const initial of this.records.filter(item => item.ownerId === ownerId)) {
      let item = this.find(initial.localId);
      if (!item) continue;
      if (item.blocked) throw new Error(item.lastError || 'Hay una sesión pendiente de revisión');
      try {
        let completedSession = null;
        if (!item.remoteId) {
          const session = await handlers.create(item);
          if (session === null) continue; // Older servers upload completed intervals only.
          if (!session?._id) throw new Error('El servidor no confirmó el inicio');
          item = this.update(item.localId, { remoteId: String(session._id) });
          if (session.status === 'ended') completedSession = session;
        }
        // Repeat linking after restart too: a crash can happen between persisting the ID
        // and rewriting the activity/screenshot queues.
        await handlers.linked?.(item);
        item = this.find(item.localId); // Stop may have been clicked while start was in flight.
        if (item && (completedSession || item.endTime)) {
          const session = completedSession || await handlers.stop(item);
          if (session?.status !== 'ended') throw new Error('El servidor no confirmó el cierre');
          await handlers.closed?.(item, session);
          this.remove(item.localId);
          count++;
        }
      } catch (error) {
        const status = error.response?.status;
        const blocked = status >= 400 && status < 500 && ![401, 408, 425, 429].includes(status);
        if (this.find(initial.localId)) this.update(initial.localId, {
          blocked, errorStatus: status || null, lastError: describeSessionSyncError(error),
        });
        if (blocked) await handlers.rejected?.(this.find(initial.localId), error);
        throw error;
      }
    }
    return count;
  }
}
