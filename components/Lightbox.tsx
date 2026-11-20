"use client";
// Full-screen media viewer. Click outside the image or video (or press Esc) to close;
// arrows or ← / → step through a post's media when it has more than one.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Media } from "@/lib/types";
import { mediaUrl, posterUrl } from "@/lib/media";

export default function Lightbox({ media, index, onClose }: { media: Media[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  const close = useRef(onClose);
  close.current = onClose;
  const n = media.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      } else if (n > 1 && e.key === "ArrowRight") setI((k) => (k + 1) % n);
      else if (n > 1 && e.key === "ArrowLeft") setI((k) => (k - 1 + n) % n);
    };
    window.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
    };
  }, [n]);

  const m = media[i];
  if (!m) return null;
  // React events bubble through portals to the component tree, so stop them here:
  // a click in the viewer must not also open a card or start a comment underneath.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const step = (d: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setI((k) => (k + d + n) % n);
  };
  const round = "flex items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onMouseUp={stop}
      onKeyDown={stop}
    >
      {m.type === "video" ? (
        <video
          key={i}
          src={mediaUrl(m)}
          poster={posterUrl(m)}
          controls
          autoPlay
          playsInline
          onClick={stop}
          className="max-h-[calc(100vh-6rem)] max-w-[calc(100vw-2rem)] cursor-default rounded-lg bg-black sm:max-w-[calc(100vw-9rem)]"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={mediaUrl(m)}
          alt={m.alt ?? ""}
          onClick={stop}
          className="max-h-[calc(100vh-6rem)] max-w-[calc(100vw-2rem)] cursor-default rounded-lg object-contain sm:max-w-[calc(100vw-9rem)]"
        />
      )}

      <button type="button" aria-label="Close" title="Close (Esc)" onClick={(e) => (e.stopPropagation(), onClose())} className={`${round} absolute right-4 top-4 h-9 w-9 text-xl leading-none`}>
        ×
      </button>
      {n > 1 && (
        <>
          <button type="button" aria-label="Previous" onClick={step(-1)} className={`${round} absolute left-3 top-1/2 h-10 w-10 -translate-y-1/2 text-2xl leading-none sm:left-6`}>
            ‹
          </button>
          <button type="button" aria-label="Next" onClick={step(1)} className={`${round} absolute right-3 top-1/2 h-10 w-10 -translate-y-1/2 text-2xl leading-none sm:right-6`}>
            ›
          </button>
        </>
      )}
      {(n > 1 || m.alt) && (
        <div onClick={stop} className="absolute bottom-4 left-1/2 max-w-[90vw] -translate-x-1/2 cursor-default truncate rounded-full bg-black/60 px-3 py-1 text-xs text-white/70">
          {n > 1 && <span className="font-mono">{i + 1} / {n}</span>}
          {n > 1 && m.alt && <span className="mx-2 text-white/30">·</span>}
          {m.alt}
        </div>
      )}
    </div>,
    document.body,
  );
}
