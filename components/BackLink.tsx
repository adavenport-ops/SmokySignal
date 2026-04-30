"use client";

import { useRouter } from "next/navigation";
import { SS_TOKENS } from "@/lib/tokens";

export function BackLink() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="ss-mono"
      style={{
        background: "transparent",
        border: 0,
        padding: "4px 0",
        color: SS_TOKENS.fg1,
        fontSize: 13,
        cursor: "pointer",
        alignSelf: "flex-start",
      }}
    >
      ‹ Back
    </button>
  );
}
