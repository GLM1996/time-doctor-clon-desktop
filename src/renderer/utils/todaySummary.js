const seconds = value => Number.isFinite(Number(value)) ? Math.max(0,Math.floor(Number(value))) : 0;

export function resolveTodaySummary(data = {}) {
  return {
    total: data.settledDuration != null ? seconds(data.settledDuration)
      : data.closedDuration != null ? seconds(data.closedDuration) + seconds(data.manualDuration) + seconds(data.paidBreakDuration)
      : Math.max(0,seconds(data.totalDuration)-seconds(data.activeDuration)),
    sessionCount:seconds(data.sessionCount),
    date:data.date || null,
    authoritative:data.authoritative === true,
  };
}

export function reconcileTodayTotal(current,next,{ sameDay,authoritative }) {
  return sameDay && !authoritative ? Math.max(current,next) : next;
}

export function subscribeTodayRefresh(reload,target) {
  const refresh = () => { void reload(); };
  const interval=target.setInterval(refresh,30000);
  target.addEventListener('focus',refresh);
  target.addEventListener('online',refresh);
  return () => {
    target.clearInterval(interval);
    target.removeEventListener('focus',refresh);
    target.removeEventListener('online',refresh);
  };
}
