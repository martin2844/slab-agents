"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Bot,
  CalendarClock,
  FileText,
  BookOpenText,
  LayoutDashboard,
  Menu,
  PanelsTopLeft,
  PackageOpen,
  Plug,
  Settings,
  Workflow,
  CircleCheck,
  LogOut,
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
    label: "Configure",
    items: [
      { href: "/packs", label: "Operator Packs", icon: PackageOpen },
      { href: "/automations", label: "Automations", icon: CalendarClock },
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/docs", label: "Docs", icon: FileText },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2 py-1.5">
      <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
        <Workflow className="size-4" />
      </span>
      <span>
        <span className="block font-heading text-base font-semibold leading-none tracking-tight">
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
    <nav aria-label="Primary navigation" className="space-y-5">
      {nav.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-3 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
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
                    "h-8 w-full justify-start gap-2.5 rounded-md px-3 text-[0.82rem] font-medium",
                    active &&
                      "bg-sidebar-accent text-sidebar-accent-foreground before:h-4 before:w-0.5 before:rounded-full before:bg-primary before:content-['']",
                    !active && "text-muted-foreground hover:text-foreground",
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
      className="mb-2 flex items-center gap-2 rounded-md border bg-background/55 px-3 py-2 transition-colors hover:bg-background"
    >
      <CircleCheck className="size-3.5 text-emerald-700" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">
          Local control plane
        </span>
        <span className="block truncate text-[0.68rem] text-muted-foreground">
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 border-r border-sidebar-border bg-sidebar p-3 lg:flex lg:flex-col">
        <Brand />
        <div className="mt-6">
          <Navigation />
        </div>
        <div className="mt-auto px-1 py-1">
          <span className="mb-2 block h-px bg-border" />
          <SystemState />
          <HowItWorksLink />
          {authEnabled ? (
            <Button
              variant="ghost"
              className="mt-1 w-full justify-start"
              onClick={logout}
            >
              <LogOut />
              Sign out
            </Button>
          ) : null}
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
              {authEnabled ? (
                <Button
                  variant="ghost"
                  className="mt-2 w-full justify-start"
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
