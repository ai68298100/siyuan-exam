/**
 * External-link policy used by rich-text click handlers and material opening.
 *
 * This module intentionally has no DOM dependency so the URL policy can be
 * exercised in the offline test suite. Sanitization is a separate boundary:
 * this helper decides what to do when a surviving href is activated.
 */

export type LinkDisposition = "internal" | "external" | "blocked";

export interface ResolvedLink {
  disposition: LinkDisposition;
  href: string;
}

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Resolve an href against the current page and classify it for the privacy
 * gate. Same-origin URLs and fragments remain internal. Unknown protocols and
 * malformed values are blocked so they cannot silently bypass the gate.
 */
export function resolveLink(rawHref: string, baseHref: string): ResolvedLink {
  const raw = rawHref.trim();
  if (!raw) return { disposition: "blocked", href: "" };

  // A fragment never causes a network request and should retain normal browser
  // navigation semantics even when the document has no explicit base URL.
  if (raw.startsWith("#")) return { disposition: "internal", href: raw };

  let resolved: URL;
  try {
    resolved = new URL(raw, baseHref);
  } catch {
    return { disposition: "blocked", href: raw };
  }

  if (resolved.protocol === "http:" || resolved.protocol === "https:") {
    try {
      const base = new URL(baseHref);
      return {
        disposition: resolved.origin === base.origin ? "internal" : "external",
        href: resolved.href,
      };
    } catch {
      return { disposition: "blocked", href: raw };
    }
  }

  if (EXTERNAL_PROTOCOLS.has(resolved.protocol)) {
    return { disposition: "external", href: resolved.href };
  }

  // Relative URLs with a non-network base (for example a test fixture) are
  // still navigable only when URL resolution produced a known same-origin
  // protocol. Unknown schemes such as javascript:, file:, and data: fail shut.
  return { disposition: "blocked", href: raw };
}

export function isExternalHref(rawHref: string, baseHref: string): boolean {
  return resolveLink(rawHref, baseHref).disposition === "external";
}
