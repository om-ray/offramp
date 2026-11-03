const DATA = "https://data-api.polymarket.com";
const GAMMA = "https://gamma-api.polymarket.com";
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const PAGE = "1000";

type Page<T> = { data: T[]; pagination?: { has_more?: boolean; next_cursor?: string | null } };

export type FailureKind = "not-found" | "busy" | "bad-address" | "upstream";

export class PolymarketError extends Error {
  readonly kind: FailureKind;
  constructor(message: string, kind: FailureKind) {
    super(message);
    this.kind = kind;
  }
}

async function getJson<T>(base: string, path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(90_000) });
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(wait, 10) * 1000));
      continue;
    }
    if (res.status === 429) throw new PolymarketError("Polymarket is busy right now.", "busy");
    if (res.status === 400) throw new PolymarketError(`Polymarket rejected ${url.pathname}`, "bad-address");
    if (!res.ok) throw new PolymarketError(`Polymarket returned ${res.status} for ${url.pathname}`, "upstream");
    return res.json() as Promise<T>;
  }
}

async function walk<T>(path: string, params: Record<string, string>, deadline: number): Promise<{ rows: T[]; complete: boolean }> {
  const rows: T[] = [];
  let cursor: string | undefined;
  while (Date.now() < deadline) {
    const body = await getJson<Page<T>>(DATA, path, cursor ? { ...params, cursor } : { ...params, limit: PAGE });
    rows.push(...(body.data ?? []));
    cursor = body.pagination?.next_cursor ?? undefined;
    if (!cursor) return { rows, complete: true };
  }
  return { rows, complete: false };
}

export async function resolveWallet(input: string): Promise<string> {
  const query = input.trim().replace(/^@/, "");
  if (ADDRESS.test(query)) return query.toLowerCase();
  type Profile = { name?: string; pseudonym?: string; proxyWallet?: string };
  const result = await getJson<{ profiles?: Profile[] }>(GAMMA, "/public-search", { q: query, search_profiles: "true", limit_per_type: "20" });
  const wallets = new Set(
    (result.profiles ?? [])
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
    getJson<{ data: { pnl: number } | null }>(DATA, "/v2/leaderboard", { user: wallet, time_period: "all" }).catch(() => null),
    getJson<{ data: { value: number } | null }>(DATA, "/v2/value", { user: wallet }).catch(() => null),
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
    winning: pnls.filter((p) => p > 0).length,
    losing: pnls.filter((p) => p < 0).length,
    lostOnLosers: pnls.reduce((n, p) => n + Math.min(0, p), 0),
    biggestLoss: Math.min(0, ...pnls),
    from: starts.length ? new Date(Math.min(...starts) * 1000).toISOString() : null,
    to: ends.length ? new Date(Math.max(...ends) * 1000).toISOString() : null,
  };
}

export async function polymarketBets(wallet: string, deadline: number) {
  const [open, closed, combos] = await Promise.all([
    walk<Position>("/v2/positions", { user: wallet, filter_amount: "0", sort_by: "TIMESTAMP" }, deadline),
    walk<Position>("/v2/positions", { user: wallet, status: "CLOSED", sort_by: "TIMESTAMP" }, deadline),
    walk<Combo>("/v2/positions/combos", { user: wallet }, deadline),
  ]);
  return {
    ...summarizeBets(finishedBets(open.rows, closed.rows, combos.rows)),
    complete: open.complete && closed.complete && combos.complete,
    positionCount: open.rows.length + closed.rows.length + combos.rows.length,
  };
}
