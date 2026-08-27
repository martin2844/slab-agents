"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Bot,
  CalendarClock,
  Database,
  FileText,
  BookOpenText,
  LayoutDashboard,
  Menu,
  PanelsTopLeft,
  PackageOpen,
  Plug,
  Settings,
  CircleCheck,
  LogOut,
} from "lucide-react";
import { SlabBrandMark } from "@/components/slab-brand-mark";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const nav = [
  {
    label: "Operate",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/work", label: "Work", icon: PanelsTopLeft },
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/runs", label: "Runs", icon: Activity },
    ],
  },
  {
    label: "Context",
    items: [
      { href: "/docs", label: "Docs", icon: FileText },
      { href: "/sources", label: "Sources", icon: Database },
    ],
  },
  {
    label: "Configure",
    items: [
      { href: "/packs", label: "Operator Packs", icon: PackageOpen },
      { href: "/automations", label: "Automations", icon: CalendarClock },
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      <SlabBrandMark />
      <span>
        <span className="block font-heading text-base font-[675] leading-none tracking-[-0.025em]">
          Slab
        </span>
        <span className="mt-1 block font-mono text-[0.62rem] font-medium uppercase tracking-[0.02em] text-sidebar-foreground/55">
          Agent workspace
        </span>
      </span>
    </Link>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary navigation" className="space-y-5">
      {nav.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-3 font-mono text-[0.62rem] font-medium uppercase tracking-[0.02em] text-sidebar-foreground/55">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active =
                href === "/" ? pathname === href : pathname.startsWith(href);
              return (
                <Button
                  key={href}
                  asChild
                  variant="ghost"
                  className={cn(
                    "h-8 w-full justify-start gap-2.5 rounded-md px-3 text-[0.82rem] font-[575]",
                    active &&
                      "bg-sidebar-accent text-sidebar-accent-foreground before:h-4 before:w-0.5 before:rounded-full before:bg-sidebar-primary before:content-['']",
                    !active &&
                      "text-sidebar-foreground/68 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )}
                >
                  <Link href={href} onClick={onNavigate}>
                    <Icon className="size-3.5" />
                    <span>{label}</span>
                  </Link>
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function SystemState() {
  return (
    <Link
      href="/settings"
      className="mb-2 flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/55 px-3 py-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
    >
      <CircleCheck className="size-3.5 text-sidebar-primary" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">
          Local control plane
        </span>
        <span className="block truncate font-mono text-[0.64rem] text-sidebar-foreground/55">
          Codex · localhost
        </span>
      </span>
    </Link>
  );
}

function HowItWorksLink({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <Button
      asChild
      variant="ghost"
      className={cn(
        "w-full justify-start text-sidebar-foreground/68 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        pathname === "/how-it-works" &&
          "bg-sidebar-accent text-sidebar-foreground",
      )}
    >
      <Link href="/how-it-works" onClick={onNavigate}>
        <BookOpenText />
        How it works
      </Link>
    </Button>
  );
}

export function WorkspaceShell({
  children,
  authEnabled,
}: {
  children: React.ReactNode;
  authEnabled: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/login") return children;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground lg:flex lg:flex-col">
        <Brand />
        <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
          <Navigation />
        </div>
        <div className="shrink-0 px-1 py-1">
          <span className="mb-2 block h-px bg-sidebar-border" />
          <SystemState />
          <HowItWorksLink />
          {authEnabled ? (
            <Button
              variant="ghost"
              className="mt-1 w-full justify-start text-sidebar-foreground/68 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              onClick={logout}
            >
              <LogOut />
              Sign out
            </Button>
          ) : null}
        </div>
      </aside>
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-sidebar-border bg-sidebar px-4 text-sidebar-foreground lg:hidden">
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
          <SheetContent
            side="left"
            className="flex w-72 flex-col border-sidebar-border bg-sidebar p-4 text-sidebar-foreground"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Brand />
            <div className="mt-8 min-h-0 flex-1 overflow-y-auto">
              <Navigation onNavigate={() => setMobileOpen(false)} />
            </div>
            <div className="shrink-0 px-3 pb-2">
              <span className="mb-3 block h-px bg-sidebar-border" />
              <HowItWorksLink onNavigate={() => setMobileOpen(false)} />
              {authEnabled ? (
                <Button
                  variant="ghost"
                  className="mt-2 w-full justify-start text-sidebar-foreground/68 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  onClick={logout}
                >
                  <LogOut />
                  Sign out
                </Button>
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      </header>
      <main id="main-content" className="min-h-dvh min-w-0 lg:pl-56">
        <div className="mx-auto w-full max-w-[1720px] px-4 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-7">
          {children}
        </div>
      </main>
    </div>
  );
}
