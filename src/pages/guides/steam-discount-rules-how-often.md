---
layout: ../../layouts/Article.astro
section: guides
title: "How often can a Steam game go on sale? The discount rules, and what they mean for waiting"
description: "Steam has written rules on how deep and how long a discount can be, and how soon a game can be discounted again. Here is what they say and how to use them."
updated: 2026-11-03
image: /og/steam-discount-rules-how-often.png
imageAlt: "Diagram of Steam discount limits from Steamworks documentation: a standard discount is between 10% and 95%, runs 1 to 14 days, and a game cannot be discounted within 30 days of another discount, its release or a price increase. No game prices are shown."
---

Every buyer who waits for a sale asks the same thing: when will it be cheaper, and how often does that happen? Steam does not publish a sale date for each game, but it does publish the rules that developers must follow. Those rules tell you a lot about what is possible and what is not.

This guide goes through what Valve's Steamworks documentation says about the size, length and spacing of discounts. It is written for buyers, so we only keep the parts that change how you shop.

## The short version

- **A standard Steam discount is between 10% and 95%** and runs from 1 to 14 days. A "-99%" on a normal Steam sale would be outside those rules.
- **After a discount, a game generally cannot be discounted again for 30 days.** Seasonal sales are the documented exception to this spacing.
- **A new game cannot be discounted for 30 days after release,** and a price increase starts a new 30-day wait. The launch discount is the allowed exception.
- **Waiting costs little in most cases, but it is not a promise.** Participation in promotions is optional for developers.

## How deep and how long

The Steamworks discounting page says: "It's not possible to discount a product by less than 10% or more than 95%." It also says: "Discounts cannot run shorter than 1 day or longer than 14 days." Weeklong Deals, a promotion type, "run for 7 days."

A second limit comes from the price itself. The Steamworks pricing page says a product at the $0.99 tier could discount up to 50%, and a product at the $4.99 tier up to 90%. If a discount would take the price below the minimum, the product "won't be purchasable" in countries where the end price is below that floor, per the same page.

What this means for you: a very cheap game cannot have a very deep percentage. If a $1 game is only "50% off", that is not stinginess, it is the floor.

<figure>
<svg viewBox="0 0 640 230" role="img" aria-labelledby="rules-title rules-desc" style="max-width:100%;height:auto">
<title id="rules-title">Steam standard discount limits</title>
<desc id="rules-desc">Three boxes: depth from 10% to 95%, length from 1 to 14 days, and a 30-day wait between discounts, after release and after a price increase. No game prices are shown.</desc>
<rect x="20" y="20" width="190" height="90" rx="12" fill="var(--panel)" stroke="var(--accent-text)" />
<text x="115" y="58" text-anchor="middle" fill="var(--muted)" font-size="16">Depth</text>
<text x="115" y="88" text-anchor="middle" fill="var(--heading)" font-size="22">10% to 95%</text>
<rect x="225" y="20" width="190" height="90" rx="12" fill="var(--panel)" stroke="var(--accent-text)" />
<text x="320" y="58" text-anchor="middle" fill="var(--muted)" font-size="16">Length</text>
<text x="320" y="88" text-anchor="middle" fill="var(--heading)" font-size="22">1 to 14 days</text>
<rect x="430" y="20" width="190" height="90" rx="12" fill="var(--panel)" stroke="var(--badge)" />
<text x="525" y="58" text-anchor="middle" fill="var(--muted)" font-size="16">Gap</text>
<text x="525" y="88" text-anchor="middle" fill="var(--heading)" font-size="22">30 days</text>
<rect x="20" y="130" width="600" height="80" rx="12" fill="var(--panel)" stroke="var(--border)" />
<text x="320" y="165" text-anchor="middle" fill="var(--text)" font-size="17">The 30-day wait applies after another discount,</text>
<text x="320" y="190" text-anchor="middle" fill="var(--text)" font-size="17">after release, and after a price increase</text>
</svg>
<figcaption>Steam's standard discount limits, as described in Steamworks documentation. No game prices are shown.</figcaption>
</figure>

## How soon it can happen again

The same page lists three 30-day cooldowns:

- "A product cannot be discounted for 30 days following its release."
- "A product cannot be discounted for 30 days following a price increase."
- "A product cannot be discounted within 30 days of another discount."

The pricing page adds that a price increase in one or more currencies starts the 30-day cooldown on submitting discounts.

There is one important exception for the spacing rule. Seasonal Sales are exempt from the 30-day discount cooldown, but the page notes they are "only exempt from 30-Day Discount Cooldowns", so the release and price-increase waits still apply. Launch discounts are capped at 40% and run 7 to 14 days.

So if a game had a discount that just ended, a custom discount of its own is unlikely within the next month. A big seasonal event is the more likely next chance. Our guide on the [Steam sale calendar](/guides/steam-wishlist-and-sale-calendar/) covers when those events usually fall.

## What the rules do not say

The rules set limits, not a schedule. Steamworks says participation in promotions is optional, and curated promotions are generally limited to once per calendar year with at least three months between them. A game can also be featured "with any discount, or even with no discount at all."

Two practical effects:

- A developer may never discount a game for a long time, even if the rules allow it.
- A price cannot be changed during an active discount: "It's not possible to increase or decrease the base price of a product during an active discount." So a price jump right before a sale, within the same discount, is not something the tool allows. A price increase before the discount is scheduled is a separate matter, and it triggers the 30-day wait above.

Also remember that discounts "may display differently to customers in different parts of the world", per the Steamworks FAQ. The discounted price applies even where the old price is not shown with a strikethrough. For why a price differs by country at all, see [why a PC game costs a different amount in each country](/guides/why-game-prices-differ-by-country/).

## Five checks when you decide to wait

1. **Look at when the last discount ended.** If it ended days ago, another custom discount in the next 30 days is not expected, except in a Seasonal Sale.
2. **Check the release date.** A game under 30 days old generally has no discount except a launch one, which is capped at 40%.
3. **Look at the percentage against the price tier.** A cheap game can have a shallow maximum.
4. **Add the game to your wishlist.** Steamworks says a discount of 20% or more automatically triggers email notifications to wishlisters.
5. **Decide what the game is worth to you now.** The rules say what can happen, not what will.

## What we did not check

- We did not open Steam's own help pages for buyers; they would not load for our tools, so nothing here comes from them.
- We did not check how EU rules on showing the previous price affect the display; the pages we read do not cover it.
- We did not check the rules of other stores such as GOG or Epic.
- These pages are written for developers. Valve may make exceptions that are not described in them.

## How we handle this

Some of the store links on our site are affiliate links, and we mark them clearly. This guide contains no affiliate links, and it is written from the sources listed below, not from our commission. Read [how affiliate links work on our site](/disclosure/).

## Sources

- [Steamworks documentation: Discounting](https://partner.steamgames.com/doc/marketing/discounts)
- [Steamworks documentation: Pricing](https://partner.steamgames.com/doc/store/pricing)

Pages were read on November 2, 2026. Steam's rules can change, so check the source pages for the current text.
