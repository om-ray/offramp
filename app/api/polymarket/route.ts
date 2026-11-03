import { NextResponse } from "next/server";
import { PolymarketError, polymarketBets, polymarketMoney, resolveWallet } from "@/lib/polymarket";

export const maxDuration = 300;
const BUDGET_MS = 240_000;

const MESSAGES = {
  "not-found": { error: "We couldn't find exactly one polymarket.com profile with that name. Try the wallet address from your profile page.", status: 404 },
  "bad-address": { error: "That address isn't a Polymarket account. Check it against your profile page.", status: 400 },
  busy: { error: "Polymarket is busy right now. Try again in a minute.", status: 503 },
  upstream: { error: "We couldn't read this wallet from Polymarket just now. Try again, or type your totals in by hand below.", status: 502 },
};

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get("wallet")?.trim() ?? "";
  if (!input) return NextResponse.json({ error: "Paste a username or wallet address first." }, { status: 400 });
  const deadline = Date.now() + BUDGET_MS;
  try {
    const wallet = await resolveWallet(input);
    const [money, bets] = await Promise.all([polymarketMoney(wallet, deadline), polymarketBets(wallet, deadline)]);
    const empty = !money.deposited && !money.withdrawn && !money.openPositionValue && !money.officialAllTimePnl && !bets.positionCount;
    if (empty) {
      return NextResponse.json(
        { error: "There's no Polymarket activity at this address. Use the wallet address shown on your polymarket.com profile, not a MetaMask or exchange address." },
        { status: 404 },
      );
    }
    const { winning, losing, lostOnLosers, biggestLoss, from, to, complete } = bets;
    return NextResponse.json({ wallet, money, bets: { winning, losing, lostOnLosers, biggestLoss, from, to, truncated: !complete } });
  } catch (err) {
    const kind = err instanceof PolymarketError ? err.kind : "upstream";
    const { error, status } = MESSAGES[kind];
    return NextResponse.json({ error }, { status });
  }
}
