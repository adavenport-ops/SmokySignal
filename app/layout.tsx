import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { BASE_URL } from "@/lib/config";
import { IOSInstallPrompt } from "@/components/IOSInstallPrompt";
import { TooltipProvider } from "@/components/Tooltip";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

const TITLE = "SmokySignal — is the bird up?";
const DESCRIPTION =
  "Real-time WSP aircraft tracker for Puget Sound motorcyclists. Know when Smoky is watching.";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "SmokySignal" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0d10",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="ss-app bg-ss-bg0 text-ss-fg0">
        <TooltipProvider>
          {children}
          <IOSInstallPrompt />
        </TooltipProvider>
        <Analytics />
      </body>
    </html>
  );
}
