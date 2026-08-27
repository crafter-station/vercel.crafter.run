import { Suspense } from "react";

import { GitHubStars } from "@/components/github-stars";
import { HeroAnimation } from "@/components/hero-animation";

/**
 * The animation on its own, full bleed.
 *
 * `HeroAnimation` fills its parent, so the only job here is to give it a box -
 * `h-svh` rather than `h-screen` so mobile browser chrome does not crop the ▲.
 *
 * The star badge fetches on the server; it sits in a Suspense boundary so that
 * if this route is ever rendered per request, the ▲ still streams first.
 */
export default function Page() {
  return (
    <main className="relative h-svh w-full">
      <HeroAnimation />
      <Suspense fallback={null}>
        <GitHubStars />
      </Suspense>
    </main>
  );
}
