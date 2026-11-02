const EPS = 1e-7;
const number = value => typeof value === 'number' && Number.isFinite(value);
const rounded = value => value === null ? null : Math.round(value * 1e8) / 1e8;
const month = timestamp => new Date(timestamp * 1000).toISOString().slice(0, 7);
export const priceBucket = p => p < .2 ? '<0.20' : p < .5 ? '0.20-0.50' : p < .8 ? '0.50-0.80' : p < .95 ? '0.80-0.95' : '>=0.95';

export function categoryOf(market) {
    if (market?.category) return market.category;
    const tags = (market?.tags ?? []).map(t => typeof t === 'string' ? t.toLowerCase() : String(t.label ?? t.slug ?? '').toLowerCase());
    for (const category of ['sports', 'politics', 'crypto', 'weather', 'business', 'science', 'entertainment']) {
        if (tags.some(t => t === category)) return category;
    }
    return tags[0] || 'unknown';
}

export function reconcile(trades, markets, livePositions = null, coverage = {}) {
    const earliestTimestamp = Math.min(...trades.map(t => t.timestamp).filter(Number.isFinite));
    const groups = new Map();
    let invalidTrades = 0;
    for (const trade of [...trades].reverse()) {
        const { price, size, timestamp } = trade;
        if (!number(price) || price < 0 || price > 1 || !number(size) || size <= 0 || !number(timestamp) || timestamp < 0 || !['BUY', 'SELL'].includes(trade.side) || !trade.asset || !trade.conditionId) { invalidTrades++; continue; }
        const key = `${trade.conditionId}:${trade.asset}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(trade);
    }
    const positions = [];
    const monthly = new Map();
    const addMonth = (key, pnl, kind) => {
        if (!monthly.has(key)) monthly.set(key, { month: key, saleRealizedPnl: 0, settlementRealizedPnl: 0 });
        monthly.get(key)[kind] += pnl;
    };
    for (const fills of groups.values()) {
        fills.sort((a, b) => a.timestamp - b.timestamp);
        const first = fills[0];
        const market = markets[first.conditionId];
        const closeTimestamp = market?.closedTime ? Date.parse(market.closedTime) : NaN;
        const settlementAt = Number.isFinite(closeTimestamp) ? new Date(closeTimestamp).toISOString() : null;
        const settlementMonth = settlementAt ? settlementAt.slice(0, 7) : 'unknown-resolution-month';
        const sameSecondOrderingAssumed = fills.some((fill, index) => index > 0 && fill.timestamp === fills[index - 1].timestamp && fill.side !== fills[index - 1].side);
        const token = market?.tokens?.find(t => String(t.token_id) === String(first.asset));
        const winners = market?.tokens?.filter(t => t.winner === true) ?? [];
        const resolved = market?.closed === true && winners.length === 1 && Boolean(token);
        let quantity = 0, cost = 0, bought = 0, purchaseCost = 0, sold = 0, saleProceeds = 0, salePnl = 0;
        let missingInventory = false;
        const sales = [];
        for (const fill of fills) {
            if (fill.side === 'BUY') {
                quantity += fill.size; cost += fill.size * fill.price;
                bought += fill.size; purchaseCost += fill.size * fill.price;
            } else {
                sold += fill.size; saleProceeds += fill.size * fill.price;
                if (fill.size > quantity + EPS) missingInventory = true;
                const matched = Math.min(quantity, fill.size);
                const basis = quantity > EPS ? cost / quantity * matched : 0;
                const pnl = matched * fill.price - basis;
                salePnl += pnl;
                sales.push({ month: month(fill.timestamp), pnl });
                quantity = Math.max(0, quantity - fill.size);
                cost = Math.max(0, cost - basis);
            }
        }
        const live = livePositions?.find(p => String(p.asset) === String(first.asset));
        const inventoryMismatch = !resolved && livePositions !== null && Math.abs(quantity - Number(live?.size ?? 0)) > Math.max(.01, quantity * .0001);
        const usable = !missingInventory && !inventoryMismatch;
        const mark = resolved ? (token.winner ? 1 : 0) : number(live?.curPrice) ? live.curPrice : number(token?.price) ? token.price : null;
        const settlementPnl = resolved ? quantity * mark - cost : 0;
        const unrealized = resolved || quantity <= EPS ? 0 : mark === null ? null : quantity * mark - cost;
        const realized = usable ? salePnl + settlementPnl : null;
        if (usable) {
            for (const sale of sales) addMonth(sale.month, sale.pnl, 'saleRealizedPnl');
            if (resolved && quantity > EPS) addMonth(settlementMonth, settlementPnl, 'settlementRealizedPnl');
        }
        const avgPrice = bought ? purchaseCost / bought : null;
        const total = usable && unrealized !== null ? realized + unrealized : null;
        positions.push({
            conditionId: first.conditionId, asset: String(first.asset), title: market?.question ?? first.title ?? '', outcome: token?.outcome ?? first.outcome ?? '',
            category: categoryOf(market), priceBucket: avgPrice === null ? 'unknown' : priceBucket(avgPrice), averageBuyPrice: rounded(avgPrice),
            buys: bought, sells: sold, purchaseCost: rounded(purchaseCost), saleProceeds: rounded(saleProceeds), reconstructedShares: rounded(quantity), remainingCostBasis: rounded(cost),
            status: resolved ? 'resolved' : quantity <= EPS ? 'sold' : 'open', winner: resolved ? token.winner === true : null,
            markPrice: mark, markSource: resolved ? 'CLOB resolution' : live && number(live.curPrice) ? 'Data API position' : mark !== null ? 'CLOB token' : null,
            saleRealizedPnl: usable ? rounded(salePnl) : null, settlementRealizedPnl: usable ? rounded(settlementPnl) : null,
            realizedPnl: rounded(realized), unrealizedPnl: usable ? rounded(unrealized) : null, totalPnl: rounded(total),
            costBasisComplete: usable, costBasisScope: 'observed trades only', lifetimeCostBasisVerified: false,
            historyMayBeMissing: Boolean(coverage.truncated), touchesHistoryBoundary: Boolean(coverage.truncated && first.timestamp === earliestTimestamp), sameSecondOrderingAssumed,
            settlementAt: resolved ? settlementAt : null, settlementTimeSource: resolved && settlementAt ? 'Gamma market closedTime, not cash redemption' : null, missingInventory, inventoryMismatch, officialCurrentShares: livePositions !== null ? Number(live?.size ?? 0) : null,
            metadataAvailable: Boolean(market), firstTradeAt: new Date(first.timestamp * 1000).toISOString(), lastTradeAt: new Date(fills.at(-1).timestamp * 1000).toISOString(),
        });
    }
    const closed = positions.filter(p => p.costBasisComplete && ['resolved', 'sold'].includes(p.status));
    const grouped = field => {
        const output = {};
        for (const p of closed) {
            const key = p[field];
            output[key] ??= { positions: 0, profitable: 0, losing: 0, breakeven: 0, realizedPnl: 0 };
            const item = output[key]; item.positions++; item.realizedPnl += p.realizedPnl;
            if (p.realizedPnl > EPS) item.profitable++; else if (p.realizedPnl < -EPS) item.losing++; else item.breakeven++;
        }
        return Object.fromEntries(Object.entries(output).map(([key, item]) => [key, { ...item, realizedPnl: rounded(item.realizedPnl), winRate: item.profitable / item.positions }]));
    };
    const incomplete = positions.filter(p => !p.costBasisComplete);
    const unpriced = positions.filter(p => p.costBasisComplete && p.unrealizedPnl === null);
    const sum = field => rounded(positions.reduce((n, p) => n + (p[field] ?? 0), 0));
    const known = sum('realizedPnl') + sum('unrealizedPnl');
    return {
        positions,
        summary: { positions: positions.length, invalidTrades, excludedPositions: incomplete.length, unpricedPositions: unpriced.length,
            resolvedPositions: positions.filter(p => p.status === 'resolved').length, losingResolvedPositions: positions.filter(p => p.status === 'resolved' && p.totalPnl < 0).length,
            realizedPnl: sum('realizedPnl'), unrealizedPnl: unpriced.length ? null : sum('unrealizedPnl'), knownPnl: rounded(known),
            reconstructedGrossPnl: coverage.truncated || incomplete.length || unpriced.length || invalidTrades ? null : rounded(known),
            completedPositions: closed.length, winRate: closed.length ? closed.filter(p => p.realizedPnl > EPS).length / closed.length : null },
        winRateByPriceBucket: grouped('priceBucket'), winRateByCategory: grouped('category'),
        monthlyPnl: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)).map(row => ({ ...row, saleRealizedPnl: rounded(row.saleRealizedPnl), settlementRealizedPnl: rounded(row.settlementRealizedPnl), realizedPnl: rounded(row.saleRealizedPnl + row.settlementRealizedPnl) })),
    };
}
