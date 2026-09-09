const SENSITIVE_PATTERN = /\b(?:bearer\s+\S+|access[_-]?token\s*[:=]\s*\S+|refresh[_-]?token\s*[:=]\s*\S+|password\s*[:=]\s*\S+)\b/gi;
const URL_PATTERN = /https?:\/\/\S+/gi;
const USER_PATH_PATTERN = /(?:[a-z]:\\Users\\|\/Users\/|\/home\/)[^\\/\s]+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const INTERNAL_PATTERN = /(?:Error invoking remote method|ENOENT|EACCES|ERR_IPC|at\s+\S+\s+\()/i;

export function sanitizeRendererText(value, maxLength = 300) {
  return String(value || "")
    .replace(SENSITIVE_PATTERN, "[REDACTED]")
    .replace(URL_PATTERN, "[URL]")
    .replace(USER_PATH_PATTERN, "[USER_PATH]")
    .replace(EMAIL_PATTERN, "[EMAIL]")
    .trim()
    .slice(0, maxLength);
}

export function getRendererErrorMessage(error, fallback) {
  const code = String(error?.code || "");
  if (["ECONNREFUSED", "ERR_NETWORK", "ETIMEDOUT", "ENOTFOUND"].includes(code)) {
    return "No fue posible conectarse con el servidor. Verifica tu conexión a internet.";
  }
  const raw = error?.response?.data?.message || error?.message;
  const status = Number(error?.response?.status) || Number(String(raw || "").match(/status code\s+(\d{3})/i)?.[1]);
  if (status >= 500) {
    return `El servicio no está disponible temporalmente (código ${status}). Intenta nuevamente en unos minutos.`;
  }
  if (typeof raw !== "string" || !raw.trim() || INTERNAL_PATTERN.test(raw)) return fallback;
  return sanitizeRendererText(raw, 300) || fallback;
}

export function reportRendererError(context, error) {
  const safeContext = sanitizeRendererText(context, 100) || "Operación del renderer";
  const safeMessage = getRendererErrorMessage(error, "Error interno controlado.");
  console.error(`[renderer] ${safeContext}: ${safeMessage}`);
}
