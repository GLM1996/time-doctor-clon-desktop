export function createSingleFlightRunner() {
  let current = null;
  return (operation) => {
    if (current) return current;
    current = Promise.resolve().then(operation);
    current.finally(() => {
      current = null;
    }).catch(() => {});
    return current;
  };
}
