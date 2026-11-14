# SEO Website Audit

Website Audit is a page under SEO OS. Anyone with the `seo` feature can run it. SEO settings stay admin-only.

## Crawl

The crawler stays on the final host of the start URL. It reads robots.txt and skips disallowed paths. It does not fetch private hosts, localhost, or URLs with a username. Before every request, including each redirect hop, it resolves the hostname with DNS and refuses the hop when any address is private, loopback, link-local, CGNAT (100.64/10), unique-local, or an IPv4-mapped form of those ranges. The page cap defaults to 100 and cannot go above 200. Two pages are fetched at a time, with a short pause and a 10 second timeout. The user agent is `MarketingOS-SEO-Audit/1.0`.

Checks cover status codes, redirect chains, missing or duplicate titles and meta descriptions, title and description length, missing or multiple H1s, missing alt text, canonicals, noindex, broken internal links, thin pages, large responses, mixed content, and whether robots.txt and sitemap.xml exist.

Issues are grouped as Errors, Warnings, and Notices. The Site Health score starts at 100. Each error subtracts 4 points per URL and each warning subtracts 1, counting at most 8 URLs per issue. Notices do not change the score. The score stays between 0 and 100.

Broken internal links are links to pages this crawl actually fetched and that returned an error. A URL past the page cap is not called broken.

## Core Web Vitals

The homepage and up to four more shallow HTML pages are sent to the PageSpeed Insights API v5, once for mobile and once for desktop. The report shows LCP, INP, CLS, FCP, TTFB, and the performance score. Chrome UX Report field data is shown when the response includes it. A missing field sample is labeled "No field data".

The call works with no API key, on Google's public quota. A key is used when `PAGESPEED_API_KEY` is set on the server, otherwise when an admin has saved one in SEO settings. The saved key is encrypted with the same secret helper as other stored keys. The key is never returned to the browser and is stripped from error text.

## Indexing, Search Console, and GA4

Indexing rows come from the crawl: noindex, canonical mismatches, robots.txt blocks, pages missing from the sitemap, and orphan pages. Search Console URL Inspection and GA4 bounce rate are shown as **Not connected** cards. They do not display numbers. The cards say which access is still required. `notConnectedCards()` is the place a later provider can replace with a connected result.

## Jobs and storage

Each run is a row in `seo_audits` (migration `055_seo_website_audit.sql`). The start request returns immediately and the crawl continues in the background, updating progress on that row. A run that stops updating for 20 minutes is marked failed. One URL cannot have two active runs. Rollback: `db/rollbacks/055_seo_website_audit_down.sql`.

The page table exports as CSV or xlsx.

The prioritized fix list uses the SEO Content Studio model, which is the Smart tier. If that call fails, the audit is still saved and the summary explains the failure. The summary is not allowed to invent Search Console or analytics numbers.
