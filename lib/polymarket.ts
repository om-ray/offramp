const DATA = "https://data-api.polymarket.com";
const GAMMA = "https://gamma-api.polymarket.com";
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const PAGE = "1000";
const LOOKUP_INPUT = /^@?[^\p{Cc}\p{Cf}]{1,64}$/u;

export function isLookupInput(input: string): boolean {
  return LOOKUP_INPUT.test(input.trim());
}

type Page<T> = { data: T[]; pagination?: { has_more?: boolean; next_cursor?: string | null } };

export type FailureKind = "not-found" | "busy" | "upstream";

export class PolymarketError extends Error {
  readonly kind: FailureKind;
  constructor(message: string, kind: FailureKind) {
    super(message);
    this.kind = kind;
  }
}

async function getJson<T>(base: string, path: string, params: Record<string, string>, deadline: number): Promise<T> {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const left = deadline - Date.now();
    if (left <= 0) throw new PolymarketError("Ran out of time reading Polymarket.", "upstream");
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(Math.min(30_000, left)) });
    if (res.status === 429) {
      const wait = Math.min(Number(res.headers.get("retry-after")) || 2 ** attempt, 10) * 1000;
      if (attempt >= 3 || Date.now() + wait >= deadline) throw new PolymarketError("Polymarket is busy right now.", "busy");
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new PolymarketError(`Polymarket returned ${res.status} for ${url.pathname}`, "upstream");
    return res.json() as Promise<T>;
  }
}

async function walk<T>(path: string, params: Record<string, string>, deadline: number): Promise<{ rows: T[]; complete: boolean }> {
  const rows: T[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  while (Date.now() < deadline) {
    let body: Page<T>;
    try {
      body = await getJson<Page<T>>(DATA, path, cursor ? { ...params, cursor } : { ...params, limit: PAGE }, deadline);
    } catch (err) {
      if (rows.length && !(err instanceof PolymarketError && err.kind === "busy")) return { rows, complete: false };
      throw err;
    }
    rows.push(...(body.data ?? []));
    cursor = body.pagination?.next_cursor ?? undefined;
    if (!cursor) return { rows, complete: true };
    if (seen.has(cursor)) return { rows, complete: false };
    seen.add(cursor);
  }
  return { rows, complete: false };
}

export async function resolveWallet(input: string): Promise<string> {
  const query = input.trim().replace(/^@/, "");
  if (ADDRESS.test(query)) return query.toLowerCase();
  type Profile = { name?: string; pseudonym?: string; proxyWallet?: string };
  const result = await getJson<{ profiles?: Profile[] }>(GAMMA, "/public-search", { q: query, search_profiles: "true", limit_per_type: "20" }, Date.now() + 30_000);
  const wallets = new Set(
    (result.profiles ?? [])
      .filter((p): p is Profile => !!p && typeof p === "object")
      .filter((p) => [p.name, p.pseudonym].some((n) => n?.toLowerCase() === query.toLowerCase()))
      .map((p) => p.proxyWallet?.toLowerCase())
      .filter((w): w is string => !!w && ADDRESS.test(w)),
  );
  if (wallets.size !== 1) throw new PolymarketError("We couldn't find exactly one polymarket.com profile with that name.", "not-found");
  return [...wallets][0];
}

export type PolymarketMoney = {
  deposited: number;
  withdrawn: number;
  cashFlowComplete: boolean;
  officialAllTimePnl: number | null;
  openPositionValue: number | null;
};

export async function polymarketMoney(wallet: string, deadline: number): Promise<PolymarketMoney> {
  const [flows, board, value] = await Promise.all([
    walk<{ type: string; usdc_size: number }>(
      "/v2/activity",
      { user: wallet, type: "DEPOSIT,WITHDRAWAL", exclude_deposits_withdrawals: "false", start: "1" },
      deadline,
    ),
    getJson<{ data: { pnl: number } | null }>(DATA, "/v2/leaderboard", { user: wallet, time_period: "all" }, deadline).catch(() => null),
    getJson<{ data: { value: number } | null }>(DATA, "/v2/value", { user: wallet }, deadline).catch(() => null),
  ]);
  const sum = (type: string) => flows.rows.filter((r) => r.type === type).reduce((n, r) => n + (r.usdc_size || 0), 0);
  const pnl = board?.data?.pnl;
  const open = value?.data?.value;
  return {
    deposited: sum("DEPOSIT"),
    withdrawn: sum("WITHDRAWAL"),
    cashFlowComplete: flows.complete,
    officialAllTimePnl: Number.isFinite(pnl) ? (pnl as number) : null,
    openPositionValue: Number.isFinite(open) ? (open as number) : null,
  };
}

type Position = { status: string; realized_pnl: number; total_pnl: number; first_entry_at: number; last_event_at: number };
type Combo = { status: string; gross_entry_cost_usdc: number; realized_payout_usdc: number; first_entry_at_micros: number; updated_at_micros: number };

export type FinishedBet = { pnl: number; startedAt: number; endedAt: number };

export function finishedBets(open: Position[], closed: Position[], combos: Combo[]): FinishedBet[] {
  return [
    ...open.filter((p) => p.status === "REDEEMABLE").map((p) => ({ pnl: p.total_pnl, startedAt: p.first_entry_at, endedAt: p.last_event_at })),
    ...closed.map((p) => ({ pnl: p.realized_pnl, startedAt: p.first_entry_at, endedAt: p.last_event_at })),
    ...combos
      .filter((c) => c.status.startsWith("RESOLVED"))
      .map((c) => ({
        pnl: c.realized_payout_usdc - c.gross_entry_cost_usdc,
        startedAt: Math.floor(c.first_entry_at_micros / 1e6),
        endedAt: Math.floor(c.updated_at_micros / 1e6),
      })),
  ].filter((b) => Number.isFinite(b.pnl));
}

export function summarizeBets(bets: FinishedBet[]) {
  const pnls = bets.map((b) => b.pnl);
  const starts = bets.map((b) => b.startedAt).filter((t) => t > 0);
  const ends = bets.map((b) => b.endedAt).filter((t) => t > 0);
  return {
    winning: pnls.filter((p) => p >= 0.01).length,
    losing: pnls.filter((p) => p <= -0.01).length,
    lostOnLosers: pnls.reduce((n, p) => n + Math.min(0, p), 0),
    biggestLoss: pnls.reduce((m, p) => Math.min(m, p), 0),
    from: starts.length ? new Date(starts.reduce((m, t) => Math.min(m, t)) * 1000).toISOString() : null,
    to: ends.length ? new Date(ends.reduce((m, t) => Math.max(m, t)) * 1000).toISOString() : null,
  };
}

export async function polymarketBets(wallet: string, deadline: number) {
  const [open, closed, combos] = await Promise.all([
    walk<Position>("/v2/positions", { user: wallet, filter_amount: "0", sort_by: "TIMESTAMP" }, deadline),
    walk<Position>("/v2/positions", { user: wallet, status: "CLOSED", sort_by: "TIMESTAMP" }, deadline),
    walk<Combo>("/v2/positions/combos", { user: wallet, status: "RESOLVED_WIN,RESOLVED_LOSS,RESOLVED_PARTIAL", sort_by: "UPDATED" }, deadline),
  ]);
  return {
    ...summarizeBets(finishedBets(open.rows, closed.rows, combos.rows)),
    complete: open.complete && closed.complete && combos.complete,
    positionCount: open.rows.length + closed.rows.length + combos.rows.length,
  };
}
