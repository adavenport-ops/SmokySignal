"use client";

// Tap-to-expand for blog screenshots and clips. Desktop captures shrink to
// about 220px tall on a phone and can't be read there; tapping one opens
// it full screen in a modal <dialog>.
//
//   - Esc, the 44px close button, or a tap on the dark backdrop closes it.
//     Focus goes back to whatever opened it.
//   - "Actual size" shows the capture at its own pixel size, so a phone
//     can pan across a desktop screenshot instead of squinting at it.
//   - No open or close animation, so nothing to switch off under
//     prefers-reduced-motion. A clip in the lightbox autoplays (muted,
//     looped) only when the reader has not asked for less motion;
//     otherwise its poster shows with native controls.
//
// BlogZoomImage wraps a server-rendered <picture> in a button; BlogVideo
// opens the same lightbox for clips.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SS_TOKENS } from "@/lib/tokens";

export type LightboxMedia =
  | { kind: "image"; webp: string; png: string; alt: string; width: number; height: number; caption: string }
  | {
      kind: "clip";
      mp4: string;
      webm: string;
      poster: string;
      alt: string;
      width: number;
      height: number;
      caption: string;
    };

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return reduced;
}

const ICON_BTN: React.CSSProperties = {
  minWidth: 44,
  height: 44,
  padding: "0 12px",
  borderRadius: 999,
  border: `.5px solid ${SS_TOKENS.hairline2}`,
  background: SS_TOKENS.bg1,
  color: SS_TOKENS.fg0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  cursor: "pointer",
  fontFamily: "var(--font-mono), ui-monospace, Menlo, monospace",
  fontSize: 12,
  letterSpacing: ".04em",
  touchAction: "manipulation",
  WebkitTapHighlightColor: "transparent",
};

export function MediaLightbox({
  media,
  open,
  onClose,
}: {
  media: LightboxMedia;
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [actual, setActual] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setActual(false);
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
      // The page under a modal should not scroll along with a pan.
      document.documentElement.style.overflow = "hidden";
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  // Never leave the page locked if the post unmounts with it open.
  useEffect(() => () => {
    document.documentElement.style.overflow = "";
  }, []);

  // Esc fires "cancel" then "close"; route both through onClose.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onDialogClose = () => {
      document.documentElement.style.overflow = "";
      onClose();
    };
    d.addEventListener("close", onDialogClose);
    return () => d.removeEventListener("close", onDialogClose);
  }, [onClose]);

  const fit: React.CSSProperties = actual
    ? { width: media.width, maxWidth: "none", height: "auto", maxHeight: "none" }
    : { width: "auto", height: "auto", maxWidth: "100%", maxHeight: "100%" };

  return (
    <dialog
      ref={ref}
      className="ss-lightbox"
      aria-label={media.alt}
      data-testid="blog-lightbox"
      data-actual={actual ? "1" : "0"}
      onClick={(e) => {
        // A tap on the backdrop (the dialog box itself, outside the media
        // and the bar) closes it.
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.lightboxStage === "1") {
          ref.current?.close();
        }
      }}
    >
      {open ? (
        <div className="ss-lightbox-inner">
          <div className="ss-lightbox-bar">
            <span className="ss-lightbox-caption">{media.caption || media.alt}</span>
            <button
              type="button"
              style={ICON_BTN}
              aria-pressed={actual}
              data-testid="blog-lightbox-size"
              onClick={() => setActual((a) => !a)}
            >
              {actual ? "Fit" : "Actual size"}
            </button>
            <button
              type="button"
              style={{ ...ICON_BTN, padding: 0, width: 44 }}
              aria-label="Close"
              data-testid="blog-lightbox-close"
              autoFocus
              onClick={() => ref.current?.close()}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div
            className="ss-lightbox-stage"
            data-lightbox-stage="1"
            style={actual ? { alignItems: "flex-start", justifyContent: "flex-start" } : undefined}
          >
            {media.kind === "image" ? (
              <picture>
                <source srcSet={media.webp} type="image/webp" />
                {/* eslint-disable-next-line @next/next/no-img-element -- same static file as the inline figure */}
                <img
                  src={media.png}
                  alt={media.alt}
                  width={media.width}
                  height={media.height}
                  style={{ display: "block", ...fit }}
                />
              </picture>
            ) : (
              <video
                muted
                loop
                playsInline
                controls
                autoPlay={!reduced}
                preload="metadata"
                poster={media.poster}
                width={media.width}
                height={media.height}
                aria-label={media.alt}
                data-testid="blog-lightbox-video"
                style={{ display: "block", background: SS_TOKENS.bg1, ...fit }}
              >
                <source src={media.webm} type="video/webm" />
                <source src={media.mp4} type="video/mp4" />
              </video>
            )}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

/** A server-rendered picture that opens full screen on tap. */
export function BlogZoomImage({ media, children }: { media: LightboxMedia; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        className="ss-blog-zoom"
        aria-label={`Expand image: ${media.alt}`}
        aria-haspopup="dialog"
        data-testid="blog-zoom"
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      <MediaLightbox media={media} open={open} onClose={close} />
    </>
  );
}
