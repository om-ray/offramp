const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
export const DATA = 'https://data-api.polymarket.com';
export const GAMMA = 'https://gamma-api.polymarket.com';
export const CLOB = 'https://clob.polymarket.com';
export const addressPattern = /^0x[0-9a-fA-F]{40}$/;

export async function getJson(base, path, params = {}, fetchImpl = fetch) {
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    let last;
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const response = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status} from ${url.pathname}`);
                error.permanent = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status);
                throw error;
            }
            const body = await response.json();
            if (body === null || typeof body !== 'object' || body.error) throw new Error(`Invalid API response from ${url.pathname}`);
            return body;
        } catch (error) {
            last = error;
            if (error.permanent) break;
            if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
        }
    }
    throw last;
}

export async function resolveWallet(identifier, request = getJson) {
    if (addressPattern.test(identifier)) return identifier.toLowerCase();
    const query = identifier.replace(/^@/, '');
    const result = await request(GAMMA, '/public-search', { q: query, search_profiles: true, limit_per_type: 20 });
    let matches = (result.profiles ?? []).filter(p => [p.name, p.pseudonym].some(n => n?.toLowerCase() === query.toLowerCase()));
    if (!matches.length) {
        const leaderboard = await request(DATA, '/v1/leaderboard', { userName: query, timePeriod: 'ALL', limit: 50 });
        if (Array.isArray(leaderboard)) matches = leaderboard.filter(p => p.userName?.toLowerCase() === query.toLowerCase());
    }
    const wallets = [...new Set(matches.map(p => p.proxyWallet?.toLowerCase()).filter(w => addressPattern.test(w)))];
    if (wallets.length !== 1) throw new Error(`Username must match one public profile exactly; found ${wallets.length}. Use its proxy wallet address instead.`);
    return wallets[0];
}

export async function fetchTrades(wallet, maxTrades = 10500, request = getJson) {
    const trades = [];
    const seen = new Set();
    const pages = [];
    let stopReason = 'maxTrades';
    let rawRows = 0;
    for (let offset = 0; offset <= 10000 && rawRows < maxTrades;) {
        const limit = Math.min(500, maxTrades - rawRows);
        let rows;
        try {
            rows = await request(DATA, '/trades', { user: wallet, limit, offset, takerOnly: false });
            if (!Array.isArray(rows)) throw new Error('Trades API did not return an array');
        } catch (error) {
            if (!trades.length) throw error;
            stopReason = 'apiError';
            pages.push({ offset, limit, error: error.message });
            break;
        }
        pages.push({ offset, limit, returned: rows.length });
        let added = 0;
        for (const trade of rows) {
            const key = JSON.stringify(['transactionHash', 'proxyWallet', 'timestamp', 'asset', 'side', 'size', 'price'].map(k => trade[k]));
            if (!seen.has(key)) { seen.add(key); trades.push(trade); added++; }
        }
        rawRows += rows.length;
        if (rows.length < limit) { stopReason = 'exhausted'; break; }
        if (!added) { stopReason = 'repeatedPage'; break; }
        offset += limit;
        if (offset > 10000) stopReason = 'apiOffsetCap';
    }
    return { trades, coverage: { stopReason, exposedHistoryExhausted: stopReason === 'exhausted', truncated: stopReason !== 'exhausted', rawRows, duplicateRowsRemoved: rawRows - trades.length, pages, takerOnly: false, offsetCap: 10000 } };
}

export async function mapLimit(values, concurrency, fn) {
    let next = 0;
    const result = new Array(values.length);
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
        while (next < values.length) { const i = next++; result[i] = await fn(values[i]); }
    }));
    return result;
}
