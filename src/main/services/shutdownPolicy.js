export function settleWithTimeout(operation, timeoutMs, message = 'Tiempo de espera agotado') {
  const safeTimeoutMs = Math.min(30000, Math.max(100, Number(timeoutMs) || 5000));
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), safeTimeoutMs);
    timer.unref?.();
  });
  return Promise.race([Promise.resolve(operation), timeout])
    .finally(() => clearTimeout(timer));
}
