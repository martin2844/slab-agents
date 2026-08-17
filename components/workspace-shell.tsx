"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  CalendarClock,
  FileText,
  BookOpenText,
  LayoutDashboard,
  Menu,
  PanelsTopLeft,
  Plug,
  Settings,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/work", label: "Work", icon: PanelsTopLeft },
  { href: "/docs", label: "Docs", icon: FileText },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/automations", label: "Automations", icon: CalendarClock },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/runs", label: "Runs", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3 px-3 py-2">
      <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Workflow className="size-4" />
      </span>
      <span>
        <span className="block font-heading text-lg font-semibold leading-none tracking-tight">
          Slab
        </span>
        <span className="mt-1 block text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Agent workspace
        </span>
      </span>
    </Link>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary navigation" className="flex flex-col gap-1">
      {nav.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/" ? pathname === href : pathname.startsWith(href);
        return (
          <Button
            key={href}
            asChild
            variant="ghost"
            className={cn(
              "h-10 justify-start gap-3 rounded-lg px-3 font-medium",
              active && "bg-sidebar-accent text-sidebar-accent-foreground",
              !active && "text-muted-foreground hover:text-foreground",
            )}
          >
            <Link href={href} onClick={onNavigate}>
              <Icon className="size-4" />
              <span>{label}</span>
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

function HowItWorksLink({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <Button
      asChild
      variant={pathname === "/how-it-works" ? "default" : "outline"}
      className="w-full justify-start"
    >
      <Link href="/how-it-works" onClick={onNavigate}>
        <BookOpenText />
        How it works
      </Link>
    </Button>
  );
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-sidebar-border bg-sidebar p-4 lg:flex lg:flex-col">
        <Brand />
        <div className="mt-8">
          <Navigation />
        </div>
        <div className="mt-auto px-3 py-2">
          <span className="mb-2 block h-px bg-border" />
          <HowItWorksLink />
        </div>
      </aside>
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden">
        <Brand />
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open navigation"
              />
            }
          >
            <Menu />
          </SheetTrigger>
          <SheetContent side="left" className="flex w-72 flex-col p-4">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Brand />
            <div className="mt-8">
              <Navigation onNavigate={() => setMobileOpen(false)} />
            </div>
            <div className="mt-auto px-3 pb-2">
              <span className="mb-3 block h-px bg-border" />
              <HowItWorksLink onNavigate={() => setMobileOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      </header>
      <main id="main-content" className="min-h-dvh lg:pl-64">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8 xl:px-10 xl:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
