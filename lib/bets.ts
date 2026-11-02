export type Position = { status: string; totalPnl: number | null };

export function summarizeBets(positions: Position[]) {
  const settled = positions.filter((p) => p.status === "resolved" && p.totalPnl !== null).map((p) => p.totalPnl as number);
  return {
    winning: settled.filter((pnl) => pnl > 0).length,
    losing: settled.filter((pnl) => pnl < 0).length,
    lostOnLosers: settled.reduce((n, pnl) => n + Math.min(0, pnl), 0),
    biggestLoss: Math.min(0, ...settled),
  };
}
