export async function retryRequest(
  callback,
  {
    attempts = 3,
    isRetryable = () => true,
    getDelayMs = attempt => attempt * 1000,
    wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  } = {},
) {
  if (typeof callback !== 'function') throw new TypeError('callback debe ser una función');

  const maximumAttempts = Math.max(1, Math.floor(Number(attempts) || 1));
  let lastError;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await callback(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt >= maximumAttempts) throw error;

      const delay = Math.max(0, Number(getDelayMs(attempt, error)) || 0);
      await wait(delay);
    }
  }

  throw lastError;
}
