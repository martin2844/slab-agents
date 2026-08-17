import type { Metadata } from "next";
import { HowItWorksGuide } from "@/components/how-it-works-guide";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "A field guide to the Slab Agent Workspace architecture, operating loops, security boundaries, and local setup.",
};

export default function HowItWorksPage() {
  return <HowItWorksGuide />;
}
