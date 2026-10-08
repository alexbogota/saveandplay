---
layout: ../../layouts/Article.astro
section: guides
title: "How to tell a real game discount from a fake one"
description: "A big red percentage does not tell you that a game is cheap. Here is what the official rules say about sale prices, and a five-question check to run before you buy."
updated: 2026-10-06
image: /og/real-vs-fake-game-discounts.png
imageAlt: "Chart of one game's price over six months. The \"was\" price on the badge is $60 but the game was really sold at $30 the whole time, so a \"-50%\" sale saves nothing. Invented numbers, for illustration only."
---

"-75%" looks great. But a discount is only a comparison, and a comparison is only as honest as the price it compares to. Before you click buy, it is worth taking thirty seconds to check what that number is measured against.

## Why the percentage alone means nothing

Imagine a game that is listed at $60 but has really sold for $30 for months. A "50% off" sale at $30 saves you nothing. The number on the badge is correct, the saving is not. This is an invented example, but it shows the trick: the "was" price is what makes the discount look big.

<figure style="margin: 0 0 24px;">
<svg viewBox="0 0 520 300" role="img" aria-labelledby="fake-sale-title fake-sale-desc" style="display:block;width:100%;height:auto;font-family:var(--font-body);">
<title id="fake-sale-title">A fake discount: the real price never changed</title>
<desc id="fake-sale-desc">A chart of one game's price over six months. The "was" price on the badge is $60, but the game was really sold at $30 the whole time. A "50% off" sale at $30 saves nothing.</desc>
<rect x="0.5" y="0.5" width="519" height="299" rx="14" style="fill:var(--panel);stroke:var(--border);"/>
<text x="24" y="34" font-size="16" style="fill:var(--muted);">One game's price over 6 months</text>
<line x1="60" y1="80" x2="496" y2="80" style="stroke:var(--border);"/>
<line x1="60" y1="190" x2="496" y2="190" style="stroke:var(--border);"/>
<line x1="60" y1="270" x2="496" y2="270" style="stroke:var(--border);"/>
<text x="50" y="85" font-size="14" text-anchor="end" style="fill:var(--muted);">$60</text>
<text x="50" y="195" font-size="14" text-anchor="end" style="fill:var(--muted);">$30</text>
<text x="50" y="275" font-size="14" text-anchor="end" style="fill:var(--muted);">$0</text>
<line x1="60" y1="80" x2="496" y2="80" stroke-width="3" stroke-dasharray="8 6" style="stroke:var(--badge);"/>
<text x="70" y="68" font-size="15" font-weight="700" style="fill:var(--text);">&ldquo;Was&rdquo; price on the badge: $60 (never charged)</text>
<line x1="60" y1="190" x2="496" y2="190" stroke-width="5" stroke-linecap="round" style="stroke:var(--accent-text);"/>
<text x="70" y="216" font-size="15" font-weight="700" style="fill:var(--accent-text);">Real price: $30, for months</text>
<rect x="372" y="104" width="124" height="44" rx="10" style="fill:var(--badge);"/>
<text x="434" y="134" font-size="22" font-weight="800" text-anchor="middle" style="fill:var(--on-badge);">-50%</text>
<text x="434" y="168" font-size="14" text-anchor="middle" style="fill:var(--muted);">saves you $0</text>
<text x="60" y="290" font-size="13" style="fill:var(--muted);">6 months ago</text>
<text x="496" y="290" font-size="13" text-anchor="end" style="fill:var(--muted);">today</text>
</svg>
<figcaption style="margin-top:8px;font-size:13px;color:var(--muted);">Invented numbers, for illustration only.</figcaption>
</figure>

The good news is that the big platforms and the law put some limits on this.

## What the official rules say

**On Steam,** the developer rules in Steamworks set these limits:

- A discount cannot run shorter than 1 day or longer than 14 days.
- A product cannot be discounted within 30 days of another discount.
- A product cannot be discounted for 30 days following a price increase in any currency.
- A discount must be between 10% and 95%. Launch discounts cannot exceed 40%.
- The base price cannot be changed during an active discount, or while one is scheduled.

In plain words: on Steam, a publisher cannot raise the price today and put it on a big sale tomorrow, and the "was" price cannot be changed in the middle of a sale. These rules are for developers selling on Steam. Other stores have their own rules.

**In the EU,** consumer law (Directive 2019/2161) says that when a seller announces a price reduction, the prior price is the lowest price the seller applied during a period of not less than 30 days before the reduction. Member states can set different rules for some cases, such as goods that spoil quickly or products on the market for less than 30 days. Rules also differ between countries, so this is a general picture, not legal advice.

Neither set of rules tells you that a game is at its lowest price ever. They only make the "was" price harder to fake.

## Five questions to ask before you buy

1. **What is the regular price, and has it been that for a while?** If the game was never sold at the "was" price, the discount is decoration. A price-history tracker shows how the price moved over time.
2. **Is it the same edition?** A "Deluxe" or "Ultimate" edition with extra content is not comparable to the standard one. Compare like with like, including DLC.
3. **What does it cost in other stores?** Check two or three legitimate stores. The same game can be cheaper elsewhere, even during a sale.
4. **Will it work for you?** Check the currency, the region and where the key activates (Steam, GOG, another launcher). A cheap key that does not activate in your country is not cheap.
5. **Do you really want it?** A sale makes you want things you did not plan to play. Steam allows refunds within two weeks of purchase if you have played the game for less than two hours, which is useful for a game you are unsure about. Other stores have their own refund rules, so read them before you buy.

## A note on bundles

A bundle can be a great deal or a way to sell you games you will never open. Add up only the games you would actually play at the price you would pay for them alone. If that already covers the bundle price, the rest is a bonus. If not, the "value" printed on the bundle is just a big number.

## How we handle this

We show the sale price with the date we checked it, and we do not claim "lowest price ever". We do not have enough price history for that yet. When we have tracked a game for long enough, we will say "lowest price we have tracked" and mean it. Some of the store links on our site are affiliate links, which we mark clearly. Read [how that works](/disclosure/), or look at the [current deals](/deals/) and run the five questions on them yourself.

## Sources

- [Steamworks documentation: Discounting](https://partner.steamgames.com/doc/marketing/discounts)
- [Steam: Game refund conditions](https://store.steampowered.com/steam_refunds/)
- [EUR-Lex: Directive (EU) 2019/2161, price indication for price reductions](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32019L2161)

Rules were read on October 6, 2026. They can change, so check the source pages for the current wording.
