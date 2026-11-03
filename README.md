# Off Ramp

Shows someone what prediction markets have cost them across Polymarket, Kalshi, Robinhood, Coinbase, Webull and anything else, then walks them through self-excluding from each one.

- polymarket.com wallets fill in from Polymarket's public Data API v2: deposits and withdrawals, open position value, Polymarket's own all-time PnL, and every finished bet (settled, sold or combo) from its positions.
- Other platforms are typed in by hand. Nothing leaves the browser except the Polymarket lookup.
- The user guesses their number before seeing it, and the helpline is on screen the whole time.

```bash
npm install
npm run dev    # http://localhost:3000
npm test
```

The live site is a Vercel deployment served at offramp.omray.dev through the Cloudflare Worker in `edge/` (`cd edge && npx wrangler deploy`).
