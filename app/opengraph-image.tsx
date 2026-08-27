import { renderHeroOg, OG_CONTENT_TYPE, OG_SIZE } from "@/components/og/hero-og";

export const alt = "Ten LEDs arranged as a triangle, lighting a dark room";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return renderHeroOg({
    eyebrow: "WebGL2 study",
    caption: "Ten LEDs. One fragment shader.",
  });
}
