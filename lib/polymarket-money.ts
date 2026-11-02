const DATA = "https://data-api.polymarket.com";
const MAX_PAGES = 40;

type ActivityPage = { data: { type: string; usdc_size: number }[]; pagination: { has_more: boolean; next_cursor?: string } };

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(path, DATA);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Polymarket returned ${res.status} for ${url.pathname}`);
  return res.json() as Promise<T>;
}

export type PolymarketMoney = {
  deposited: number;
  withdrawn: number;
  cashFlowComplete: boolean;
  officialAllTimePnl: number | null;
  openPositionValue: number | null;
};

export async function polymarketMoney(wallet: string): Promise<PolymarketMoney> {
  let deposited = 0;
  let withdrawn = 0;
  let cursor: string | undefined;
  let complete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = { user: wallet, type: "DEPOSIT,WITHDRAWAL", exclude_deposits_withdrawals: "false", limit: "500" };
    if (cursor) params.cursor = cursor;
    const body = await get<ActivityPage>("/v2/activity", params);
    for (const row of body.data) {
      if (row.type === "DEPOSIT") deposited += row.usdc_size;
      if (row.type === "WITHDRAWAL") withdrawn += row.usdc_size;
    }
    if (!body.pagination.has_more || !body.pagination.next_cursor) {
      complete = true;
      break;
    }
    cursor = body.pagination.next_cursor;
  }
  const [all, value] = await Promise.all([
    get<{ pnl: number }[]>("/v1/leaderboard", { user: wallet, timePeriod: "ALL", category: "OVERALL", limit: "1" })
      .then((rows) => (Array.isArray(rows) && rows[0] && Number.isFinite(rows[0].pnl) ? rows[0].pnl : null))
      .catch(() => null),
    get<{ value: number }[]>("/value", { user: wallet }).then((r) => r[0]?.value ?? null).catch(() => null),
  ]);
  return {
    deposited,
    withdrawn,
    cashFlowComplete: complete,
    officialAllTimePnl: all,
    openPositionValue: value,
  };
}
