import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, tally, usd } from "../lib/money.ts";
import { polymarketMoney } from "../lib/polymarket-money.ts";

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
});

test("bad amounts count as zero", () => {
  assert.equal(parseAmount("-50"), 0);
  assert.equal(parseAmount("abc"), 0);
});

function mockPolymarket(pages: { data: { type: string; usdc_size: number; timestamp: number }[]; has_more: boolean }[]) {
  const seen: string[] = [];
  globalThis.fetch = (async (input: URL) => {
    const url = new URL(input);
    seen.push(url.pathname + url.search);
    if (url.pathname === "/v2/activity") {
      const i = Number(url.searchParams.get("cursor") ?? 0);
      const page = pages[i];
      return Response.json({ data: page.data, pagination: { has_more: page.has_more, next_cursor: page.has_more ? String(i + 1) : undefined } });
    }
    if (url.pathname === "/v1/leaderboard") return Response.json([{ pnl: url.searchParams.get("timePeriod") === "ALL" ? -920 : -40 }]);
    if (url.pathname === "/value") return Response.json([{ value: 24 }]);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return seen;
}

test("Polymarket money follows every page of deposits and withdrawals", async () => {
  const seen = mockPolymarket([
    { data: [{ type: "DEPOSIT", usdc_size: 500, timestamp: 1_790_000_000 }, { type: "WITHDRAWAL", usdc_size: 10, timestamp: 1_790_100_000 }], has_more: true },
    { data: [{ type: "DEPOSIT", usdc_size: 487, timestamp: 1_789_000_000 }], has_more: false },
  ]);
  const money = await polymarketMoney("0xabc");
  assert.equal(money.deposited, 987);
  assert.equal(money.withdrawn, 10);
  assert.equal(money.cashFlowComplete, true);
  assert.equal(money.firstDepositAt, new Date(1_789_000_000_000).toISOString());
  assert.equal(money.officialAllTimePnl, -920);
  assert.equal(money.openPositionValue, 24);
  assert.ok(seen.some((s) => s.includes("cursor=1")));
});

test("Polymarket money says when it couldn't read every deposit", async () => {
  mockPolymarket(Array.from({ length: 50 }, () => ({ data: [{ type: "DEPOSIT", usdc_size: 1, timestamp: 1 }], has_more: true })));
  const money = await polymarketMoney("0xabc");
  assert.equal(money.cashFlowComplete, false);
});
