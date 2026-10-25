---
layout: ../../layouts/Article.astro
section: guides
title: "How to read a game's price history before you buy"
description: "A price chart shows what a game really cost, not what the badge says. Here is what to look at, what trackers cannot tell you, and a real example from our data."
updated: 2026-10-25
image: /og/how-to-read-game-price-history.png
imageAlt: "Chart of one real game's price on GOG from October 5 to October 25, 2026: the crossed-out price stays at $39.99 and the sale price stays at $5.99 in all 15 readings, with a gap between October 7 and October 13."
---

A price history is the simplest way to check a discount. It shows what a game cost last month and last year, so you do not have to trust the number on the badge. But a chart can also mislead you if you do not know what it is made of.

This guide shows what to look at on a price chart, what the chart cannot tell you, and what a short history looks like in real data.

<figure style="margin: 0 0 24px;">
<svg viewBox="0 0 520 300" role="img" aria-labelledby="hist-title hist-desc" style="display:block;width:100%;height:auto;font-family:var(--font-body);">
<title id="hist-title">One game's price on GOG, October 5 to 25, 2026</title>
<desc id="hist-desc">The crossed-out price stays at $39.99 and the sale price stays at $5.99 in all 15 readings. There are no readings between October 8 and October 12.</desc>
<rect x="0.5" y="0.5" width="519" height="299" rx="14" style="fill:var(--panel);stroke:var(--border);"/>
<text x="24" y="34" font-size="16" style="fill:var(--muted);">Control Ultimate Edition on GOG, our readings</text>
<line x1="60" y1="80" x2="496" y2="80" stroke-width="3" stroke-dasharray="8 6" style="stroke:var(--badge);"/>
<text x="70" y="68" font-size="15" font-weight="700" style="fill:var(--text);">Crossed-out price: $39.99</text>
<text x="50" y="85" font-size="14" text-anchor="end" style="fill:var(--muted);">$40</text>
<line x1="60" y1="270" x2="496" y2="270" style="stroke:var(--border);"/>
<text x="50" y="275" font-size="14" text-anchor="end" style="fill:var(--muted);">$0</text>
<rect x="125" y="96" width="87" height="170" rx="6" fill="none" stroke-dasharray="4 4" style="stroke:var(--border);"/>
<text x="168" y="150" font-size="13" text-anchor="middle" style="fill:var(--muted);">no readings</text>
<text x="168" y="168" font-size="13" text-anchor="middle" style="fill:var(--muted);">Oct 8 to 12</text>
<line x1="60" y1="241.5" x2="103.6" y2="241.5" stroke-width="3" style="stroke:var(--accent-text);"/>
<line x1="234.4" y1="241.5" x2="496" y2="241.5" stroke-width="3" style="stroke:var(--accent-text);"/>
<g style="fill:var(--accent-text);">
<circle cx="60" cy="241.5" r="4"/><circle cx="103.6" cy="241.5" r="4"/><circle cx="234.4" cy="241.5" r="4"/><circle cx="256.2" cy="241.5" r="4"/><circle cx="278" cy="241.5" r="4"/><circle cx="299.8" cy="241.5" r="4"/><circle cx="321.6" cy="241.5" r="4"/><circle cx="343.4" cy="241.5" r="4"/><circle cx="365.2" cy="241.5" r="4"/><circle cx="387" cy="241.5" r="4"/><circle cx="408.8" cy="241.5" r="4"/><circle cx="430.6" cy="241.5" r="4"/><circle cx="452.4" cy="241.5" r="4"/><circle cx="474.2" cy="241.5" r="4"/><circle cx="496" cy="241.5" r="4"/>
</g>
<text x="270" y="222" font-size="15" font-weight="700" style="fill:var(--accent-text);">Sale price: $5.99 in all 15 readings</text>
<text x="60" y="290" font-size="13" style="fill:var(--muted);">Oct 5</text>
<text x="496" y="290" font-size="13" text-anchor="end" style="fill:var(--muted);">Oct 25</text>
</svg>
<figcaption style="margin-top:8px;font-size:13px;color:var(--muted);">Real readings from our own price history (data/history.json). Each dot is one day we checked. Only 20 days are covered, so this says nothing about the price last year.</figcaption>
</figure>

## The short version

- **Look at the shape, not the badge.** What matters is the price people really paid before the sale, and how often the game drops.
- **A short history is a weak history.** Our own record for the game above is 15 readings over 21 days. That is enough to see a flat sale price, not enough to call it a bargain.
- **Trackers are not the same.** They differ in which stores, regions and currencies they follow, and gaps are normal.

## What a price chart shows

Most charts draw two things: the price you would pay, and a reference ("was" or "regular") price. The first question is whether the reference price was ever the real price. Steam's developer rules help here. Steamworks says Steam aims to post discounts "in reference to a base price that has been in place for at least 30 days." It also says a product "cannot be discounted within 30 days of another discount" and that a discount "cannot run shorter than 1 day or longer than 14 days".

In plain words, on Steam a sale is limited in length and cannot be repeated straight away. If a chart shows a game on sale again and again with only short breaks, look at whether the stores involved are all on Steam or not: other stores set their own rules.

Steamworks also states that "Decreasing a product's base price doesn't generate a 30-day cooldown on future discounts." So a price cut that is not labelled as a sale is a price change too. On a chart it looks like a step down that stays, not a dip that returns. Do not mistake it for a sale.

## Read it in four steps

1. **Find the usual price.** Look at the long flat parts of the line. That is the price the game normally has, not the crossed-out number.
2. **Count the dips.** How many times did it drop, how deep, and for how long? A game that dips every few weeks to the same price will probably dip again.
3. **Check where the current price sits.** Compare it with the lowest point and with the usual price. A sale at the same level as the last three sales is a normal sale, not a rare one.
4. **Check the line is about your case.** Same edition, same store type, same currency.

## What a chart cannot tell you

**How long the history is.** A tracker only knows what it recorded. SteamDB says its lowest price is "whatever price the Steam API returns as lowest", and that older data for some regions comes from another site, IsThereAnyDeal, for US, UK and EU regions before 2016. A "lowest price" is the lowest the tool saw, not a fact about the whole market.

**Which region and currency.** SteamDB says some regions use aggregated USD pricing, and the flag on its page shows the country the data was read for. Steamworks says discounts "may display differently to customers in different parts of the world, per local laws". If you pay in another currency, a chart in dollars may not match your price.

**Gaps.** In our own record of the game above there are no readings between October 8 and October 12. We did not store those days, so a short change in that window would not show up. Check that a chart has no big holes before you trust a "never cheaper" claim.

**Bundles and keys.** SteamDB notes that a cheaper bundle with a higher discount is often the reason a price looks wrong. A chart of one store's price will not show a key sold elsewhere, and its price can come with other conditions. See our [guide to Steam keys from resellers](/guides/steam-key-reseller-risks/).

## An example from our own data

We track GOG prices once a day. For Control Ultimate Edition our file has 15 readings from October 5 to October 25, 2026. The price is $5.99 and the crossed-out price is $39.99 in every one of them. That is a flat line.

What we can say: during these three weeks the price did not move. What we cannot say: what it cost before October 5, or whether it will be lower next month. We do not call it "the lowest ever", because we have no way to know. Prices and sale end dates change, so check the store page.

## Before you buy, ask

- How long does this chart go back, and does it have gaps?
- Is the current price different from the last sale, or the same?
- Is the chart for my region, currency and edition?
- Would I buy it at this price if there was no badge at all?

## What we did not check

We could not open the pages of gg.deals (the server refused our request) or IsThereAnyDeal (the page was not found), so we say nothing about how they work. We did not read the legal text on price reductions for this guide. The rules above are Steam's rules for developers, and other stores have their own. We did not check how often Steam games actually follow the 30-day base price aim.

## How we handle this

Some store links elsewhere on our site are affiliate links, and we mark them clearly. This guide has none, and it is written from the sources listed below and from our own price file. Read [how affiliate links work on our site](/disclosure/).

## Sources

- [Steamworks documentation: Discounting](https://partner.steamgames.com/doc/marketing/discounts)
- [SteamDB: FAQ](https://steamdb.info/faq/)

Pages were read on October 25, 2026. Rules and prices can change, so check the source pages for the current wording.
