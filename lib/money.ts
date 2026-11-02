export type Account = { name: string; deposited: number; withdrawn: number; left: number };
export type Row = Account & { net: number };

export function tally(accounts: Account[]): { rows: Row[]; net: number; putIn: number } {
  const rows = accounts.filter((a) => a.deposited || a.withdrawn || a.left).map((a) => ({ ...a, net: a.withdrawn + a.left - a.deposited }));
  return {
    rows,
    net: rows.reduce((n, r) => n + r.net, 0),
    putIn: rows.reduce((n, r) => n + r.deposited, 0),
  };
}

export function usd(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "−" : "";
  return `${sign}$${Math.abs(rounded).toLocaleString("en-US")}`;
}

export function parseAmount(raw: string): number {
  const n = Number(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
