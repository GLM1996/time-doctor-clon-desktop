const operations = new Map();

export function runSingleFlight(key, operation) {
  if (operations.has(key)) return operations.get(key);
  const promise = Promise.resolve().then(operation);
  operations.set(key, promise);
  promise.finally(() => {
    if (operations.get(key) === promise) operations.delete(key);
  }).catch(() => {});
  return promise;
}
