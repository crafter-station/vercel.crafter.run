import { renderHeroOg, OG_CONTENT_TYPE, OG_SIZE } from "@/components/og/hero-og";

export const alt = "The hero animation playground";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return renderHeroOg({
    eyebrow: "Playground",
    caption: "Take the shader apart, live.",
  });
}
