/**
 * Reads the star count from the GitHub API.
 *
 * Server-only: it runs inside a Server Component, so the request is made by
 * Next at render time and its result is cached with the page.
 */

/** The repository the badge points at, as `owner/name`. */
export const REPOSITORY = "crafter-station/vercel.crafter.run";

/**
 * How long a count is served before GitHub is asked again, in seconds.
 *
 * Unauthenticated requests are limited to 60 per hour per IP. With the result
 * cached for an hour the site makes at most one, so a token is optional -
 * `GITHUB_TOKEN` is used when present and just raises the ceiling.
 */
export const REVALIDATE_SECONDS = 3600;

/**
 * How long to wait for GitHub before giving up, in milliseconds.
 *
 * This runs during `next build`, and a hung request there would hang the whole
 * deploy. Better to ship the badge without a number.
 */
const TIMEOUT_MS = 5000;

/**
 * Fetches the stargazer count for `repository`.
 *
 * Resolves to `null` rather than throwing when GitHub is unreachable, rate
 * limited, or returns something unexpected: the badge is decoration, and a
 * missing number must never take the landing page down with it.
 */
export async function fetchStargazers(
  repository: string = REPOSITORY,
): Promise<number | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(`https://api.github.com/repos/${repository}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!response.ok) return null;

    const body: unknown = await response.json();
    const count = (body as { stargazers_count?: unknown }).stargazers_count;
    return typeof count === "number" && Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

/**
 * Compact form for display: `1`, `999`, `1.2k`, `12k`.
 *
 * Lower-case `k` to match how GitHub itself renders the count.
 */
export function formatStargazers(count: number): string {
  return COMPACT.format(count).toLowerCase();
}

const COMPACT = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
