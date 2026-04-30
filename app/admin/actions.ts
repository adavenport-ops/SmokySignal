"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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
import type { FleetEntry } from "@/lib/types";

const TAIL_RE = /^N\d{1,5}[A-Z]{0,2}$/;
const HEX_RE = /^[A-F0-9]{6}$/;
const KNOWN_OPERATORS = [
  "WSP",
  "KCSO",
  "Pierce SO",
  "Snohomish SO",
  "Spokane SO",
  "State of WA",
] as const;

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
};

export async function authenticateAction(formData: FormData) {
  const passcode = s(formData, "passcode");
  const nextRaw = s(formData, "next");
  if (!passcode || !verifyPasscode(passcode)) {
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
  const role = s(formData, "role") || "—";

  if (!TAIL_RE.test(tail)) return { entry: null, errorCode: "bad_tail" };
  if (hex && !HEX_RE.test(hex)) return { entry: null, errorCode: "bad_hex" };
  if (!operator) return { entry: null, errorCode: "bad_operator" };
  if (!KNOWN_OPERATORS.includes(operator as (typeof KNOWN_OPERATORS)[number]) && operatorRaw !== "Other") {
    return { entry: null, errorCode: "bad_operator" };
  }
  if (!model) return { entry: null, errorCode: "bad_model" };
  if (!base) return { entry: null, errorCode: "bad_base" };

  return {
    entry: { tail, operator, model, nickname, role, base, hex },
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
