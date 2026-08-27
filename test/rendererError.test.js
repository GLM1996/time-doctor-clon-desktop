import assert from "node:assert/strict";
import test from "node:test";
import { getRendererErrorMessage, sanitizeRendererText } from "../src/renderer/utils/rendererError.js";

test("renderer errors translate network and hide internal IPC details", () => {
  assert.match(getRendererErrorMessage({ code: "ERR_NETWORK" }, "Fallback"), /conectarse/);
  assert.equal(getRendererErrorMessage({ message: "Error invoking remote method ENOENT" }, "Fallback"), "Fallback");
});

test("renderer error sanitizer redacts credentials and personal data", () => {
  const sanitized = sanitizeRendererText("password=secret user@example.com https://api.example.com C:\\Users\\Gustavo\\file.log");
  assert.doesNotMatch(sanitized, /secret|user@example|api\.example|Gustavo/);
  assert.match(sanitized, /\[REDACTED\]|\[EMAIL\]|\[URL\]|\[USER_PATH\]/);
});
