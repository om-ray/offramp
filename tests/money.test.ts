import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, tally, usd } from "../lib/money.ts";
import { finishedBets, isLookupInput, polymarketBets, polymarketMoney, resolveWallet, summarizeBets } from "../lib/polymarket.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("real number adds every account and skips empty ones", () => {
  const result = tally([
    { name: "Polymarket", deposited: 987, withdrawn: 10, left: 24 },
    { name: "Kalshi", deposited: parseAmount("$1,200"), withdrawn: parseAmount("300"), left: parseAmount("") },
    { name: "Webull", deposited: 0, withdrawn: 0, left: 0 },
  ]);
  assert.deepEqual(result.rows.map((r) => [r.name, r.net]), [["Polymarket", -953], ["Kalshi", -900]]);
  assert.equal(result.net, -1853);
  assert.equal(result.putIn, 2187);
  assert.equal(usd(result.net), "−$1,853");
  assert.equal(usd(-0.4), "$0");
  assert.equal(parseAmount("-50"), 0);
});

type Row = { type: string; usdc_size: number };

function mockPolymarket(pages: { data: Row[]; more: boolean }[], delayMs = 0) {
  const seen: string[] = [];
  globalThis.fetch = (async (input: URL) => {
    const url = new URL(input);
    seen.push(url.pathname + url.search);
    await new Promise((r) => setTimeout(r, delayMs));
    if (url.pathname === "/v2/activity") {
      const i = Number(url.searchParams.get("cursor") ?? 0);
      return Response.json({ data: pages[i].data, pagination: { has_more: pages[i].more, next_cursor: pages[i].more ? String(i + 1) : null } });
    }
    if (url.pathname === "/v2/leaderboard") return Response.json({ data: { pnl: -920 } });
    if (url.pathname === "/v2/value") return Response.json({ data: { value: 24 } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return seen;
}

test("Polymarket money follows every page of deposits and withdrawals", async () => {
  const seen = mockPolymarket([
    { data: [{ type: "DEPOSIT", usdc_size: 500 }, { type: "WITHDRAWAL", usdc_size: 10 }], more: true },
    { data: [{ type: "DEPOSIT", usdc_size: 487 }, { type: "DEPOSIT", usdc_size: 0 }], more: false },
  ]);
  const money = await polymarketMoney("0xabc", Date.now() + 10_000);
  assert.deepEqual(money, { deposited: 987, withdrawn: 10, cashFlowComplete: true, officialAllTimePnl: -920, openPositionValue: 24 });
  assert.ok(seen.some((s) => s.includes("cursor=1") && s.includes("start=1")));
});

test("Polymarket money keeps what it read and says so when time runs out", async () => {
  mockPolymarket(Array.from({ length: 5 }, () => ({ data: [{ type: "DEPOSIT", usdc_size: 1 }], more: true })), 60);
  const money = await polymarketMoney("0xabc", Date.now() + 100);
  assert.equal(money.deposited, 2);
  assert.equal(money.cashFlowComplete, false);
});

test("bet lookup asks Polymarket for every settled combo, wins included", async () => {
  const seen: string[] = [];
  globalThis.fetch = (async (input: URL) => {
    const url = new URL(input);
    seen.push(url.pathname + url.search);
    return Response.json({ data: [], pagination: { has_more: false, next_cursor: null } });
  }) as typeof fetch;
  await polymarketBets("0xabc", Date.now() + 10_000);
  const combos = new URL("https://x" + seen.find((s) => s.startsWith("/v2/positions/combos"))).searchParams;
  assert.equal(combos.get("status"), "RESOLVED_WIN,RESOLVED_LOSS,RESOLVED_PARTIAL");
});

test("finished bets include held losers, sold bets and settled combos, not live bets", () => {
  const pos = (status: string, realized: number, total: number) => ({ status, realized_pnl: realized, total_pnl: total, first_entry_at: 1_790_000_000, last_event_at: 1_791_000_000 });
  const combo = (status: string, cost: number, payout: number) => ({
    status,
    gross_entry_cost_usdc: cost,
    realized_payout_usdc: payout,
    first_entry_at_micros: 1_789_000_000_000_000,
    updated_at_micros: 1_792_000_000_000_000,
  });
  const bets = finishedBets(
    [pos("REDEEMABLE", -0.5, -150), pos("OPEN", 0, -500)],
    [pos("CLOSED", 45, 45), pos("CLOSED", -20, -20), pos("CLOSED", 0, 0), pos("CLOSED", -0.004, -0.004)],
    [combo("RESOLVED_LOSS", 5, 0), combo("OPEN", 9, 0), combo("RESOLVED_WIN", 2, 12)],
  );
  assert.deepEqual(summarizeBets(bets), {
    winning: 2,
    losing: 3,
    lostOnLosers: -175.004,
    biggestLoss: -150,
    from: new Date(1_789_000_000_000).toISOString(),
    to: new Date(1_792_000_000_000).toISOString(),
  });
});

test("username lookup finds real names with accents or spaces and skips empty search rows", async () => {
  globalThis.fetch = (async () =>
    Response.json({
      profiles: [null, { name: "Joséph", proxyWallet: "0xaffffa5ea6f94e08bae2898bc0567d214af3493b" }, { name: "John XYZ", proxyWallet: "0x751a2b86cab503496efd325c8344e10159349ea1" }],
    })) as unknown as typeof fetch;
  assert.equal(await resolveWallet("Joséph"), "0xaffffa5ea6f94e08bae2898bc0567d214af3493b");
  assert.equal(await resolveWallet("@john xyz"), "0x751a2b86cab503496efd325c8344e10159349ea1");
  assert.ok(isLookupInput("Joséph") && isLookupInput("John XYZ"));
  assert.ok(!isLookupInput("x".repeat(65)) && !isLookupInput("a\u0000b"));
});
