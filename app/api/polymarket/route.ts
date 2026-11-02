import { NextResponse } from "next/server";
import { buildReport } from "@/lib/polymarket-report.js";
import { resolveWallet } from "@/lib/polymarket-api.js";
import { polymarketMoney } from "@/lib/polymarket-money";

export const maxDuration = 300;

type Position = { status: string; totalPnl: number | null };

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get("wallet")?.trim() ?? "";
  try {
    const wallet: string = await resolveWallet(input);
    const [money, report] = await Promise.all([polymarketMoney(wallet), buildReport({ wallet })]);
    const resolved = (report.positions as Position[]).filter((p) => p.status === "resolved" && p.totalPnl !== null);
    return NextResponse.json({
      wallet,
      money,
      bets: {
        from: report.coverage.earliestTradeAt,
        to: report.coverage.latestTradeAt,
        truncated: report.coverage.truncated,
        trades: report.coverage.tradeCount,
        winning: resolved.filter((p) => (p.totalPnl ?? 0) > 0).length,
        losing: resolved.filter((p) => (p.totalPnl ?? 0) < 0).length,
        lostOnLosers: resolved.reduce((n, p) => n + Math.min(0, p.totalPnl ?? 0), 0),
        biggestLoss: Math.min(0, ...resolved.map((p) => p.totalPnl ?? 0)),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
