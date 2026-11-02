"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DOORS, HELPLINE } from "@/lib/doors";
import { parseAmount, tally, usd } from "@/lib/money";

type Manual = { id: string; name: string; deposited: string; withdrawn: string; balance: string };

type PolyResult = {
  wallet: string;
  money: {
    deposited: number;
    withdrawn: number;
    firstDepositAt: string | null;
    cashFlowComplete: boolean;
    officialAllTimePnl: number | null;
    officialLast30DaysPnl: number | null;
    openPositionValue: number | null;
  };
  bets: { from: string | null; to: string | null; truncated: boolean; trades: number; winning: number; losing: number; lostOnLosers: number; biggestLoss: number };
};

const PLATFORMS: { id: string; name: string; where: string }[] = [
  { id: "kalshi", name: "Kalshi", where: "kalshi.com, Account, Activity: export deposits and withdrawals" },
  { id: "robinhood", name: "Robinhood", where: "Account, Investing, Realized profit & loss, Prediction markets" },
  { id: "coinbase", name: "Coinbase", where: "Predictions portfolio" },
  { id: "webull", name: "Webull", where: "Event contracts history" },
  { id: "other", name: "Anything else", where: "FanDuel, DraftKings, Crypto.com, sportsbooks" },
];

const STORE = "offramp:v1";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${STORE}:${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`${STORE}:${key}`, JSON.stringify(value));
  } catch {}
}

function date(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "unknown";
}

export default function Home() {
  const [guess, setGuess] = useState("");
  const [manual, setManual] = useState<Manual[]>(PLATFORMS.map((p) => ({ id: p.id, name: p.name, deposited: "", withdrawn: "", balance: "" })));
  const [walletInput, setWalletInput] = useState("");
  const [poly, setPoly] = useState<PolyResult | null>(null);
  const [polyState, setPolyState] = useState<"idle" | "loading" | "error">("idle");
  const [polyError, setPolyError] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState("");

  useEffect(() => {
    setGuess(load("guess", ""));
    setManual((m) => load("manual", m));
    setDone(load("done", {}));
  }, []);
  useEffect(() => save("guess", guess), [guess]);
  useEffect(() => save("manual", manual), [manual]);
  useEffect(() => save("done", done), [done]);

  const { rows, net: total, putIn: put } = useMemo(
    () =>
      tally([
        ...(poly ? [{ name: "Polymarket", deposited: poly.money.deposited, withdrawn: poly.money.withdrawn, left: poly.money.openPositionValue ?? 0 }] : []),
        ...manual.map((m) => ({ name: m.name, deposited: parseAmount(m.deposited), withdrawn: parseAmount(m.withdrawn), left: parseAmount(m.balance) })),
      ]),
    [manual, poly],
  );
  const guessed = parseAmount(guess);
  const resultRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (revealed) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [revealed]);

  async function checkPolymarket() {
    if (!walletInput.trim()) return;
    setPolyState("loading");
    setPolyError("");
    try {
      const res = await fetch(`/api/polymarket?wallet=${encodeURIComponent(walletInput.trim())}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't load that wallet");
      setPoly(body);
      setPolyState("idle");
    } catch (err) {
      setPolyError((err as Error).message);
      setPolyState("error");
    }
  }

  function copy(id: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(""), 1500);
    });
  }

  const doorsDone = DOORS.filter((d) => done[d.id]).length;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <div className="sticky top-0 z-10 border-b border-teal-900/10 bg-teal-50 px-4 py-2 text-sm text-teal-950 print:static">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1">
          <span>Talk to someone now, free, 24/7:</span>
          <a className="font-semibold underline" href={HELPLINE.tel}>
            {HELPLINE.label} ({HELPLINE.number})
          </a>
          <a className="underline" href={HELPLINE.sms}>
            text
          </a>
          <a className="underline" href={HELPLINE.chat} target="_blank" rel="noreferrer">
            chat
          </a>
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-4 pb-24 pt-10">
        <header className="mb-10">
          <p className="text-sm font-medium uppercase tracking-wide text-stone-500">Off Ramp</p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">See what prediction markets have really cost you. Then close every door.</h1>
          <p className="mt-4 text-stone-600">
            Kalshi, Polymarket and the event contracts inside Robinhood, Coinbase and Webull aren't covered by a sportsbook self-exclusion. This puts your real number in one place and walks you through shutting each one. Everything you type stays in this browser.
          </p>
        </header>

        <section className="mb-10 rounded-2xl border border-stone-200 bg-white p-6 print:hidden">
          <h2 className="text-lg font-semibold">1. Before you look, guess</h2>
          <p className="mt-1 text-sm text-stone-600">Roughly how much do you think you're down, across everything?</p>
          <label className="mt-4 flex max-w-xs items-center rounded-lg border border-stone-300 px-3 py-2 focus-within:border-teal-700">
            <span className="text-stone-500">$</span>
            <input aria-label="Your guess" inputMode="decimal" className="ml-1 w-full bg-transparent outline-none" value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="0" />
          </label>
        </section>

        <section className="mb-10 rounded-2xl border border-stone-200 bg-white p-6 print:hidden">
          <h2 className="text-lg font-semibold">2. Add your accounts</h2>

          <div className="mt-5">
            <h3 className="font-medium">Polymarket</h3>
            <p className="mt-1 text-sm text-stone-600">Paste your username or wallet address. Deposits, withdrawals and every bet are public, so this fills itself in.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                aria-label="Polymarket username or wallet"
                className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 outline-none focus:border-teal-700"
                value={walletInput}
                onChange={(e) => setWalletInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && checkPolymarket()}
                placeholder="username or 0x…"
              />
              <button
                className="rounded-lg bg-teal-800 px-4 py-2 font-medium text-white disabled:opacity-60"
                onClick={checkPolymarket}
                disabled={polyState === "loading"}
              >
                {polyState === "loading" ? "Reading every bet…" : "Load"}
              </button>
            </div>
            {polyState === "loading" && <p className="mt-2 text-sm text-stone-500">Busy wallets can take a couple of minutes.</p>}
            {polyState === "error" && <p className="mt-2 text-sm text-red-700">{polyError}</p>}
            {poly && <p className="mt-2 text-sm text-teal-800">Loaded {poly.wallet.slice(0, 6)}…{poly.wallet.slice(-4)}.</p>}
          </div>

          <div className="mt-8">
            <h3 className="font-medium">Everything else</h3>
            <p className="mt-1 text-sm text-stone-600">Enter totals from each app. Leave a row empty if you never used it.</p>
            <div className="mt-3 space-y-4">
              {manual.map((m, i) => (
                <fieldset key={m.id} className="rounded-xl border border-stone-200 p-4">
                  <legend className="px-1 text-sm font-medium">{m.name}</legend>
                  <p className="mb-3 text-xs text-stone-500">{PLATFORMS[i].where}</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {(["deposited", "withdrawn", "balance"] as const).map((field) => (
                      <label key={field} className="text-sm">
                        <span className="text-stone-600">{field === "deposited" ? "Put in" : field === "withdrawn" ? "Took out" : "Still in it"}</span>
                        <input
                          inputMode="decimal"
                          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 outline-none focus:border-teal-700"
                          value={m[field]}
                          onChange={(e) => setManual((all) => all.map((x, j) => (j === i ? { ...x, [field]: e.target.value } : x)))}
                          placeholder="$0"
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          </div>

          <button
            className="mt-8 w-full rounded-lg bg-stone-900 px-4 py-3 font-medium text-white disabled:opacity-40"
            disabled={rows.length === 0}
            onClick={() => setRevealed(true)}
          >
            Show my real number
          </button>
        </section>

        {revealed && (
          <section ref={resultRef} className="mb-10 scroll-mt-24 rounded-2xl border border-stone-200 bg-white p-6 print:border-0 print:p-0">
            <h2 className="text-lg font-semibold">3. Your real number</h2>
            <p className="mt-4 text-5xl font-semibold tabular-nums">{usd(total)}</p>
            <p className="mt-2 text-stone-600">
              {total < 0 ? "That's how much less you have than you put in." : "You have this much more than you put in."} You put in {usd(put)} in total.
              {guessed > 0 && total < 0 && ` You guessed ${usd(-guessed)}.`}
            </p>

            <table className="mt-6 w-full text-left text-sm tabular-nums">
              <thead className="text-stone-500">
                <tr>
                  <th className="py-2 font-normal">Account</th>
                  <th className="py-2 text-right font-normal">Put in</th>
                  <th className="py-2 text-right font-normal">Took out</th>
                  <th className="py-2 text-right font-normal">Still in it</th>
                  <th className="py-2 text-right font-normal">Net</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="border-t border-stone-100">
                    <td className="py-2">{r.name}</td>
                    <td className="py-2 text-right">{usd(r.deposited)}</td>
                    <td className="py-2 text-right">{usd(r.withdrawn)}</td>
                    <td className="py-2 text-right">{usd(r.left)}</td>
                    <td className="py-2 text-right font-medium">{usd(r.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {poly && (
              <div className="mt-6 rounded-xl bg-stone-50 p-4 text-sm text-stone-700">
                <p className="font-medium text-stone-900">Polymarket, bet by bet</p>
                <p className="mt-1">
                  From {date(poly.bets.from)} to {date(poly.bets.to)}: {poly.bets.losing.toLocaleString()} losing bets and {poly.bets.winning.toLocaleString()} winning ones. The losing bets cost {usd(poly.bets.lostOnLosers)}, and the biggest single loss was {usd(poly.bets.biggestLoss)}.
                  {poly.bets.truncated && " Polymarket only shares your most recent 10,000 or so trades, so older bets aren't counted here."}
                </p>
                {poly.money.officialAllTimePnl !== null && <p className="mt-2">Polymarket's own all-time profit and loss for this wallet: {usd(poly.money.officialAllTimePnl)}.</p>}
                {!poly.money.cashFlowComplete && <p className="mt-2">This wallet has more deposits than we could read, so "Put in" may be too low.</p>}
                <p className="mt-2 text-stone-500">"Still in it" for Polymarket is the value of open positions. Add any cash sitting in the account under "Anything else".</p>
              </div>
            )}

            <div className="mt-6 rounded-xl border border-teal-900/15 bg-teal-50 p-4 text-sm text-teal-950 print:hidden">
              A number like this is a lot to look at. If it's hard, call or text {HELPLINE.label} ({HELPLINE.number}) now. Then do the next step, it's what changes things.
            </div>
          </section>
        )}

        <section className="mb-10 rounded-2xl border border-stone-200 bg-white p-6 print:border-0 print:p-0">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold">4. Close every door</h2>
            <span className="text-sm text-stone-500 tabular-nums">
              {doorsDone} of {DOORS.length} done
            </span>
          </div>
          <p className="mt-1 text-sm text-stone-600">Do the ones you've used, plus the shared list and a device blocker.</p>
          <ol className="mt-5 space-y-4">
            {DOORS.map((d) => (
              <li key={d.id} className={`rounded-xl border p-4 ${done[d.id] ? "border-teal-700/30 bg-teal-50/50" : "border-stone-200"}`}>
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" className="mt-1 size-4 accent-teal-800" checked={!!done[d.id]} onChange={(e) => setDone((x) => ({ ...x, [d.id]: e.target.checked }))} />
                  <span>
                    <span className="font-medium">{d.name}</span>
                    <span className="mt-0.5 block text-sm text-stone-600">{d.what}</span>
                  </span>
                </label>
                <ul className="ml-7 mt-3 list-disc space-y-1 pl-4 text-sm text-stone-700">
                  {d.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                {d.note && <p className="ml-7 mt-2 text-sm text-amber-800">{d.note}</p>}
                {d.message && (
                  <div className="ml-7 mt-3 print:hidden">
                    <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-700">{d.message}</p>
                    <button className="mt-2 text-sm font-medium text-teal-800 underline" onClick={() => copy(d.id, d.message!)}>
                      {copied === d.id ? "Copied" : "Copy message"}
                    </button>
                  </div>
                )}
                {d.link && (
                  <a className="ml-7 mt-2 inline-block text-sm text-teal-800 underline print:hidden" href={d.link.href} target="_blank" rel="noreferrer">
                    {d.link.label}
                  </a>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-6 print:hidden">
          <h2 className="text-lg font-semibold">5. Bring it to someone</h2>
          <p className="mt-1 text-sm text-stone-600">Print this page for a counselor or someone you trust. It shows your number and which doors are closed.</p>
          <button className="mt-4 rounded-lg border border-stone-300 px-4 py-2 font-medium" onClick={() => window.print()}>
            Print or save as PDF
          </button>
        </section>
      </main>
    </div>
  );
}
