import type { Metadata } from "next";

import { Playground } from "@/components/playground/playground";

export const metadata: Metadata = {
  title: "playground",
  description:
    "Take the hero animation apart: live shader controls, geometry overlays, the choreography curves, and the baked light atlas.",
};

export default function PlaygroundPage() {
  return <Playground />;
}
