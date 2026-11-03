"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CRISIS, DOORS, HELPLINE } from "@/lib/doors";
import { parseAmount, tally, usd } from "@/lib/money";

type Amounts = { deposited: string; withdrawn: string; balance: string };

type PolyResult = {
  wallet: string;
  money: {
    deposited: number;
    withdrawn: number;
    cashFlowComplete: boolean;
    officialAllTimePnl: number | null;
    openPositionValue: number | null;
  };
  bets: { from: string | null; to: string | null; truncated: boolean; winning: number; losing: number; lostOnLosers: number; biggestLoss: number };
};

const PLATFORMS: { id: string; name: string; where: string }[] = [
  { id: "polymarket-us", name: "Polymarket US app", where: "Account, then activity or statements" },
  { id: "kalshi", name: "Kalshi", where: "kalshi.com, Account, Activity: export deposits and withdrawals" },
  { id: "robinhood", name: "Robinhood", where: "Account, Investing, Realized profit & loss, Prediction markets" },
  { id: "coinbase", name: "Coinbase", where: "Predictions portfolio" },
  { id: "webull", name: "Webull", where: "Event contracts history" },
  { id: "other", name: "Anything else", where: "DraftKings, FanDuel, Crypto.com, Novig, PrizePicks, sportsbooks" },
];

const FIELDS = [
  { key: "deposited", label: "Put in" },
  { key: "withdrawn", label: "Took out" },
  { key: "balance", label: "Still in it" },
] as const;

const STORE = "offramp:v1";
const KEYS = ["guess", "amounts", "done"];
const EMPTY: Amounts = { deposited: "", withdrawn: "", balance: "" };

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

function clearSaved() {
  try {
    for (const key of KEYS) localStorage.removeItem(`${STORE}:${key}`);
  } catch {}
}

function date(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "unknown";
}

function filled(a: Amounts | undefined) {
  return !!a && !!(a.deposited || a.withdrawn || a.balance);
}

const field =
  "h-12 w-full min-w-0 rounded-[4px] border border-line-strong bg-field px-3 text-base text-ink tabular-nums placeholder:text-muted focus-visible:border-accent";
const primary =
  "inline-flex min-h-12 items-center justify-center rounded-[4px] bg-ink px-5 font-medium text-paper transition-[transform,opacity] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";
const quiet =
  "inline-flex min-h-11 items-center rounded-[4px] border border-line-strong px-4 font-medium text-ink transition-colors hover:border-ink active:translate-y-px";
const link = "text-accent underline decoration-1 underline-offset-[3px] hover:decoration-2";

function Heading({ n, children, aside }: { n: number; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="font-serif text-[1.75rem] leading-tight tracking-[-0.01em] sm:text-[2rem]">
        <span className="figure mr-3 text-muted" aria-hidden="true">
          {n}
        </span>
        {children}
      </h2>
      {aside}
    </div>
  );
}

export default function Home() {
  const [guess, setGuess] = useState("");
  const [amounts, setAmounts] = useState<Record<string, Amounts>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [polyCash, setPolyCash] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [walletInput, setWalletInput] = useState("");
  const [poly, setPoly] = useState<PolyResult | null>(null);
  const [polyState, setPolyState] = useState<"idle" | "loading" | "error">("idle");
  const [polyError, setPolyError] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState("");

  useEffect(() => {
    const saved = load<Record<string, Amounts>>("amounts", {});
    setGuess(load("guess", ""));
    setAmounts(saved);
    setOpen(Object.fromEntries(PLATFORMS.filter((p) => filled(saved[p.id])).map((p) => [p.id, true])));
    setDone(load("done", {}));
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    save("guess", guess);
    save("amounts", amounts);
    save("done", done);
  }, [hydrated, guess, amounts, done]);

  const {
    rows,
    net: total,
    putIn: put,
  } = useMemo(
    () =>
      tally([
        ...(poly
          ? [{ name: "Polymarket", deposited: poly.money.deposited, withdrawn: poly.money.withdrawn, left: (poly.money.openPositionValue ?? 0) + parseAmount(polyCash) }]
          : []),
        ...PLATFORMS.map((p) => {
          const a = amounts[p.id] ?? EMPTY;
          return { name: p.name, deposited: parseAmount(a.deposited), withdrawn: parseAmount(a.withdrawn), left: parseAmount(a.balance) };
        }),
      ]),
    [amounts, poly, polyCash],
  );
  const polyRow = rows.find((r) => r.name === "Polymarket");
  const polyGap = poly && polyRow && poly.money.officialAllTimePnl !== null ? polyRow.net - poly.money.officialAllTimePnl : 0;
  const guessed = parseAmount(guess.replace(/^[-−]/, ""));
  const shown = Math.round(total);
  const resultRef = useRef<HTMLElement>(null);
  const lookup = useRef(0);
  useEffect(() => {
    if (!revealed) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultRef.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  }, [revealed]);

  async function checkPolymarket() {
    if (!walletInput.trim() || polyState === "loading") return;
    setPolyState("loading");
    setPolyError("");
    setPoly(null);
    setPolyCash("");
    const id = ++lookup.current;
    try {
      const res = await fetch(`/api/polymarket?wallet=${encodeURIComponent(walletInput.trim())}`);
      const body = await res.json().catch(() => ({ error: "Polymarket took too long to answer. Try again in a minute, or type your totals in by hand." }));
      if (id !== lookup.current) return;
      if (!res.ok || body.error) throw new Error(body.error ?? "We couldn't load that wallet.");
      setPoly(body);
      setPolyState("idle");
    } catch (err) {
      if (id !== lookup.current) return;
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

  function startOver() {
    lookup.current++;
    clearSaved();
    setGuess("");
    setAmounts({});
    setOpen({});
    setPolyCash("");
    setDone({});
    setPoly(null);
    setPolyState("idle");
    setPolyError("");
    setWalletInput("");
    setRevealed(false);
  }

  const doorsDone = DOORS.filter((d) => done[d.id]).length;

  return (
    <div className="min-h-[100dvh] bg-paper text-ink">
      <main className="mx-auto max-w-[40rem] px-4 pb-16 pt-8 sm:px-6 sm:pt-14">
        <header>
          <p className="font-serif text-lg italic text-muted">Off Ramp</p>
          <h1 className="mt-6 font-serif text-[2.25rem] leading-[1.08] tracking-[-0.015em] [font-variation-settings:'opsz'_60] sm:text-[3rem]">
            See what prediction markets have really cost you. Then close every door.
          </h1>
          <p className="mt-5 max-w-[34rem] text-[1.0625rem] leading-relaxed text-muted">
            A sportsbook self-exclusion doesn&apos;t cover Kalshi, Polymarket, or the event contracts inside Robinhood, Coinbase and Webull. This puts your real number in one
            place and walks you through shutting each one.
          </p>
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-muted print:hidden">
            Want to talk to someone first?{" "}
            <a className={`${link} whitespace-nowrap`} href={HELPLINE.tel}>
              Call {HELPLINE.label}
            </a>
            ,{" "}
            <a className={link} href={HELPLINE.sms}>
              text
            </a>{" "}
            or{" "}
            <a className={link} href={HELPLINE.chat} target="_blank" rel="noreferrer">
              chat
            </a>
            . Free, any hour.
          </p>
        </header>

        <section className="mt-12 border-t border-line pt-10 print:hidden">
          <Heading n={1}>Before you look, guess</Heading>
          <p className="mt-3 leading-relaxed text-muted">Roughly how much do you think you&apos;re down, across everything?</p>
          <label className="mt-5 flex max-w-[16rem] items-baseline gap-2 border-b-2 border-line-strong pb-1 focus-within:border-accent">
            <span className="figure text-[2.5rem] leading-none text-muted" aria-hidden="true">
              $
            </span>
            <input
              aria-label="Your guess"
              inputMode="decimal"
              className="figure h-14 w-full min-w-0 bg-transparent text-[2.5rem] leading-none text-ink outline-none placeholder:text-muted"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              placeholder="0"
            />
          </label>
          <p className="mt-3 text-sm text-muted">Your numbers stay in this browser.</p>
        </section>

        <section className="mt-14 border-t border-line pt-10 print:hidden">
          <Heading n={2}>Add your accounts</Heading>

          <div className="mt-7">
            <h3 className="text-lg font-semibold">Polymarket (polymarket.com)</h3>
            <p className="mt-2 leading-relaxed text-muted">
              Paste your polymarket.com username or wallet address. Deposits, withdrawals and bets are public, so this fills itself in. It goes through our server to
              Polymarket&apos;s public data and isn&apos;t stored. Use the Polymarket US app? Add it in the list below instead.
            </p>
            <div className="mt-4 flex gap-2">
              <input
                aria-label="Polymarket username or wallet"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={`${field} flex-1`}
                value={walletInput}
                onChange={(e) => setWalletInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && checkPolymarket()}
                placeholder="username or 0x…"
              />
              <button className={`${primary} shrink-0`} onClick={checkPolymarket} disabled={polyState === "loading"}>
                {polyState === "loading" ? "Reading every bet…" : "Load"}
              </button>
            </div>
            <div aria-live="polite">
              {polyState === "loading" && <p className="mt-3 text-sm text-muted">Busy wallets can take a couple of minutes.</p>}
              {polyState === "error" && <p className="mt-3 text-sm font-medium text-accent">{polyError}</p>}
              {poly && (
                <p className="mt-3 text-sm text-muted">
                  Loaded {poly.wallet.slice(0, 6)}…{poly.wallet.slice(-4)}.
                </p>
              )}
            </div>
            {poly && (
              <label className="mt-4 block max-w-[20rem]">
                <span className="block text-sm text-muted">Cash in your Polymarket account (not your portfolio total)</span>
                <input inputMode="decimal" className={`${field} mt-2`} value={polyCash} onChange={(e) => setPolyCash(e.target.value)} placeholder="$0" />
              </label>
            )}
          </div>

          <div className="mt-10">
            <h3 className="text-lg font-semibold">Everything else</h3>
            <p className="mt-2 leading-relaxed text-muted">Tap each app you&apos;ve used and enter its totals. Skip the ones you never used.</p>
            <ul className="mt-4 border-t border-line">
              {PLATFORMS.map((p) => {
                const a = amounts[p.id] ?? EMPTY;
                const isOpen = !!open[p.id];
                const row = rows.find((r) => r.name === p.name);
                return (
                  <li key={p.id} className="border-b border-line">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={`acct-${p.id}`}
                      onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}
                      className="flex min-h-14 w-full items-center justify-between gap-4 py-3 text-left"
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="shrink-0 text-sm tabular-nums text-muted">
                        {row ? `Net ${usd(row.net)}` : isOpen ? "Close" : "Add"}
                        <span aria-hidden="true" className={`ml-2 inline-block transition-transform ${isOpen ? "rotate-45" : ""}`}>
                          +
                        </span>
                      </span>
                    </button>
                    {isOpen && (
                      <div id={`acct-${p.id}`} className="pb-5">
                        <p className="text-sm text-muted">Where to find it: {p.where}</p>
                        <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
                          {FIELDS.map((f) => (
                            <label key={f.key} className="min-w-0">
                              <span className="block text-sm text-muted">{f.label}</span>
                              <input
                                inputMode="decimal"
                                aria-label={`${p.name}: ${f.label}`}
                                className={`${field} mt-1 px-2.5`}
                                value={a[f.key]}
                                onChange={(e) => setAmounts((all) => ({ ...all, [p.id]: { ...(all[p.id] ?? EMPTY), [f.key]: e.target.value } }))}
                                placeholder="$0"
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <button className={`${primary} mt-10 w-full text-[1.0625rem]`} disabled={rows.length === 0} onClick={() => setRevealed(true)}>
            Show my real number
          </button>
          {rows.length === 0 && <p className="mt-3 text-center text-sm text-muted">Load Polymarket or add an account first.</p>}
        </section>

        {revealed && (
          <section ref={resultRef} className="mt-14 scroll-mt-6 border-t border-line pt-10">
            <Heading n={3}>Your real number</Heading>
            <p className="figure arrive mt-6 break-words text-[clamp(3.5rem,17vw,6.75rem)] leading-[0.95] tracking-[-0.02em]">{usd(total)}</p>
            <div className="arrive-late">
              <p className="mt-6 font-serif text-[1.3125rem] leading-snug">
                {shown < 0 && `That's how much less you have than you put in. You put in ${usd(put)} in total.`}
                {shown === 0 && `You've got back about what you put in, ${usd(put)}.`}
                {shown > 0 && `You have this much more than you put in. That can go back in fast. Being up doesn't make it safe, and closing the doors still matters.`}
              </p>
              {guessed > 0 && shown < 0 && <p className="mt-2 font-serif text-[1.3125rem] italic leading-snug text-muted">You guessed {usd(-guessed)}.</p>}

              <p className="mt-8 border-l-2 border-accent pl-4 leading-relaxed print:hidden">
                A number like this is a lot to look at. If it&apos;s hard, call or text{" "}
                <a className={`${link} whitespace-nowrap`} href={HELPLINE.tel}>
                  {HELPLINE.label}
                </a>{" "}
                <span className="whitespace-nowrap">({HELPLINE.number})</span> now. If you&apos;re thinking about hurting yourself, call or text{" "}
                <a className={`${link} font-semibold`} href={CRISIS.tel}>
                  {CRISIS.label}
                </a>
                . Then do the next step. It&apos;s what changes things.
              </p>

              {poly && poly.money.officialAllTimePnl !== null && poly.money.officialAllTimePnl < 0 && polyGap >= 5 && (
                <p className="mt-6 font-medium leading-relaxed">
                  Polymarket&apos;s own profit and loss for this wallet is {usd(poly.money.officialAllTimePnl)}, worse than the Polymarket row shows. See below for why they can
                  differ.
                </p>
              )}
              {poly && !poly.money.cashFlowComplete && (
                <p className="mt-4 font-medium leading-relaxed">
                  We couldn&apos;t read all of this wallet&apos;s deposits and withdrawals, so the Polymarket row is incomplete. Go by Polymarket&apos;s own number below.
                </p>
              )}

              <h3 className="mt-10 text-lg font-semibold">By account</h3>
              <ul className="mt-3 border-t border-line">
                {rows.map((r) => (
                  <li key={r.name} className="border-b border-line py-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="font-medium">{r.name}</span>
                      <span className="figure shrink-0 text-xl">{usd(r.net)}</span>
                    </div>
                    <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-sm tabular-nums text-muted">
                      <div className="flex gap-1.5">
                        <dt>Put in</dt>
                        <dd className="text-ink">{usd(r.deposited)}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt>Took out</dt>
                        <dd className="text-ink">{usd(r.withdrawn)}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt>Still in it</dt>
                        <dd className="text-ink">{usd(r.left)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>

              {poly && (
                <div className="mt-10 space-y-3 leading-relaxed">
                  <h3 className="text-lg font-semibold">Polymarket, bet by bet</h3>
                  {poly.bets.winning + poly.bets.losing === 0 ? (
                    <p className="text-muted">None of this wallet&apos;s bets have finished yet.</p>
                  ) : (
                    <p className="text-muted">
                      From {date(poly.bets.from)} to {date(poly.bets.to)}, of the bets that are finished (settled or sold):{" "}
                      <span className="text-ink">
                        {poly.bets.losing.toLocaleString()} lost and {poly.bets.winning.toLocaleString()} won
                      </span>
                      . The losing ones cost <span className="text-ink">{usd(Math.abs(poly.bets.lostOnLosers))}</span>, and the biggest single loss was{" "}
                      <span className="text-ink">{usd(Math.abs(poly.bets.biggestLoss))}</span>.
                      {poly.bets.truncated && " This wallet has too many bets to read in one go, so only the most recent ones are counted here."}
                    </p>
                  )}
                  {poly.money.officialAllTimePnl !== null && (
                    <p className="text-muted">
                      Polymarket&apos;s own profit and loss for this wallet: <span className="text-ink">{usd(poly.money.officialAllTimePnl)}</span>.
                      {polyGap <= -5 &&
                        ` That's ${usd(-polyGap)} better than your Polymarket row above. Likely reasons: open bets that are down right now, cash in the account you haven't entered, or money moved in or out without a bet.`}
                      {polyGap >= 5 &&
                        ` That's ${usd(polyGap)} worse than your Polymarket row above. Likely reasons: open bets that are up right now, cash you counted twice (type only cash, not your portfolio total), or money sent straight from an exchange that doesn't show here as a deposit.`}
                    </p>
                  )}
                  {poly.money.openPositionValue === null && (
                    <p className="text-muted">We couldn&apos;t read the value of your open bets, so they&apos;re counted as $0. Add them to the cash box if you know it.</p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        <section className="mt-14 border-t border-line pt-10">
          <Heading
            n={revealed ? 4 : 3}
            aside={
              <span className="shrink-0 text-sm tabular-nums text-muted">
                {doorsDone} of {DOORS.length} done
              </span>
            }
          >
            Close every door
          </Heading>
          <p className="mt-3 leading-relaxed text-muted">Do the ones you&apos;ve used, plus the shared list and a device blocker.</p>
          <ol className="mt-6 border-t border-line">
            {DOORS.map((d) => (
              <li key={d.id} className="border-b border-line py-6 last:border-b-0 last:pb-0 [break-inside:avoid]">
                <label className="flex cursor-pointer items-start gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      className="size-5 cursor-pointer accent-[var(--accent)]"
                      checked={!!done[d.id]}
                      onChange={(e) => setDone((x) => ({ ...x, [d.id]: e.target.checked }))}
                    />
                  </span>
                  <span className="pt-1.5">
                    <span className={`block font-serif text-[1.375rem] leading-tight ${done[d.id] ? "text-muted line-through decoration-1" : ""}`}>{d.name}</span>
                    <span className="mt-1.5 block leading-relaxed text-muted">{d.what}</span>
                  </span>
                </label>
                <div className="pl-14">
                  <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed marker:text-line-strong">
                    {d.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                  {d.note && (
                    <p className="mt-3 leading-relaxed">
                      <span className="font-semibold">Note: </span>
                      {d.note}
                    </p>
                  )}
                  {d.message && (
                    <div className="mt-4 print:hidden">
                      <p className="border-l-2 border-line-strong pl-4 font-serif text-[1.0625rem] italic leading-relaxed text-muted">{d.message}</p>
                      <button className={`${quiet} mt-3 text-sm`} onClick={() => copy(d.id, d.message!)}>
                        {copied === d.id ? "Copied" : "Copy message"}
                      </button>
                    </div>
                  )}
                  {(d.link || d.extraLink) && (
                    <p className="mt-3 flex flex-wrap gap-x-5 print:hidden">
                      {d.link && (
                        <a className={`${link} inline-flex min-h-11 items-center`} href={d.link.href} target="_blank" rel="noreferrer">
                          {d.link.label}
                        </a>
                      )}
                      {d.extraLink && (
                        <a className={`${link} inline-flex min-h-11 items-center`} href={d.extraLink.href} target="_blank" rel="noreferrer">
                          {d.extraLink.label}
                        </a>
                      )}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-14 border-t border-line pt-10 print:hidden">
          <Heading n={revealed ? 5 : 4}>Bring it to someone</Heading>
          <p className="mt-3 leading-relaxed text-muted">Print this page for a counselor or someone you trust. It shows your number and which doors are closed.</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <button className={primary} onClick={() => window.print()}>
              Print or save as PDF
            </button>
            <button className="min-h-11 text-sm text-muted underline underline-offset-[3px] hover:text-ink" onClick={startOver}>
              Clear everything from this browser
            </button>
          </div>
        </section>

        <footer className="mt-16 border-t border-line pt-6 text-sm leading-relaxed text-muted">
          Talk to someone, free, 24/7:{" "}
          <a className={`${link} whitespace-nowrap`} href={HELPLINE.tel}>
            {HELPLINE.label} ({HELPLINE.number})
          </a>
          ,{" "}
          <a className={link} href={HELPLINE.sms}>
            text
          </a>{" "}
          (from a phone) or{" "}
          <a className={link} href={HELPLINE.chat} target="_blank" rel="noreferrer">
            chat
          </a>
          . In a crisis, call or text{" "}
          <a className={link} href={CRISIS.tel}>
            {CRISIS.label}
          </a>
          .
        </footer>
      </main>
    </div>
  );
}
