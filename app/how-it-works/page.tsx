import type { Metadata } from "next";
import { HowItWorksGuide } from "@/components/how-it-works-guide";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The operational guide to Slab architecture, agents, custom tools, Gmail OAuth, Proton Bridge, runs, and troubleshooting.",
};

export default function HowItWorksPage() {
  return <HowItWorksGuide />;
}
