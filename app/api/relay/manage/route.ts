// /api/relay/manage: read, edit, or delete one relay. Authenticated by
// `Authorization: Bearer {id}.{token}` from the manage URL's fragment.
// GET returns the masked view; PATCH takes a partial config; DELETE
// removes the relay and its counters.

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/input-validation";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  deleteRelayService,
  getRelayService,
  updateRelayService,
} from "@/lib/relay/service";
import { getRelayKv } from "@/lib/relay/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const limited = await enforceRateLimit(req, "relay-manage");
  if (limited) return limited;
  const r = await getRelayService(req.headers.get("authorization"), { kv: await getRelayKv() });
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}

export async function PATCH(req: Request) {
  const limited = await enforceRateLimit(req, "relay-manage");
  if (limited) return limited;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: NO_STORE });
  }
  const r = await updateRelayService(req.headers.get("authorization"), parsed.body, {
    kv: await getRelayKv(),
  });
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}

export async function DELETE(req: Request) {
  const limited = await enforceRateLimit(req, "relay-manage");
  if (limited) return limited;
  const r = await deleteRelayService(req.headers.get("authorization"), { kv: await getRelayKv() });
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}
