export const CALLBACK_NAMESPACE = "oqr";
export const CALLBACK_VERSION = "v1";
export const MAX_CALLBACK_VALUE_BYTES = 42;
export const TELEGRAM_CALLBACK_DATA_MAX_BYTES = 64;

const CALLBACK_PREFIX = `${CALLBACK_NAMESPACE}:${CALLBACK_VERSION}:`;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function buildSuggestionCallbackData(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || normalized !== value) return null;
  const bytes = Buffer.from(normalized, "utf8");
  if (bytes.byteLength > MAX_CALLBACK_VALUE_BYTES) return null;
  const payload = `${CALLBACK_PREFIX}${bytes.toString("base64url")}`;
  return Buffer.byteLength(payload, "utf8") <= TELEGRAM_CALLBACK_DATA_MAX_BYTES ? payload : null;
}

export function parseSuggestionCallbackValue(payload: unknown): string | null {
  if (typeof payload !== "string" || !payload.startsWith(CALLBACK_PREFIX)) return null;
  if (Buffer.byteLength(payload, "utf8") > TELEGRAM_CALLBACK_DATA_MAX_BYTES) return null;

  const encoded = payload.slice(CALLBACK_PREFIX.length);
  if (!encoded || !BASE64URL_PATTERN.test(encoded)) return null;

  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_CALLBACK_VALUE_BYTES) return null;
    if (bytes.toString("base64url") !== encoded) return null;
    const value = utf8Decoder.decode(bytes);
    if (!value || value !== value.trim()) return null;
    return value;
  } catch {
    return null;
  }
}
