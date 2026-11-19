// Network side of Relay: the resolve-time SSRF guard and the one HTTP
// POST every relay delivery goes through. Server-only.
//
// SSRF posture, in layers:
//   1. lib/relay/validate.ts: https only, default port, no userinfo, no
//      IP literals, no internal-looking hostnames.
//   2. assertPublicHost(): at save time, every DNS answer for the host
//      must be a public address. Gives the admin an immediate 400.
//   3. postJson(): the connection itself resolves through guardedLookup,
//      which refuses private answers. That closes the DNS-rebinding gap
//      between step 2 and the send: the socket only ever connects to an
//      address the guard just approved.
//   4. Redirects are never followed (node:https does not follow them).

import dns from "node:dns";
import https from "node:https";
import { isIP } from "node:net";
import type { LookupAddress } from "node:dns";
import { isPrivateAddress } from "./validate";

export class PrivateAddressError extends Error {
  code = "ERELAYPRIVATE";
  constructor(host: string) {
    super(`${host} resolves to a non-public address`);
    this.name = "PrivateAddressError";
  }
}

export type LookupAllFn = (hostname: string) => Promise<LookupAddress[]>;

export const defaultLookupAll: LookupAllFn = (hostname) =>
  dns.promises.lookup(hostname, { all: true, verbatim: true });

/**
 * Throws unless `hostname` resolves and every answer is public. One
 * private answer is enough to refuse: a round-robin set that mixes in
 * 127.0.0.1 is still a pointer at our own network.
 */
export async function assertPublicHost(
  hostname: string,
  lookupAll: LookupAllFn = defaultLookupAll,
): Promise<LookupAddress[]> {
  const list = await lookupAll(hostname);
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${hostname} did not resolve`);
  }
  if (list.some((a) => isPrivateAddress(a.address))) {
    throw new PrivateAddressError(hostname);
  }
  return list;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * Drop-in `lookup` for net/tls connect options. Resolves every address
 * and refuses the connection when any of them is private.
 */
export function guardedLookup(
  hostname: string,
  options: { all?: boolean } | number | undefined,
  callback: LookupCallback,
): void {
  const wantAll = typeof options === "object" && options !== null && options.all === true;
  assertPublicHost(hostname)
    .then((list) => {
      if (wantAll) callback(null, list);
      else callback(null, list[0]!.address, list[0]!.family);
    })
    .catch((err: NodeJS.ErrnoException) => callback(err, wantAll ? [] : "", undefined));
}

export type HttpResult = {
  /** HTTP status, or 0 when the request never got a response. */
  status: number;
  headers: Record<string, string | undefined>;
  /** First MAX_RESPONSE_BYTES of the body, utf-8. */
  body: string;
  error?: string;
};

export type PostJsonFn = (
  url: string,
  body: string,
  headers: Record<string, string>,
  opts: { timeoutMs: number },
) => Promise<HttpResult>;

const MAX_RESPONSE_BYTES = 8 * 1024;
const USER_AGENT = "SmokySignal-Relay/1 (+https://smokysignal.app/relay)";

/**
 * POST a JSON body with a hard deadline. Never throws; network errors and
 * timeouts come back as status 0. Only https URLs are accepted.
 */
export const postJson: PostJsonFn = (url, body, headers, { timeoutMs }) => {
  if (process.env.SS_RELAY_DRY_RUN === "1") {
    // Local and preview runs: log the delivery instead of sending it.
    console.info(`[relay] dry run, would POST ${body.length}B to ${new URL(url).hostname}`);
    return Promise.resolve({ status: 204, headers: {}, body: "" });
  }
  return new Promise<HttpResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (r: HttpResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      done({ status: 0, headers: {}, body: "", error: "invalid_url" });
      return;
    }
    if (parsed.protocol !== "https:") {
      done({ status: 0, headers: {}, body: "", error: "https_only" });
      return;
    }
    // net.connect skips `lookup` for IP literals, so check those here.
    // Stored URLs never hold one (validate.ts refuses them); this is the
    // backstop if one ever slips through.
    const bareHost = parsed.hostname.replace(/^\[|\]$/g, "");
    if (isIP(bareHost) !== 0 && isPrivateAddress(bareHost)) {
      done({ status: 0, headers: {}, body: "", error: "ERELAYPRIVATE" });
      return;
    }
    const req = https.request(
      parsed,
      {
        method: "POST",
        agent: false,
        lookup: guardedLookup as unknown as https.RequestOptions["lookup"],
        timeout: timeoutMs,
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body)),
          "user-agent": USER_AGENT,
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          if (size < MAX_RESPONSE_BYTES) {
            chunks.push(c);
            size += c.length;
          }
        });
        const finish = () =>
          done({
            status: res.statusCode ?? 0,
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([k, v]) => [
                k,
                Array.isArray(v) ? v.join(", ") : v,
              ]),
            ),
            body: Buffer.concat(chunks).subarray(0, MAX_RESPONSE_BYTES).toString("utf8"),
          });
        res.on("end", finish);
        res.on("error", finish);
      },
    );
    timer = setTimeout(() => {
      req.destroy(new Error("relay request deadline"));
      done({ status: 0, headers: {}, body: "", error: "timeout" });
    }, timeoutMs);
    req.on("timeout", () => req.destroy(new Error("relay socket timeout")));
    req.on("error", (e: NodeJS.ErrnoException) =>
      done({ status: 0, headers: {}, body: "", error: e.code ?? e.message }),
    );
    req.end(body);
  });
};
