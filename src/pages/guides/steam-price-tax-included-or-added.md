---
layout: ../../layouts/Article.astro
section: guides
title: "Steam price and tax: when the checkout total matches the shelf price"
description: "On Steam, VAT is already inside the listed price, but US and Canadian sales tax is added at checkout. What Valve's own pages say, and how to check your total."
updated: 2026-11-21
image: /og/steam-price-tax-included-or-added.png
imageAlt: "Diagram with invented numbers for illustration: with VAT-inclusive pricing a $10 shelf price means a $10 checkout total; with US sales tax the total is the $10 price plus tax added at checkout."
---

You see $20 on a store page, you go to pay, and the total says something else. Sometimes that is a currency conversion. Often it is tax, and whether the tax is inside the price or added on top depends on where you live.

Valve publishes how it handles this. Here is what the pages say, why it matters when you compare prices between stores, and a quick check to do before you pay.

<figure style="margin: 0 0 24px;">
<svg viewBox="0 0 520 240" role="img" aria-labelledby="tax-title tax-desc" style="display:block;width:100%;height:auto;font-family:var(--font-body);">
<title id="tax-title">Inclusive tax: total equals shelf price. Additive tax: total is shelf price plus tax</title>
<desc id="tax-desc">Invented numbers for illustration only. Left panel: a $10 shelf price with VAT already inside gives a $10 checkout total. Right panel: a $10 shelf price with sales tax added at checkout gives a total above $10.</desc>
<rect x="0.5" y="0.5" width="519" height="239" rx="14" style="fill:var(--panel);stroke:var(--border);"/>
<line x1="260" y1="20" x2="260" y2="220" style="stroke:var(--border);"/>
<text x="130" y="38" font-size="17" font-weight="800" text-anchor="middle" style="fill:var(--heading);">Inclusive (VAT)</text>
<rect x="50" y="66" width="160" height="44" rx="10" fill="none" stroke-width="2" style="stroke:var(--accent-text);"/>
<text x="130" y="93" font-size="15" font-weight="700" text-anchor="middle" style="fill:var(--text);">Shelf price $10</text>
<rect x="50" y="130" width="160" height="44" rx="10" style="fill:var(--badge);"/>
<text x="130" y="157" font-size="15" font-weight="700" text-anchor="middle" style="fill:var(--on-badge);">Total $10</text>
<text x="130" y="204" font-size="13" text-anchor="middle" style="fill:var(--muted);">Tax is already inside</text>
<text x="390" y="38" font-size="17" font-weight="800" text-anchor="middle" style="fill:var(--heading);">Additive (US sales tax)</text>
<rect x="310" y="66" width="160" height="44" rx="10" fill="none" stroke-width="2" style="stroke:var(--accent-text);"/>
<text x="390" y="93" font-size="15" font-weight="700" text-anchor="middle" style="fill:var(--text);">Shelf price $10</text>
<rect x="310" y="130" width="160" height="44" rx="10" style="fill:var(--badge);"/>
<text x="390" y="157" font-size="15" font-weight="700" text-anchor="middle" style="fill:var(--on-badge);">Total $10 + tax</text>
<text x="390" y="204" font-size="13" text-anchor="middle" style="fill:var(--muted);">Tax is added at checkout</text>
</svg>
<figcaption style="margin-top:8px;font-size:13px;color:var(--muted);">Invented numbers, for illustration only. The tax rate depends on where you are.</figcaption>
</figure>

## The short version

- **VAT is inside the price.** Valve's tax FAQ for developers says: "Steam pricing is VAT inclusive in all countries where amounts are collected."
- **US and Canadian sales tax is added on top.** The same FAQ says these "are always additive", and that sales tax "is calculated and then added on top of the Steam Price."
- **So the shelf price and the total can differ.** In a VAT country they match. In the US they usually do not.
- **Compare totals, not shelf prices,** when you check one store against another.

## Two kinds of tax

Valve's tax FAQ defines the two words: "Taxes may be inclusive, meaning that they are included in the price; or additive, meaning that they are added at checkout."

Inclusive means the number on the store page is what you pay. Additive means the page shows a price before tax and the tax is calculated when you pay. Both are disclosed, but the second one surprises people who are used to the first.

## What the Steam Subscriber Agreement says

The Steam Subscriber Agreement, section 3.A, says that if your use of Steam is subject to sales or use tax, "then Valve may also charge you for those taxes". The same section says: "All fees on Steam in the European Union and the United Kingdom include the EU or UK VAT".

Section 3.B adds that as the account holder, you are responsible for all charges, "including applicable taxes".

In the sections we read, the agreement does not say whether listed prices include sales tax outside the EU and the UK. For that, the tax FAQ is the clearer page.

## What the tax FAQ lists

The FAQ has a table of countries and territories where Steam collects tax. It has roughly 75 rows, and every one is marked inclusive. The US and Canadian sales taxes are described separately and marked as always additive. The table is written for developers and changes over time, so use it as a guide and not as a promise.

## Why it matters when you compare prices

A price on one store may include VAT and a price on another may not. If you are in the US, a store that shows a price before tax and one that shows it after tax are not comparable until you add the tax to the first.

Two practical effects:

- A $20 game with sales tax added costs more than $20. A $20 game with VAT already inside costs $20.
- A discount percentage works on the shelf price. It does not tell you the final total. Our guide on [percent versus dollars saved](/guides/percent-vs-dollars-saved/) covers the same idea for discounts.

## Check your total in five minutes

1. Put the game in your cart and look at the total before you confirm.
2. Compare it with the shelf price. If it is higher, the difference is tax or a fee.
3. Check which country your account is set to. Tax depends on it. Our guide on [why prices differ by country](/guides/why-game-prices-differ-by-country/) explains the rest.
4. Comparing stores? Write down each total in the same currency, with tax, and compare those.
5. Paying with Steam Wallet funds? Check the total first, the same way.

## What we did not check

- GOG's help page on VAT and taxes returned an error (403) when we opened it, so we make no claim about how GOG shows tax.
- We did not open the pages of any other store.
- We did not test a checkout in any country. Steps 1 and 5 above are what we expect from the sources, not something we recorded.
- Tax rates and rules differ by country, state and province. We do not list rates.

## How we handle this

Some of the store links on our site, including links to GOG and IndieGala, are affiliate links, and we mark them clearly. This guide contains no affiliate links, and it is written from the sources listed below, not from our commission. Read [how affiliate links work on our site](/disclosure/).

## Sources

- [Steam: Tax FAQ (Steamworks documentation)](https://partner.steamgames.com/doc/finance/taxfaq)
- [Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/)

Pages were read on November 20, 2026. Tax rules and terms can change, so check the source pages for the current wording. This is not legal advice.
