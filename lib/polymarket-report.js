import { CLOB, DATA, GAMMA, fetchTrades, getJson, mapLimit, resolveWallet } from './polymarket-api.js';
import { reconcile } from './polymarket-reconcile.js';

export function validateInput(input) {
    if (!input || typeof input.wallet !== 'string' || input.wallet.trim().length < 2 || input.wallet.length > 100) throw new Error('wallet must be a public username or 0x wallet address');
    const maxTrades = input.maxTrades ?? 10500;
    if (!Number.isInteger(maxTrades) || maxTrades < 1 || maxTrades > 10500) throw new Error('maxTrades must be an integer from 1 to 10500');
    return { wallet: input.wallet.trim(), maxTrades };
}

export async function buildReport(rawInput, request = getJson) {
    const input = validateInput(rawInput);
    const wallet = await resolveWallet(input.wallet, request);
    const { trades, coverage } = await fetchTrades(wallet, input.maxTrades, request);
    const errors = [];
    const optional = async (label, base, path, params) => {
        try { return await request(base, path, params); }
        catch (error) { errors.push({ source: label, error: error.message }); return null; }
    };
    const [profile, leaderboard, value, live] = await Promise.all([
        optional('profile', GAMMA, '/public-profile', { address: wallet }),
        optional('official-all-time-leaderboard', DATA, '/v1/leaderboard', { user: wallet, timePeriod: 'ALL', category: 'OVERALL', limit: 1 }),
        optional('official-position-value', DATA, '/value', { user: wallet }),
        (async () => {
            const rows = [];
            for (let offset = 0; offset <= 10000; offset += 500) {
                const page = await optional('current-positions', DATA, '/positions', { user: wallet, limit: 500, offset, sizeThreshold: 0 });
                if (!Array.isArray(page)) { if (page !== null) errors.push({ source: 'current-positions', error: 'Expected an array' }); return null; }
                rows.push(...page);
                if (page.length < 500) return rows;
            }
            errors.push({ source: 'current-positions', error: 'Pagination cap reached; current inventory reconciliation unavailable' });
            return null;
        })(),
    ]);
    const conditionIds = [...new Set(trades.map(t => t.conditionId).filter(Boolean))];
    const entries = await mapLimit(conditionIds, 8, async conditionId => {
        const market = await optional(`market:${conditionId}`, CLOB, `/markets/${encodeURIComponent(conditionId)}`, {});
        if (market?.closed === true && market.tokens?.some(token => token.winner === true)) {
            const gamma = await optional(`market-close-time:${conditionId}`, GAMMA, '/markets', { condition_ids: conditionId });
            const metadata = Array.isArray(gamma) ? gamma.find(row => row.conditionId === conditionId) : null;
            if (metadata?.closedTime) market.closedTime = metadata.closedTime;
        }
        return [conditionId, market];
    });
    const markets = Object.fromEntries(entries);
    const calculated = reconcile(trades, markets, live, coverage);
    const unmatchedLivePositions = live?.filter(p => !calculated.positions.some(q => String(p.asset) === q.asset)) ?? [];
    const timestamps = trades.map(t => t.timestamp).filter(Number.isFinite);
    return {
        schemaVersion: 1, generatedAt: new Date().toISOString(), wallet, input,
        coverage: { ...coverage, tradeCount: trades.length, marketCount: conditionIds.length,
            earliestTradeAt: timestamps.length ? new Date(Math.min(...timestamps) * 1000).toISOString() : null,
            latestTradeAt: timestamps.length ? new Date(Math.max(...timestamps) * 1000).toISOString() : null,
            availableMarketCount: entries.filter(([, m]) => m !== null).length,
            currentPositionsAvailable: live !== null, unmatchedCurrentPositionCount: unmatchedLivePositions.length,
            accountPnlComplete: false },
        accounting: {
            method: 'Average-cost observed-trade reconstruction; sales plus residual resolution payout minus purchase cost.',
            units: 'USD-equivalent collateral, before fees and rewards',
            winRateDefinition: 'Profitable completed token positions divided by completed token positions with usable cost basis. Breakeven counts in the denominator.',
            monthlyMethod: 'Sales use execution month. Settlement P&L uses Gamma closedTime, a market close timestamp rather than cash redemption. Missing close times stay in unknown-resolution-month; scheduled endDate is never substituted.',
            limitations: [
                'The public trade feed is not a full account ledger. Deposits, transfers, splits, merges, redemptions, rewards and fees are not reconstructed.',
                'Closed-positions data is not used to select trades or infer win rate; resolved losing tokens remain in the report.',
                'Resolved residual shares are valued at their settlement entitlement even if already redeemed. This is not a current cash balance.',
                'Unmatched sales or mismatched current inventory exclude that token position from P&L totals. knownPnl covers only the remaining positions.',
                'Equal-timestamp trades assume the API newest-first order reverses to execution order. Positions affected by mixed-side ties are flagged sameSecondOrderingAssumed.',
                'costBasisComplete means internally consistent observed trades only. lifetimeCostBasisVerified is always false; truncated history makes reconstructedGrossPnl null.',
                'Pagination is a live view, not an atomic snapshot. Deduplication may collapse identical fills without unique fill IDs.',
                'An exhausted trade feed means the exposed history ended, not that the account ledger is complete.',
            ],
        },
        ...calculated,
        official: { profile, allTimeLeaderboard: Array.isArray(leaderboard) ? leaderboard.find(row => row.proxyWallet?.toLowerCase() === wallet) ?? null : null, positionValue: value },
        unmatchedCurrentPositions: unmatchedLivePositions, trades, errors,
    };
}
