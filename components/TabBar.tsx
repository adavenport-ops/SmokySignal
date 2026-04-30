"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SS_TOKENS } from "@/lib/tokens";
import type { ReactNode } from "react";

const TABS: { id: string; label: string; href: string; icon: ReactNode }[] = [
  { id: "now", label: "Now", href: "/", icon: <ActivityIcon /> },
  { id: "radar", label: "Radar", href: "/radar", icon: <RadarIcon /> },
  { id: "dash", label: "Dash", href: "/dash", icon: <GaugeIcon /> },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        justifyContent: "space-around",
        padding: "10px 8px 28px",
        background:
          "linear-gradient(to top, rgba(11,13,16,.96) 70%, rgba(11,13,16,0))",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderTop: `.5px solid ${SS_TOKENS.hairline}`,
        zIndex: 50,
      }}
    >
      {TABS.map((t) => {
        const active = isActive(pathname, t.href);
        return (
          <Link
            key={t.id}
            href={t.href}
            prefetch
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              padding: "6px 10px",
              color: active ? SS_TOKENS.fg0 : SS_TOKENS.fg2,
              textDecoration: "none",
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1, display: "flex" }}>
              {t.icon}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: ".02em",
              }}
            >
              {t.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

// Lucide-style "activity" icon — heartbeat line.
function ActivityIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

// Lucide-style "gauge" icon — half-circle dial with a needle.
function GaugeIcon() {
  return (
    <svg
      width="18"
      height="18"
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
      width="18"
      height="18"
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
