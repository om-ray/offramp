export type Door = {
  id: string;
  name: string;
  what: string;
  steps: string[];
  link?: { label: string; href: string };
  message?: string;
  note?: string;
};

const supportMessage = (place: string, extra: string) =>
  `Hi, I have a gambling problem and I'm asking you to self-exclude my account from all ${place}. ${extra}Please confirm in writing when it's done and tell me how long it lasts. Please don't send me promotions about these products. Thank you.`;

export const DOORS: Door[] = [
  {
    id: "kalshi",
    name: "Kalshi",
    what: "Self-exclusion in your account settings. It can't be lifted until it runs out.",
    steps: [
      "Close or sell any open positions first. You can't sell them once the exclusion starts.",
      "On kalshi.com open the menu, then Responsible Risk Management. In the app it's under your account settings.",
      "Choose a self-exclusion and the longest term you can face.",
    ],
    link: { label: "Kalshi self-exclusion help", href: "https://help.kalshi.com/en/articles/13823789-voluntary-self-exclusion" },
    note: "This does not cover Kalshi markets you reach through Robinhood, Coinbase or Webull. Those need their own steps below.",
  },
  {
    id: "polymarket",
    name: "Polymarket",
    what: "Self-exclusion on both the US app and polymarket.com. You can still withdraw your balance.",
    steps: [
      "US app: Account, then Responsible Trading, then Self-exclusion. Pick a term (up to permanent) and confirm twice.",
      "polymarket.com: use the self-exclusion on the trust page and pick an end date. You can extend it but not lift it.",
      "Withdraw whatever balance is left.",
    ],
    link: { label: "Polymarket US trust and safety", href: "https://polymarket.us/trust" },
  },
  {
    id: "ic360",
    name: "SelfExclude (shared list)",
    what: "One sign-up that blocks you on every prediction market that has joined. Kalshi and Novig are live; Polymarket, Robinhood and others say they're coming.",
    steps: [
      "Sign up with your email and verify your ID.",
      "Pick 12 months. Terms can be extended but never shortened.",
      "Platforms turn the block on within 24 hours.",
    ],
    link: { label: "selfexclude.io", href: "https://selfexclude.io/" },
  },
  {
    id: "robinhood",
    name: "Robinhood",
    what: "The in-app setting only hides sports markets. A full block needs a request to support.",
    steps: [
      "Close any open event contract positions.",
      "In the app, open Help and contact support. Send the message below.",
    ],
    link: { label: "Robinhood event contract opt-out", href: "https://robinhood.com/us/en/support/articles/opting-out-of-event-contracts/" },
    message: supportMessage("event contract trading (prediction markets), not just sports markets", ""),
  },
  {
    id: "coinbase",
    name: "Coinbase",
    what: "The prediction markets switch can be turned back on, so ask support to exclude you and close the predictions account.",
    steps: [
      "Sell your contracts and cancel open orders.",
      "In the app, open Help and contact support. Send the message below.",
    ],
    link: { label: "Close a Coinbase predictions account", href: "https://help.coinbase.com/en/coinbase/trading-and-funding/prediction-markets/close-predictions-account" },
    message: supportMessage("prediction markets", "Please also close my predictions account. "),
  },
  {
    id: "webull",
    name: "Webull",
    what: "Ask support to opt you out of event contracts.",
    steps: ["Email support@webull.com or call +1 888-828-0618 with the message below."],
    message: supportMessage("event contracts and prediction markets", ""),
  },
  {
    id: "fanduel",
    name: "FanDuel Predicts",
    what: "FanDuel's self-exclusion covers all its products, including Predicts.",
    steps: ["Use Responsible Gaming in your FanDuel account and self-exclude for the longest term offered."],
    link: { label: "FanDuel self-exclusion", href: "https://support.fanduel.com/s/article/What-is-self-exclusion" },
  },
  {
    id: "devices",
    name: "Block it on your phone and computer",
    what: "A blocker stops the sites and apps on your devices, including ones you haven't signed up for yet.",
    steps: [
      "Gamban blocks gambling sites and apps on iPhone, Android, Mac and Windows. Michigan residents can get it free through the state.",
      "BetBlocker is free.",
      "Give the blocker's password or lock to someone you trust.",
    ],
    link: { label: "Free Gamban for Michigan residents", href: "https://www.michigan.gov/mgcb/resources/responsible-gaming/gamban" },
  },
];

export const HELPLINE = {
  label: "1-800-MY-RESET",
  number: "1-800-697-3738",
  tel: "tel:18006973738",
  sms: "sms:18006973738",
  chat: "https://www.ncpgambling.org/chat/",
};
