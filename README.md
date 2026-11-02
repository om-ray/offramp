# Off Ramp

Shows someone what prediction markets have cost them across Polymarket, Kalshi, Robinhood, Coinbase, Webull and anything else, then walks them through self-excluding from each one.

- Polymarket fills in from the public data API: deposits and withdrawals, open position value, Polymarket's own all-time PnL, and bet-by-bet wins and losses for the last ~10,000 trades.
- Other platforms are typed in by hand. Nothing leaves the browser except the Polymarket lookup.
- The user guesses their number before seeing it, and the helpline is on screen the whole time.

```bash
npm install
npm run dev    # http://localhost:3000
npm test
```
