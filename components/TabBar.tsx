"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScreenAwake } from "./ScreenAwake";
import type { ReactNode } from "react";

const TABS: { id: string; label: string; href: string; icon: ReactNode }[] = [
  { id: "home", label: "Home", href: "/", icon: <HomeIcon /> },
  { id: "radar", label: "Radar", href: "/radar", icon: <RadarIcon /> },
  { id: "dash", label: "Dash", href: "/dash", icon: <DashIcon /> },
  { id: "activity", label: "Activity", href: "/activity", icon: <ActivityIcon /> },
  { id: "about", label: "About", href: "/about", icon: <InfoIcon /> },
];

export function TabBar() {
  const pathname = usePathname();
  // The radar map is position:fixed edge to edge and lays its controls
  // out against the bottom bar, so /radar keeps the bottom bar on
  // desktop too. Every other route gets the left rail at >= 1024px.
  // Layout lives in app/globals.css (.ss-tabbar, .ss-tabbar[data-rail]).
  const rail = pathname !== "/radar";
  return (
    <nav
      aria-label="Main"
      className="ss-tabbar"
      data-rail={rail ? "true" : "false"}
    >
      {TABS.map((t) => {
        const active = isActive(pathname, t.href);
        return (
          <Link
            key={t.id}
            href={t.href}
            prefetch
            aria-current={active ? "page" : undefined}
            className="ss-tabbar-item"
          >
            <span style={{ lineHeight: 1, display: "flex" }}>{t.icon}</span>
            <span className="ss-tabbar-label">{t.label}</span>
          </Link>
        );
      })}
      <span className="ss-tabbar-spacer" aria-hidden />
      <ScreenAwake />
    </nav>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

// Lucide-style "home" icon — house outline.
function HomeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  );
}

// Lucide-style "activity" icon — stack of horizontal lines (changelog feel).
function ActivityIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 6H8" />
      <path d="M21 12H8" />
      <path d="M21 18H8" />
      <circle cx="4" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Lucide-style "info" icon — circle with i.
function InfoIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

// Lucide-style "gauge" icon — at-a-glance dashboard summary.
function DashIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </svg>
  );
}

// Lucide-style "radar" icon — concentric arcs + sweep.
function RadarIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" />
      <path d="M4 6h.01" />
      <path d="M2.29 9.62A10 10 0 1 0 21.31 8.35" />
      <path d="M16.24 7.76A6 6 0 1 0 17.91 12" />
      <path d="M12 18h.01" />
      <path d="M17.99 11.66A6 6 0 0 1 15.77 16.67" />
      <circle cx="12" cy="12" r="2" />
      <path d="m13.41 10.59 5.66-5.66" />
    </svg>
  );
}
