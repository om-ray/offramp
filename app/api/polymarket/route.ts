import { NextResponse } from "next/server";
import { buildReport } from "@/lib/polymarket-report.js";
import { resolveWallet } from "@/lib/polymarket-api.js";
import { polymarketMoney } from "@/lib/polymarket-money";
import { summarizeBets, type Position } from "@/lib/bets";

export const maxDuration = 300;

function plainError(message: string): { error: string; status: number } {
  if (/must match one public profile/i.test(message)) {
    return { error: "We couldn't find exactly one polymarket.com profile with that name. Try the wallet address from your profile page.", status: 404 };
  }
  if (/invalid_request|400/i.test(message)) return { error: "That address isn't a Polymarket account. Check it against your profile page.", status: 400 };
  if (/429|rate/i.test(message)) return { error: "Polymarket is busy right now. Try again in a minute.", status: 503 };
  return { error: "We couldn't read this wallet from Polymarket just now. Try again, or type your totals in by hand below.", status: 502 };
}

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get("wallet")?.trim() ?? "";
  if (!input) return NextResponse.json({ error: "Paste a username or wallet address first." }, { status: 400 });
  try {
    const wallet: string = await resolveWallet(input);
    const [money, report] = await Promise.all([polymarketMoney(wallet), buildReport({ wallet })]);
    const bets = summarizeBets(report.positions as Position[]);
    const empty = !money.deposited && !money.withdrawn && !money.openPositionValue && !money.officialAllTimePnl && !bets.winning && !bets.losing;
    if (empty) {
      return NextResponse.json(
        { error: "There's no Polymarket activity at this address. Use the wallet address shown on your polymarket.com profile, not a MetaMask or exchange address." },
        { status: 404 },
      );
    }
    return NextResponse.json({
      wallet,
      money,
      bets: {
        from: report.coverage.earliestTradeAt,
        to: report.coverage.latestTradeAt,
        truncated: report.coverage.truncated,
        ...bets,
      },
    });
  } catch (err) {
    const { error, status } = plainError((err as Error).message);
    return NextResponse.json({ error }, { status });
  }
}
