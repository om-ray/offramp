import { NextResponse } from "next/server";
import { PolymarketError, isLookupInput, polymarketBets, polymarketMoney, resolveWallet } from "@/lib/polymarket";

export const maxDuration = 120;
const BUDGET_MS = 75_000;
const CACHE_MS = 15 * 60_000;
const PARTIAL_CACHE_MS = 30_000;

const MESSAGES = {
  "not-found": { error: "We couldn't find exactly one polymarket.com profile with that name. Try the wallet address from your profile page.", status: 404 },
  busy: { error: "Polymarket is busy right now. Try again in a minute.", status: 503 },
  upstream: { error: "We couldn't read this wallet from Polymarket just now. Try again, or type your totals in by hand below.", status: 503 },
};

type Lookup = { body: unknown; status: number; complete: boolean };
const cache = new Map<string, { at: number; ttl: number; result: Promise<Lookup> }>();

async function lookup(wallet: string): Promise<Lookup> {
  const deadline = Date.now() + BUDGET_MS;
  const [money, bets] = await Promise.all([polymarketMoney(wallet, deadline), polymarketBets(wallet, deadline)]);
  const empty = !money.deposited && !money.withdrawn && !money.openPositionValue && !money.officialAllTimePnl && !bets.positionCount;
  if (empty) {
    return {
      status: 404,
      complete: true,
      body: { error: "There's no Polymarket activity at this address. Use the wallet address shown on your polymarket.com profile, not a MetaMask or exchange address." },
    };
  }
  const { winning, losing, lostOnLosers, biggestLoss, from, to, complete } = bets;
  const whole = complete && money.cashFlowComplete && money.officialAllTimePnl !== null && money.openPositionValue !== null;
  return { status: 200, complete: whole, body: { wallet, money, bets: { winning, losing, lostOnLosers, biggestLoss, from, to, truncated: !complete } } };
}

function cachedLookup(wallet: string): Promise<Lookup> {
  const now = Date.now();
  for (const [key, entry] of cache) if (now - entry.at > entry.ttl) cache.delete(key);
  const hit = cache.get(wallet);
  if (hit) return hit.result;
  const result = lookup(wallet);
  const entry = { at: now, ttl: CACHE_MS, result };
  cache.set(wallet, entry);
  result.then(
    (r) => {
      if (r.status !== 200) cache.delete(wallet);
      else if (!r.complete) entry.ttl = PARTIAL_CACHE_MS;
    },
    () => cache.delete(wallet),
  );
  return result;
}

export async function GET(request: Request) {
  const secret = process.env.EDGE_SECRET;
  if (process.env.VERCEL_ENV && (!secret || request.headers.get("x-edge-auth") !== secret)) return new NextResponse(null, { status: 404 });
  const input = new URL(request.url).searchParams.get("wallet")?.trim() ?? "";
  if (!input) return NextResponse.json({ error: "Paste a username or wallet address first." }, { status: 400 });
  if (!isLookupInput(input)) return NextResponse.json({ error: "That doesn't look like a Polymarket username or wallet address." }, { status: 400 });
  try {
    const wallet = await resolveWallet(input);
    const { body, status } = await cachedLookup(wallet);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const kind = err instanceof PolymarketError ? err.kind : "upstream";
    const { error, status } = MESSAGES[kind];
    return NextResponse.json({ error }, { status });
  }
}
