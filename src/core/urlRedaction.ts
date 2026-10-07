/**
 * URL shown in dialogs, error回执 and diagnostics.
 *
 * A user may deliberately copy the original URL, but a URL rendered in a
 * message must not expose signed query values or fragment state.  Keep the
 * destination useful by retaining the scheme, host and path while replacing
 * the complete query and fragment.  This is a pure helper so it can be used
 * by UI and logging boundaries without touching the network or the DOM.
 */

const DISPLAYABLE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const REDACTED_PART = "[redacted]";
const BLOCKED_URL = "[blocked URL]";

/**
 * Return a safe URL representation for human-facing output.
 *
 * The original value is intentionally never returned on parse failure or for
 * an unsupported protocol: malformed values can still contain credentials or
 * a token and therefore are not safe to echo in an error message.
 */
export function redactUrlForDisplay(rawUrl: string): string {
  const raw = rawUrl.trim();
  if (!raw) return BLOCKED_URL;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return BLOCKED_URL;
  }

  if (!DISPLAYABLE_PROTOCOLS.has(parsed.protocol)) return BLOCKED_URL;

  const hadSearch = parsed.search.length > 0;
  const hadHash = parsed.hash.length > 0;

  // Credentials are never useful in a destination preview and may be a
  // second credential channel even when the query is empty.
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";

  let safe = parsed.toString();
  if (hadSearch) safe += `?${REDACTED_PART}`;
  if (hadHash) safe += `#${REDACTED_PART}`;
  return safe;
}

