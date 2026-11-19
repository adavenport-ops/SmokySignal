// Minimal Telegram Bot API client. The token sits in the request path,
// so nothing here ever logs a URL or echoes a request.

export const TELEGRAM_API = "https://api.telegram.org";
export const TG_CALL_TIMEOUT_MS = 8_000;

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type TgResult = {
  ok: boolean;
  /** HTTP status, or 0 for a network error / timeout. */
  status: number;
  error_code?: number;
  description?: string;
  /** Seconds to wait, from parameters.retry_after on a 429. */
  retry_after?: number;
  result?: unknown;
};

export async function tgCall(
  token: string,
  method: string,
  body: Record<string, unknown>,
  fetchFn: FetchFn = fetch,
  timeoutMs = TG_CALL_TIMEOUT_MS,
): Promise<TgResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON error page */
    }
    const params = (json.parameters ?? {}) as { retry_after?: unknown };
    return {
      ok: res.ok && json.ok === true,
      status: res.status,
      error_code: typeof json.error_code === "number" ? json.error_code : undefined,
      description: typeof json.description === "string" ? json.description : undefined,
      retry_after: typeof params.retry_after === "number" ? params.retry_after : undefined,
      result: json.result,
    };
  } catch {
    return { ok: false, status: 0, description: "network error or timeout" };
  } finally {
    clearTimeout(timer);
  }
}

export type TgSendOutcome =
  | { kind: "sent" }
  | { kind: "gone" }
  | { kind: "rate_limited"; retryAfterS: number }
  | { kind: "failed"; status: number };

/** Classify a sendMessage result. */
export function classifySend(r: TgResult): TgSendOutcome {
  if (r.ok) return { kind: "sent" };
  const code = r.error_code ?? r.status;
  if (code === 429) return { kind: "rate_limited", retryAfterS: Math.max(1, r.retry_after ?? 1) };
  // 403: the rider blocked the bot or left. 400 "chat not found" /
  // "user is deactivated": the chat is gone. Both prune.
  if (code === 403) return { kind: "gone" };
  if (code === 400 && /chat not found|user is deactivated|chat_id is empty/i.test(r.description ?? "")) {
    return { kind: "gone" };
  }
  return { kind: "failed", status: code };
}

export function sendMessageBody(chatId: number, text: string): Record<string, unknown> {
  return {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
  };
}
