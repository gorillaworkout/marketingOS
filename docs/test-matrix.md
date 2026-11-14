# MarketingOS test matrix

This is the coverage map for the feature set on `main` after Keyword Gap. “Tested” means a unit, route-source, or Postgres test locks the behavior. It does not mean a live browser session or a live model call.

## Suite

CI on every pull request runs `npx tsx --test tests/*.test.ts` against Postgres 16. Postgres tests skip when `SETTLEMENT_TEST_DATABASE_URL` is unset. `npm run build` is the typecheck. Live LLM, image, Search Console, Semrush, DataForSEO, and GA4 calls are mocked or not run.

## Features

| Feature | What is tested | What is not tested here |
| --- | --- | --- |
| Auth and department access | Session gate, admin API prefixes, member block on each feature path, SEO and report prefixes | A full browser login |
| Social Post v2 | Brief, hashtags, brand voice, campaigns, competitor reference, caption analyzer (hashtags inside the caption count), key-message paraphrase, verified-claim guard, prompt caps, auth-expiry failover notice | A live Generate click |
| Video Script v2 | Format prefill, storyboard PDF (`%PDF`) and zip | A live image render |
| Event Plan v2 | Venue, speakers, quotation parsing, budget totals, and confirmed totals replacing “No public price found” | A live quotation upload in the browser |
| Market News topics | Symbol map, informational research-fallback notice, and the article stream keepalive | A live article |
| Content Studio v2 | Meta limits, headings, tables, HTML export used for ICA drafts, Dupoin as the default site unless a saved site is chosen | A live draft against the model |
| SEO Website Audit | Crawl bounds, robots, score, PageSpeed parser, 429 quota stop, private-address and redirect checks | A live crawl of dupoin.co.id |
| Keyword Gap beta | Buckets, GSC CSV, phrase extraction, provider parsers, stored-query source, Dupoin upload message when ICA is the only synced site, past-run refresh when a job finishes | A live Semrush or DataForSEO call |
| AI models | Dupoin failure falls over to OpenRouter; 401 and a 503 that wraps a 401 fail over immediately with an auth notice and a 15-minute cooldown; Auth expired also comes from a stored 401 or OAuth error | A live gateway |
| AI Research | Chat parsing, memory, PDF/DOCX/HTML attachments, pin and watches, health route | A live chat |
| Knowledge | Pin save, graph focus | A live graph layout |
| Onboarding Reports | Metrics and docx export | A live upload of a production workbook |
| Settlement Report | Store, xlsx, docx, and HTML export | A live CRM file |
| Accounts and departments | Feature list and the Accounts client composition | Creating a user in a browser |
| Migrations 052–056 | Each script applies twice and the chain rolls back on Postgres | Applying them to production |

## Gaps left on purpose

- No test calls a paid model, PageSpeed, Semrush, or DataForSEO.
- Search Console sync is not run against Google. The Keyword Gap source test checks the schema: Dupoin is seeded without a property, so `seo_gsc_daily` starts empty for that site.
- The print view for Settlement is a print layout, not the shared dashboard header.
- Browser click-through of the signed-in app needs the app database, which this environment does not have.
