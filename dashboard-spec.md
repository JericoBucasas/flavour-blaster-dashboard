# Multi-Channel Sales Dashboard — Replication Spec

A single-page, client-side sales dashboard for a Shopify business selling through four channels (Shopify D2C, Shopify B2B/wholesale, Amazon US, Amazon UK) into four regions (United States, Europe, United Kingdom, Australia). All data is deterministic generated sample data; no backend. Everything below describes the *behavior and design* an implementation must reproduce, independent of framework.

---

## 1. Overall layout

- **Two-pane layout**: fixed left sidebar (~240px, sticky, full height) + scrollable main content (max-width ~1360px).
- **Left sidebar** (top to bottom):
  1. Brand block: optional circular logo (36px) left of company name (editable, default "The Ledger"), tagline below in small uppercase letterspaced text (default "Multi-channel sales · USD").
  2. Double rule: 3px solid line with a 1px line 3px beneath it (newsprint masthead motif).
  3. Nav: Overview, Channels, Regions, Orders, Products, Customers, Settings — icon + label rows; active row gets accent-tinted background.
  4. Layout segmented control: "By section" / "Continuous" (continuous stacks all six report sections on one page with h2 headings; nav clicks then scroll to the section).
  5. "Needs attention" flag list: clickable alert rows (icon + short text) that jump to the relevant view.
  6. Tiny hint: "Keys: 1–6 views · C compare".
- **Main header**: uppercase letterspaced masthead row ("Sales report — all channels" / "Printed {date} · {currency} · FX {rates}"), the same double rule, then an H1 (current view title) with range subtitle, and a right-aligned control cluster.
- **Mobile (≤920px)**: sidebar becomes a top bar — nav scrolls horizontally, layout seg + keyboard hint hidden, flags wrap into a row; popovers go near-full-width fixed; wide tables and the heatmap scroll horizontally.

## 2. Visual style

- Newsprint/editorial: one serif family for everything (e.g. Source Serif 4), paper-white ground `#f3f2f2`, near-black ink `#201e1d`. No boxes/cards; hierarchy from type scale + whitespace. Tables use hairline row rules. `text-wrap: pretty`, tabular numerals for all figures.
- **Brand accent ramps** (overridable tokens): primary `#C9377E` (pink) with a 100–900 ramp; secondary `#493083` (purple) with a 100–900 ramp. Primary = interactive elements, positive deltas, bars, heatmap, default chart color. Secondary = negative/warning deltas and rates that are "bad when up".
- **Themes** (Settings): Paper, Cream, Cool mist (light) / Ink, Slate (dark). Dark themes flip the neutral + accent ramps and deepen shadows. Header has a moon/sun quick toggle (Paper ↔ Ink).
- Icons: Phosphor duotone.

## 3. Header controls

1. **Date-range picker** (button shows preset label or custom range) opening a popover with:
   - Hierarchical preset menu: Today; Yesterday; **Last** ▸ (30 minutes, 12 hours, 7/30/90/365 days, week, month, quarter, 12 months, year); **Period to date** ▸ (week/month/quarter/year to date); **Quarters** ▸ (last 4 calendar quarters); Custom range.
   - Dual-month calendar with range selection (click start, click end), prev/next month arrows, draft label, Cancel/Apply. Future dates disabled.
2. **Comparison dropdown**: No comparison / Previous period / Previous year / Previous year (match day of week — shift 364 days) / Custom (opens its own dual-month calendar for an arbitrary comparison range). Drives all deltas, dashed comparison lines, and grey comparison sparklines. Keyboard `C` toggles.
3. **CSV button**: downloads all core tables for the current range/filters as one CSV.
4. **Theme toggle** (moon/sun icon button).
5. Below the header: two filter dropdowns — **Channels** and **Regions** — multi-select checklists with color dots; button label shows "All", "N of 4", or the single selection. Region filters cross-cut channels (each channel×region cell is filtered, so e.g. Amazon UK with only US enabled shrinks to its US slice). Every number on the page respects both filters.

## 4. State & persistence

- URL hash carries: view, range (preset key or custom start/end ms), comparison mode (+ custom compare dates), layout, theme, custom accent hex — fully bookmarkable/shareable.
- localStorage (one JSON key) carries all Settings (below).
- Keyboard: 1–6 switch views, C toggles comparison.

## 5. Sample data model (deterministic)

- Seeded PRNG (e.g. mulberry32) so every load renders identical data. "Today" is a fixed date (e.g. 2026-07-24); daily records span 2025-01-01 → today.
- Per channel per day: orders = base × weekday profile × linear growth trend (~+26%/period) × month seasonality (Nov/Dec ~1.4–1.5×) × noise. Derived: sales (orders × AOV × noise), sessions (orders ÷ conversion), units, discounts, refund $ and units, COGS (from gross-margin %), on-time-fulfilled count. Net sales = gross − discounts − refunds; gross profit = net − COGS.
- Channel parameters: D2C (base 236 orders/day, AOV $88, conv 2.3%, margin 62%), B2B (31, $432, 8.2%, 47%, near-zero weekend weekday profile), Amazon US (182, $71, 11.4%, 41%), Amazon UK (74, $76, 10.8%, 38.5%, GBP native).
- Channel→region weight matrix (D2C 60/15/10/15, B2B 78/10/6/6, AmzUS 95/1/1/3, AmzUK 2/30/66/2, noised per day) produces per-day channel×region cells; regions aggregate from those.
- Per-day **hourly curve**: base 24-hour profile × weekday factor × noise, with occasional promo spikes (~5.5% of days, 1.9–3.5× for ±2h) and dips (~3%, down to ~0.2×). Used by heatmap, single-day charts, anomaly detection.
- Products: 12 SKUs (volleyball gear: balls, knee pads, jerseys, shoes, nets, carts…) with price, unit-share weight, margin, return rate, stock on hand; plus 3 dead-stock items. Wholesale accounts: 6 named clubs/academies with spend shares and reorder cadence.

## 6. Views

**Overview**: morning brief (one italic serif paragraph: yesterday's sales vs day before, biggest channel mover, conversion, aging orders, nearest stockout, month pace) · pace-to-target strip (MTD, projected month-end vs target, progress bar with "on-pace today" marker) · KPI cards (configurable set/order of: gross sales, net sales, orders, AOV, conversion, gross margin, discount rate, return rate — each with value, colored delta, dual sparkline current vs comparison) · P&L strip (Net sales − COGS = Gross profit − Ad spend − Fulfilment = Contribution, with % of net) · total-sales line chart (smooth Catmull-Rom→bezier path, area fill option, dashed comparison line, dotted day-of-week-aware forecast to month end when range ends today, hover crosshair + dots + tooltip listing each series, y-axis $ ticks, x-axis date ticks; single-day ranges switch to 24 hourly points) · two contribution tables (by channel, by region): sales + share, AOV/orders, delta %, absolute change, and a diverging center-zero bar showing each row's share of total change · **day×hour heatmap**: 7 rows (Mon–Sun) × 24 hour cells, accent-alpha fill scaled to max, order count printed in each cell, row totals column, hour labels every 3h, anomaly rings (accent ring = hours that spiked ≥1.6× a day's expected profile, grey ring = ≤0.45×; thresholds configurable), caption summarizing anomaly counts.

**Channels**: per-channel stat cards (sales, delta, share, margin, conv) · multi-line chart (one line per enabled channel) · detail table (gross, net, native currency, orders, AOV, conv, discount %, returns % — red above ceiling, margin, share bar) · **Amazon channel health** table (Buy Box %, ACoS, FBA on hand, FBA cover days, unit-session %) when an Amazon channel is enabled.

**Regions**: per-region cards (with native-currency line) · multi-line chart · detail table (USD, local, orders, AOV, daily avg, delta, share) · FX footnote.

**Orders**: KPI row (orders, units, units/order, fulfilled on time, refund value, unfulfilled + aging) · orders-over-time chart with comparison · the same heatmap · anomaly feed (5 most recent spike/dip hours with suggested cause) · recent-orders table (12 rows: Shopify `#48213`-style vs Amazon `112-XXXXXXX` ids, timestamps descending, customer names / B2B account names, channel dot, region, items, total, status tag: Fulfilled / Unfulfilled / Partially fulfilled / Refunded).

**Products**: KPI row (units, margin, return rate, active SKUs + dead count, median days of cover + low-cover count, sell-through) · top-products table (price, units, sales + delta, margin, returns — red over ceiling, stock, cover — red under threshold, share bar) · dead-stock table (no sales in range, tied-up value) · highest-return-rates table.

**Customers**: KPI row (customers, new, repeat rate, orders/customer, net sales/customer, 90-day LTV) · new-vs-returning orders chart · acquisition-cohort table (6 months: customers, repeat rate, orders/cust, 90-day LTV, revenue-retained bar) · wholesale accounts table (orders, spend, reorder cadence, status tag).

**Settings** (10 groups):
1. **Brand** — company name, tagline, logo upload (rendered as a circle; use background-image so an empty value never issues a network request).
2. **Appearance** — theme swatches (5), chart accent: Shopify-customizer-style picker (swatch circle + live hex field; popover with saturation/brightness gradient square + draggable handle, rainbow hue slider, hex input; drag updates all charts live), area-fill seg.
3. **Reporting** — reporting currency chips (USD/GBP/EUR/AUD; converts every money figure), FX rate inputs (£/€/A$ per USD) + "Fetch latest" button hitting `api.frankfurter.app` (button-initiated only; graceful "unavailable" status when blocked; manual edit switches to manual mode), fiscal-year-start month (YTD/QTD math), week start Sun/Mon (WTD/"Last week"), timezone UTC-offset (rotates heatmap hours + order timestamps).
4. **Targets & thresholds** — target basis seg (Growth % over last year / Fixed monthly $), monthly $ input, growth % input, low-stock days-of-cover, return-rate ceiling %.
5. **Channels** — per-channel row: color input, name, ad-spend % of sales, fulfilment $ per order (both feed the P&L), reorder arrows, remove (custom channels only); "Add channel" creates one with generated sample volume.
6. **Regions** — color, name, reorder.
7. **Alerts** — toggle each of the four "Needs attention" flags, unfulfilled-aging days, heatmap anomaly sensitivity (Low/Medium/High).
8. **Dashboard behavior** — default view / date range / comparison selects; Overview KPI cards checklist with reorder; table density seg (Compact tightens table padding).
9. **Data source** — Sample / CSV link / Google Sheets link radio + URL field (stored, marked as not yet wired to a parser).
10. **Housekeeping** — Export settings (JSON download), Import settings (file → save → reload), Reset all to defaults.

## 7. Semantics that must be right

- Deltas: up-arrow green/accent when good; for discount and return rates "up" is bad (secondary/warning color). No comparison mode ⇒ no deltas anywhere.
- Comparison series are resampled to the current range's point count; sparklines share a y-domain between current and comparison.
- Contribution bars: each row's (current − previous) as a share of |total change|, drawn from a center line, accent for positive / secondary for negative.
- Anomaly detection compares each individual day-hour against that weekday's expected hourly profile (so spikes survive aggregation over long ranges).
- Currency conversion applies at display time only; native-currency columns use the editable FX rates.
- All popovers close on outside click. Never use scrollIntoView (use window.scrollTo).
- Empty filter selections degrade gracefully ("No channels selected" zero line, empty tables).

## 8. Tech notes for the original implementation

- Single HTML design component; all styling inline except: font-face/body reset, dark/compact theme token overrides, and ≤920px media queries. Charts are hand-built inline SVG (860×292 viewBox + HTML overlay tick labels/tooltips); no chart library.
- Cubic-bezier smoothing: control points at ±(next − prev)/6 (Catmull-Rom conversion) — this produces the "Shopify-smooth" lines.
- Persist settings on every state change; migrate stale stored values with a version field when brand defaults change.
