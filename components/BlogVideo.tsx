"use client";

// A short, silent clip in a blog post. The only client code a post ships:
// the rest of components/BlogMarkdown.tsx renders on the server.
//
//   - Autoplays muted and looped, but only once it is on screen, and
//     pauses when it scrolls away (IntersectionObserver).
//   - Under prefers-reduced-motion it never autoplays: the poster shows
//     with a play button.
//   - A 44px play / pause button is always there, for keyboard and touch.
//     It sits in the caption row, not over the picture: the clips show
//     the app's own buttons, and ours must not look like one of them. A
//     rider who pauses it keeps it paused; scrolling back does not
//     restart it.
//
// Renders the framed video and the figure's <figcaption>; the server
// component wraps both in the <figure>.
//
// The server HTML has no autoplay attribute, so a reduced-motion reader
// never sees a frame move before this hydrates.

import { useEffect, useRef, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";

type Props = {
  mp4: string;
  webm: string;
  poster: string;
  width: number;
  height: number;
  label: string;
  caption: string;
};

export function BlogVideo({ mp4, webm, poster, width, height, label, caption }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState(true);
  const [playing, setPlaying] = useState(false);
  const userPaused = useRef(false);
  const inView = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (reduced) {
      v.pause();
      return;
    }
    const tryPlay = () => {
      if (inView.current && !userPaused.current) v.play().catch(() => setPlaying(false));
    };
    if (typeof IntersectionObserver === "undefined") {
      inView.current = true;
      tryPlay();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          inView.current = e.isIntersecting;
          if (e.isIntersecting) tryPlay();
          else v.pause();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [reduced]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      userPaused.current = false;
      v.play().catch(() => setPlaying(false));
    } else {
      userPaused.current = true;
      v.pause();
    }
  };

  return (
    <>
      <div
        style={{
          lineHeight: 0,
          borderRadius: 12,
          overflow: "hidden",
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          background: SS_TOKENS.bg1,
        }}
      >
        <video
          ref={ref}
          muted
          loop
          playsInline
          preload="metadata"
          poster={poster}
          width={width}
          height={height}
          autoPlay={!reduced}
          aria-label={label}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          data-testid="blog-video"
          style={{ display: "block", width: "100%", height: "auto", background: SS_TOKENS.bg1 }}
        >
          <source src={webm} type="video/webm" />
          <source src={mp4} type="video/mp4" />
        </video>
      </div>
      <figcaption style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 8 }}>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause clip" : "Play clip"}
          data-testid="blog-video-toggle"
          className="ss-blog-video-btn"
          style={{
            flex: "0 0 auto",
            width: 44,
            height: 44,
            borderRadius: 999,
            border: `.5px solid ${SS_TOKENS.hairline2}`,
            background: SS_TOKENS.bg1,
            color: SS_TOKENS.fg0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            touchAction: "manipulation",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
              <rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M4 2.2v11.6a.6.6 0 0 0 .9.5l9.4-5.8a.6.6 0 0 0 0-1L4.9 1.7a.6.6 0 0 0-.9.5Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <span style={{ fontSize: 13, lineHeight: 1.5, color: SS_TOKENS.fg1, paddingTop: 2 }}>{caption}</span>
      </figcaption>
    </>
  );
}
