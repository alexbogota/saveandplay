---
layout: ../../layouts/Article.astro
section: guides
title: "Steam bundles: what \"complete the set\" means for the price you pay"
description: "A Steam bundle's price can change if you already own some of the games. Here is what Valve's documentation says about bundle types, discounts and refunds."
updated: 2026-11-24
image: /og/steam-bundles-complete-the-set.png
imageAlt: "Diagram of a Steam bundle with a fixed discount percentage applied to each item you do not own: items you already own are crossed out and not charged, and the refund test counts the combined playtime of all items against two hours."
---

Black Friday week fills the Steam store with bundles: several games in one box, with one big discount percentage on the front. It is easy to read that number as a single fixed price. On Steam it often is not. For many bundles the price you see depends on what is already in your library.

This guide explains how Steam's own documentation describes bundles, so you know what to check before you press buy.

<figure style="margin: 0 0 24px;">
<svg viewBox="0 0 520 260" role="img" aria-labelledby="set-title set-desc" style="display:block;width:100%;height:auto;font-family:var(--font-body);">
<title id="set-title">A "complete the set" bundle charges only for items you do not own</title>
<desc id="set-desc">A bundle of three items. A fixed discount percentage is applied to each item. The item you already own is crossed out and not charged. You pay for the other two items only. For refunds, the playtime of all items in the bundle is added together and compared with two hours.</desc>
<rect x="0.5" y="0.5" width="519" height="259" rx="14" style="fill:var(--panel);stroke:var(--border);"/>
<text x="24" y="34" font-size="16" style="fill:var(--muted);">Complete the set: you pay only for what you lack</text>
<rect x="32" y="56" width="136" height="90" rx="10" fill="none" stroke-width="2" style="stroke:var(--muted);"/>
<text x="100" y="92" font-size="15" font-weight="700" text-anchor="middle" style="fill:var(--text);">Item A</text>
<text x="100" y="116" font-size="13" text-anchor="middle" style="fill:var(--muted);">already owned</text>
<line x1="44" y1="132" x2="156" y2="70" stroke-width="2" style="stroke:var(--muted);"/>
<rect x="192" y="56" width="136" height="90" rx="10" fill="none" stroke-width="2" style="stroke:var(--accent-text);"/>
<text x="260" y="92" font-size="15" font-weight="700" text-anchor="middle" style="fill:var(--text);">Item B</text>
<text x="260" y="116" font-size="13" text-anchor="middle" style="fill:var(--muted);">charged</text>
<rect x="352" y="56" width="136" height="90" rx="10" fill="none" stroke-width="2" style="stroke:var(--accent-text);"/>
<text x="420" y="92" font-size="15" font-weight="700" text-anchor="middle" style="fill:var(--text);">Item C</text>
<text x="420" y="116" font-size="13" text-anchor="middle" style="fill:var(--muted);">charged</text>
<rect x="192" y="162" width="296" height="34" rx="10" style="fill:var(--badge);"/>
<text x="340" y="184" font-size="15" font-weight="800" text-anchor="middle" style="fill:var(--on-badge);">Same % off each item you pay for</text>
<text x="32" y="228" font-size="13" style="fill:var(--muted);">Refund test: playtime of all items added together, against 2 hours</text>
</svg>
<figcaption style="margin-top:8px;font-size:13px;color:var(--muted);">Simplified from Valve's Steamworks documentation on bundles and the Steam refund page. The items are placeholders, not real prices.</figcaption>
</figure>

## The short version

- **A Steam bundle is a percentage, not a fixed price.** Valve's documentation says bundles work "by applying a discount percentage" to the items you do not already own.
- **In a "complete the set" bundle you pay only for the missing items,** and you can buy it as long as at least one item is new to you.
- **A "must purchase together" bundle is the opposite:** you can buy it only if you own none of its items.
- **Refunds treat the bundle as one purchase.** The two-hour limit counts the playtime of all items together.

## How the bundle discount is built

The Steamworks documentation (written for developers and publishers, but public) describes the rule in its "Discount Rules" section. A bundle applies a fixed percentage to the price of each item the buyer does not already own. Because the percentage is applied to current prices, the documentation says the bundle adjusts when its contents go on sale.

Two things follow for you:

- **The bundle's total moves with the games' own prices.** If one game inside is also discounted, the bundle price can drop below what it was a day earlier.
- **A high percentage does not tell you the price.** Ask what it is a percentage of. Our guide to [percent, dollars saved and price paid](/guides/percent-vs-dollars-saved/) explains why those are three different numbers.

The same page says bundles can be discounted by up to 95%. It also says a bundle is unavailable if its average item price would fall below a minimum transaction amount, so a very deep discount on very cheap games can make the bundle disappear in some countries.

## Complete the set

In the "Complete The Set" section, the documentation says the buyer pays only for the items in the bundle they do not already have, and can buy "as long as there is one or more item in the bundle they do not already have". Gifts follow the same rule: the recipient is charged only for what they lack.

What this means in practice:

- **Your own library changes the price.** Two people looking at the same bundle can see different totals.
- **Owning most of the set is fine.** If you hold two of three games, the bundle price should only cover the third, at the bundle's percentage. Check that the total shown at checkout equals what you expect.
- **The comparison you need is simple.** Take the price of the games you do not own, at their current single prices, and compare it with the bundle total. If the bundle is not lower, you gain nothing from the bundle.

## Must purchase together

The documentation describes this second type as meant for something like a base game plus one DLC or soundtrack. The customer "can purchase this bundle only if they do not already have any of the products in the bundle."

So if you own the base game, that bundle will not be offered to you at all. Buy the missing add-on on its own.

## Refunds on bundles

Steam's refund page has a section called "Refunds on Bundles". It says "You can receive a full refund for any bundle purchased on the Steam Store", under the usual conditions:

- No item from the bundle has been transferred.
- The combined playtime of all items in the bundle is under two hours.
- If a bundle includes an in-game item or DLC that is not refundable, the whole bundle may not be refundable, and Steam tells you at checkout.

That second point is the one people miss. A bundle of five games is judged as one purchase. If you play one game for three hours and never open the others, the bundle as a whole fails the test. Our guide to [how Steam refunds work](/guides/how-steam-refunds-work/) covers the 14-day and two-hour rules for a single game.

## Five checks before you buy a Steam bundle

1. **Which type is it?** Look at the bundle page and checkout total. If you own part of it, the price should have changed.
2. **What would the missing games cost alone, today?** Add them up and compare with the bundle total.
3. **Does the bundle include DLC or in-game items?** If so, read the checkout notice about refunds.
4. **Which of these games will you play in the first two hours?** The refund clock counts all of them together.
5. **Would you buy these games without the countdown?** A sale end date is a reason to decide, not a reason to buy.

## What we did not check

- **Individual bundles.** We did not open any current store bundle page, so we say nothing about whether a specific Black Friday bundle is a good price.
- **Valve's customer-facing rules for ownership.** The "complete the set" rules come from the Steamworks documentation, written for developers. The store page you see may word things differently, and Valve can change the rules.
- **Other stores.** Bundles on other stores (including Humble, whose pages are closed to our tools) work differently and are not covered here.
- **Local law.** Refund rights can differ by country. This is not legal advice.

## How we handle this

Some of the store links elsewhere on our site are affiliate links, and we mark them clearly. This guide contains none and is written from the sources listed below, not from commission. Read [how affiliate links work on our site](/disclosure/).

## Sources

- [Steamworks documentation: Bundles](https://partner.steamgames.com/doc/store/application/bundles)
- [Steam Refunds](https://store.steampowered.com/steam_refunds/)

Pages were read on November 24, 2026. Rules and prices can change, so check the current pages before you buy. This is not legal advice.
