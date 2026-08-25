import type { Metadata } from "next";
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource-variable/instrument-sans/wght-italic.css";
import "@fontsource/commit-mono/400.css";
import "@fontsource/commit-mono/500.css";
import "@fontsource/commit-mono/600.css";
import "./globals.css";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceShell } from "@/components/workspace-shell";
import { authenticationRequired } from "@/lib/auth/service";

export const metadata: Metadata = {
  title: { default: "Slab Workspace", template: "%s · Slab Workspace" },
  description: "A local control plane for work, knowledge, and agents.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <TooltipProvider>
          <WorkspaceShell authEnabled={authenticationRequired()}>
            {children}
          </WorkspaceShell>
          <Toaster richColors position="bottom-right" />
        </TooltipProvider>
      </body>
    </html>
  );
}
