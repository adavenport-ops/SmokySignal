"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { clientIpFrom, gateAttempt } from "@/lib/rate-limit";
import {
  setAdminCookie,
  clearAdminCookie,
  isAdminAuthed,
  verifyPasscode,
} from "@/lib/admin-auth";
import {
  getRegistry,
  saveRegistry,
  appendAudit,
  restoreBackup,
} from "@/lib/registry";
import { invalidateSnapshot } from "@/lib/snapshot";
import { setSpeedWarningEnabled } from "@/lib/flags";
import type { FleetEntry, FleetRole, RoleConfidence } from "@/lib/types";
import { MISSIONS, isMission, isMissionScope, isPoliceUnit } from "@/lib/mission";
import { FLEET } from "@/lib/seed";

const TAIL_RE = /^N\d{1,5}[A-Z]{0,2}$/;
const HEX_RE = /^[A-F0-9]{6}$/;
// Operator codes the seed uses. Anything else goes through "Other".
const KNOWN_OPERATORS: readonly string[] = Array.from(
  new Set([...FLEET.map((f) => f.operator), "State of WA"]),
);

function s(form: FormData, k: string): string {
  return String(form.get(k) ?? "").trim();
}

function bouncePath(error?: string, saved?: string): string {
  const params = new URLSearchParams();
  if (error) params.set("error", error);
  if (saved) params.set("saved", saved);
  const q = params.toString();
  return q ? `/admin?${q}` : "/admin";
}

function requireAdmin() {
  if (!isAdminAuthed()) redirect("/admin");
}

const VALID_NEXT_TARGETS: Record<string, string> = {
  tracks: "/admin/tracks",
  spots: "/admin/spots",
  qa: "/qa-dashboard",
};

export async function authenticateAction(formData: FormData) {
  const passcode = s(formData, "passcode");
  const nextRaw = s(formData, "next");
  // Brute-force guard: 5 failed attempts per IP per 15 min
  // (lib/rate-limit.ts). A correct passcode does not consume a slot. A
  // throttled attempt, or one made while the limiter is unavailable
  // (admin-login fails closed), gets the same generic "invalid" bounce
  // as a wrong passcode, and the passcode is not checked at all.
  const allowed = await gateAttempt(
    "admin-login",
    clientIpFrom(headers()),
    () => Boolean(passcode) && verifyPasscode(passcode),
  );
  if (!allowed) {
    const errPath = VALID_NEXT_TARGETS[nextRaw] ?? "/admin";
    const params = new URLSearchParams({ error: "invalid" });
    if (nextRaw && VALID_NEXT_TARGETS[nextRaw]) {
      params.set("next", nextRaw);
    }
    redirect(`${errPath}?${params.toString()}`);
  }
  setAdminCookie();
  const dest = VALID_NEXT_TARGETS[nextRaw] ?? "/admin";
  redirect(dest);
}

export async function logoutAction() {
  clearAdminCookie();
  redirect("/");
}

const VALID_ROLES: readonly FleetRole[] = MISSIONS;
const VALID_CONFIDENCE: readonly RoleConfidence[] = [
  "confirmed",
  "tentative",
  "unknown",
] as const;

function readEntryFromForm(formData: FormData): {
  entry: FleetEntry | null;
  errorCode: string | null;
} {
  const tail = s(formData, "tail").toUpperCase();
  const operatorRaw = s(formData, "operator");
  const operatorOther = s(formData, "operator_other");
  const operator = operatorRaw === "Other" ? operatorOther : operatorRaw;
  const model = s(formData, "model");
  const nicknameRaw = s(formData, "nickname");
  const nickname = nicknameRaw || null;
  const hexRaw = s(formData, "hex").toUpperCase();
  const hex = hexRaw || null;
  const base = s(formData, "base");
  const roleDescription = s(formData, "roleDescription") || "—";
  const roleRaw = s(formData, "role").toLowerCase();
  const policeUnitRaw = s(formData, "policeUnit").toLowerCase();
  const secondaryRaw = s(formData, "secondaryMission").toLowerCase();
  const scopeRaw = s(formData, "scope").toLowerCase();
  const confidenceRaw = s(formData, "roleConfidence").toLowerCase();
  const roleNoteRaw = s(formData, "roleNote");
  const roleNote = roleNoteRaw ? roleNoteRaw.slice(0, 120) : undefined;

  if (!TAIL_RE.test(tail)) return { entry: null, errorCode: "bad_tail" };
  if (hex && !HEX_RE.test(hex)) return { entry: null, errorCode: "bad_hex" };
  if (!operator) return { entry: null, errorCode: "bad_operator" };
  if (!KNOWN_OPERATORS.includes(operator) && operatorRaw !== "Other") {
    return { entry: null, errorCode: "bad_operator" };
  }
  if (!model) return { entry: null, errorCode: "bad_model" };
  if (!base) return { entry: null, errorCode: "bad_base" };
  if (!VALID_ROLES.includes(roleRaw as FleetRole)) {
    return { entry: null, errorCode: "bad_role" };
  }
  if (!VALID_CONFIDENCE.includes(confidenceRaw as RoleConfidence)) {
    return { entry: null, errorCode: "bad_confidence" };
  }
  if (policeUnitRaw && !isPoliceUnit(policeUnitRaw)) {
    return { entry: null, errorCode: "bad_police_unit" };
  }
  if (secondaryRaw && !isMission(secondaryRaw)) {
    return { entry: null, errorCode: "bad_role" };
  }
  if (scopeRaw && !isMissionScope(scopeRaw)) {
    return { entry: null, errorCode: "bad_scope" };
  }
  const sources = s(formData, "sources")
    .split(/\s+/)
    .filter((u) => /^https:\/\//.test(u))
    .slice(0, 12);

  return {
    entry: {
      tail,
      operator,
      model,
      nickname,
      roleDescription,
      base,
      hex,
      role: roleRaw as FleetRole,
      ...(roleRaw === "police" && isPoliceUnit(policeUnitRaw) ? { policeUnit: policeUnitRaw } : {}),
      ...(isMission(secondaryRaw) ? { secondaryMission: secondaryRaw } : {}),
      ...(isMissionScope(scopeRaw) && scopeRaw !== "wa" ? { scope: scopeRaw } : {}),
      roleConfidence: confidenceRaw as RoleConfidence,
      roleNote,
      sources,
    },
    errorCode: null,
  };
}

export async function addTailAction(formData: FormData) {
  requireAdmin();
  const { entry, errorCode } = readEntryFromForm(formData);
  if (!entry) redirect(bouncePath(errorCode!));

  const current = await getRegistry();
  if (current.find((t) => t.tail === entry.tail)) {
    redirect(bouncePath("duplicate"));
  }
  const next = [...current, entry];
  await saveRegistry(next);
  await appendAudit({
    ts: new Date().toISOString(),
    op: "create",
    tail: entry.tail,
    prev: null,
    next: entry,
  });
  await invalidateSnapshot();
  revalidatePath("/admin");
  revalidatePath("/about");
  redirect(bouncePath(undefined, entry.tail));
}

export async function updateTailAction(formData: FormData) {
  requireAdmin();
  const originalTail = s(formData, "original_tail").toUpperCase();
  const { entry, errorCode } = readEntryFromForm(formData);
  if (!entry) redirect(bouncePath(errorCode!));

  const current = await getRegistry();
  const idx = current.findIndex((t) => t.tail === originalTail);
  if (idx < 0) redirect(bouncePath("not_found"));
  // If tail changed, ensure no collision with other entries
  if (
    entry.tail !== originalTail &&
    current.some((t) => t.tail === entry.tail)
  ) {
    redirect(bouncePath("duplicate"));
  }

  const prev = current[idx]!;
  // The edit form may leave sources blank; keep the stored list then.
  if (entry.sources.length === 0 && prev.sources.length > 0) {
    entry.sources = [...prev.sources];
  }
  const next = current.slice();
  next[idx] = entry;
  await saveRegistry(next);
  await appendAudit({
    ts: new Date().toISOString(),
    op: "update",
    tail: entry.tail,
    prev,
    next: entry,
  });
  await invalidateSnapshot();
  revalidatePath("/admin");
  revalidatePath("/about");
  redirect(bouncePath(undefined, entry.tail));
}

export async function deleteTailAction(formData: FormData) {
  requireAdmin();
  const tail = s(formData, "tail").toUpperCase();
  const current = await getRegistry();
  const prev = current.find((t) => t.tail === tail);
  if (!prev) redirect(bouncePath("not_found"));
  const next = current.filter((t) => t.tail !== tail);
  await saveRegistry(next);
  await appendAudit({
    ts: new Date().toISOString(),
    op: "delete",
    tail,
    prev: prev ?? null,
    next: null,
  });
  await invalidateSnapshot();
  revalidatePath("/admin");
  revalidatePath("/about");
  redirect(bouncePath(undefined, tail));
}

export async function setSpeedWarningFlagAction(formData: FormData) {
  requireAdmin();
  // Checkbox inputs only post when checked, so absence = false.
  const enabled = formData.get("enabled") === "on";
  await setSpeedWarningEnabled(enabled);
  revalidatePath("/admin");
  // No path revalidation needed for the flag itself — it's read live in
  // the (tabs) layout server fetch on each request.
  redirect(bouncePath(undefined, enabled ? "warn_on" : "warn_off"));
}

export async function restoreBackupAction(formData: FormData) {
  requireAdmin();
  const key = s(formData, "key");
  if (!key) redirect(bouncePath("bad_backup"));
  const restored = await restoreBackup(key);
  await appendAudit({
    ts: new Date().toISOString(),
    op: "restore",
    tail: `(${restored.length} tails)`,
    prev: null,
    next: null,
  });
  await invalidateSnapshot();
  revalidatePath("/admin");
  revalidatePath("/about");
  redirect(bouncePath(undefined, "restored"));
}
