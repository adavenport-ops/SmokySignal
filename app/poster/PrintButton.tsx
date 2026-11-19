"use client";

// Opens the browser print dialog. The only client code on /poster.

export function PrintButton() {
  return (
    <button type="button" className="poster-btn" data-testid="poster-print" onClick={() => window.print()}>
      Print this page
    </button>
  );
}
