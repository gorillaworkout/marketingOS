# Market news topics

Article Market News topics live in `src/lib/market-news-topics.ts`. The selector on Article market news is grouped and searchable. Choosing a topic sets the article keyword and the instrument name the draft must use.

## Catalog versus research fallback

The existing market-news catalog is `MARKET_RESEARCH_SYMBOLS` in `src/lib/market-research-sources.ts` (gold as XAUUSD, WTI oil, the major FX currencies including IDR, and DJIA, SPX, and NDX). A topic is **catalog** when every mapped symbol is in that list. Publisher feeds and the open-web search the feature already runs can be tied to that symbol.

A topic is **research-fallback** when its symbol is not in that catalog. Silver (XAGUSD) and the individual US stocks are in this group. Those articles still use the same publisher-feed and open-web research. The draft is written with the research-tier model (`ai-research`) instead of the Article Market News smart-tier model. The prompt tells the model not to invent a live quote.

## Topics

| Category | Topic | Instrument name | Coverage |
|---|---|---|---|
| Metals | Gold | XAU/USD (gold) | Catalog, XAUUSD |
| Metals | Silver | XAG/USD (silver) | Research fallback, XAGUSD |
| Stocks | Tesla, Apple, Microsoft, Nvidia, Amazon, Meta, Alphabet | Company plus ticker | Research fallback |
| Stock Indices | S&P 500, NASDAQ, Dow Jones | Index name | Catalog, SPX / NDX / DJIA |
| Forex | USD/JPY, GBP/USD, EUR/USD, AUD/USD, USD/IDR | Pair name | Catalog, both currencies are in the feed list |
| Existing | Oil, Rupiah, US dollar, Wall Street | WTI, USD/IDR, USD, US stocks | Catalog |

Existing SOP phrases still work: emas, harga emas, xauusd, rupiah, dollar, dolar, wall street, minyak, and harga minyak.

Each topic adds a short prompt note. Metals and FX mention the relevant central bank. Stocks mention earnings and guidance. Indices stay index-level and are not written as one company. Gold articles must not use Antam or Pegadaian retail prices.
