import { CornerPill } from "@/components/corner-pill";

import styles from "./github-stars.module.css";
import { GitHubMark, StarIcon } from "./icons";
import { fetchStargazers, formatStargazers, REPOSITORY } from "./stargazers";

/**
 * Star count badge linking to the repository.
 *
 * An async Server Component: the count is fetched while the page renders and
 * revalidated on the schedule in `stargazers.ts`, so visitors never wait on
 * GitHub and the browser never talks to its API.
 *
 * If the count is unavailable the badge still renders, just without a number,
 * so there is always a way to the source.
 */
export async function GitHubStars() {
  const stars = await fetchStargazers();
  const label =
    stars === null
      ? "View the source on GitHub"
      : `${stars} ${stars === 1 ? "star" : "stars"} on GitHub`;

  return (
    <CornerPill
      aria-label={label}
      corner="top-end"
      href={`https://github.com/${REPOSITORY}`}
      rel="noreferrer"
      target="_blank"
      title={label}
    >
      <GitHubMark />
      {stars === null ? (
        "GitHub"
      ) : (
        <>
          <span aria-hidden className={styles.divider} />
          <StarIcon />
          <span className={styles.count}>{formatStargazers(stars)}</span>
        </>
      )}
    </CornerPill>
  );
}
