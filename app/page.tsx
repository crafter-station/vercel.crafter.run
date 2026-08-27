import { HeroAnimation } from "@/components/hero-animation";

/**
 * The animation on its own, full bleed.
 *
 * `HeroAnimation` fills its parent, so the only job here is to give it a box -
 * `h-svh` rather than `h-screen` so mobile browser chrome does not crop the ▲.
 */
export default function Page() {
  return (
    <main className="relative h-svh w-full">
      <HeroAnimation />
    </main>
  );
}
