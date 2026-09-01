# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Flavour Blaster leadership and ecommerce or marketing operators use the dashboard to review commercial performance, investigate channel and regional changes, and understand website traffic and conversion behavior.

## Product Purpose

The dashboard combines authoritative commerce reporting from Shopify-connected sales channels with website analytics from GA4. Success means that every selected date range and supported filter is truthful to its source, clearly labelled, and useful for both fast executive review and deeper operational analysis.

## Positioning

One operational view connects Shopify D2C, Shopify B2B, Amazon US, Amazon UK, and flavourblaster.com traffic while preserving each source's reporting semantics instead of blending incompatible metrics.

## Operating Context

- n8n synchronizes Shopify and GA4 reporting data into Supabase.
- Supabase stores server-side reporting aggregates and exposes bounded snapshot functions to the Vercel API.
- The Vercel-hosted dashboard is available at `https://dashboard.flavourblaster.com/`.
- Reporting dates use Europe/London boundaries. GA4 revenue is reported in GBP.

## Capabilities and Constraints

- Shopify is authoritative for sales, orders, AOV, refunds, discounts, taxes, shipping, and margins.
- GA4 property `298253309` is authoritative for website sessions, engagement, acquisition, landing pages, device and country traffic, and GA4 ecommerce events.
- GA4 does not measure Amazon traffic and cannot divide website sessions between Shopify D2C and Shopify B2B.
- GA4 history in this dashboard begins on January 1, 2025.
- Traffic synchronization runs every six hours and re-reads recent dates so processed GA4 data can settle.
- The dashboard must never present sample or fallback figures as live data.
- Only aggregate GA4 reporting data is stored; visitor identifiers and raw events are out of scope.

## Brand Commitments

Preserve the existing Flavour Blaster dashboard identity, navigation model, typography, accent colors, compact operational density, and plain-language source labels.

## Evidence on Hand

- Existing production dashboard implementation and Shopify reporting pipeline in this repository.
- Verified GA4 property: Flavour Blaster - GA4, property ID `298253309`, measurement ID `G-M13HXTD6NW`.
- Existing live Shopify and Amazon reporting tables, workflows, API bridge, and regression tests.

## Product Principles

- Keep source authority explicit.
- Never imply precision or attribution a source cannot provide.
- Make common decisions fast without hiding operational detail.
- Preserve existing commerce behavior while adding new data sources.
- Show stale, unavailable, provisional, and not-applicable states honestly.

## Accessibility & Inclusion

New controls and reporting states must remain keyboard accessible, responsive, readable at dashboard density, and understandable without relying on color alone.
