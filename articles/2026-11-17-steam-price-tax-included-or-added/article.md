---
layout: ../../layouts/Article.astro
section: guides
title: "Steam price and tax: when the checkout total is the same as the shelf price"
description: "Valve's tax page lists 71 places where tax is already inside the Steam price, and says US sales tax is added on top. Here is how to read your total before you pay."
updated: 2026-11-17
image: /og/steam-price-tax-included-or-added.png
imageAlt: "Diagram with invented numbers: with an inclusive tax a $10.00 shelf price stays $10.00 at checkout; with an additive tax of 8% the same shelf price becomes $10.80."
---

You see $10 on a store page and expect to pay $10. Sometimes you do. Sometimes the checkout shows a higher number, and it feels like a trick. It is usually tax, and whether it is inside the price or added after depends on where you live.

Valve publishes a tax page for developers that answers this directly. Here is what it says, and a short way to read your own total.

## The short version

- **Two kinds of tax.** The Steam tax FAQ says taxes "may be inclusive, meaning that they are included in the price; or additive, meaning that they are added at checkout."
- **Inclusive is the long list.** The page's table of taxes Steam currently collects has 71 rows, and every one is marked Inclusive.
- **Additive is US and Canadian sales tax.** The page says sales tax is "calculated and then added on top of the Steam Price", and that it is collected in some US and Canadian jurisdictions.
- **Your final total is what counts.** Compare the amount on the last checkout step, not the number on the store page.

## Inclusive: the tax is already in the price

If your country is in Valve's table, the tax is part of the number you see. A $10.00 shelf price with a 20% inclusive tax is still $10.00 at checkout. The tax is simply a part of that $10.00: about $1.67 of it (this is an invented example, to show the arithmetic).

The table lists a country, a rate and a type. Some examples from it: Germany 19%, France 20%, the United Kingdom 20%, Australia 10%, Japan 10%, Mexico 16%, Poland 23%. Hungary has the highest rate in the table, 27%. Sri Lanka is listed at 0%. The page also states that "Steam pricing is VAT inclusive in all countries where amounts are collected."

The Subscriber Agreement says the same for two places. In section 3.A: "All fees on Steam in the European Union and the United Kingdom include the EU or UK VAT."

## Additive: the tax appears at checkout

For the US, the page says: "We charge sales tax in states as required by applicable law." It adds that Valve collects sales tax in some US and Canadian jurisdictions on top of the 71-row table, and that sales tax is always additive.

So a $10.00 shelf price with an 8% sales tax would show $10.80 at checkout (invented numbers). The store page does not know your address yet, so the tax can only be calculated once you reach checkout. The Subscriber Agreement (section 3.A) says that if your purchases are subject to use or sales tax, "Valve may also charge you for those taxes."

## What this changes when you compare prices

- **A bigger total is not a hidden fee.** If you are in an additive area, the difference is the tax.
- **Two countries can look different for a boring reason.** A price in one country may include tax and in another may not. Our guide on [why a PC game costs a different amount in each country](/guides/why-game-prices-differ-by-country/) covers the other reasons.
- **Other stores can differ.** This page is about Steam only. Check how a store you use shows tax.

## Questions to ask at checkout

1. Is my country on Valve's tax list? If yes, the number on the page should be the number you pay.
2. Do I live where sales tax is added? Then expect a higher total on the last step.
3. Does the total match the page after tax? If it does not, stop and check before you pay.

## What we did not check

- We did not test a real checkout in any country, so we do not say what the screen looks like in each.
- The tax page is written for developers. It does not say how the checkout screen words the tax line.
- It does not list which US states or Canadian provinces are collected, so we do not name them.
- GOG's and Epic's support pages returned access errors to our tools, so this guide says nothing about their tax handling.
- Tax rates and the table change. The numbers here are as read on the date below.

## How we handle this

Some store links elsewhere on our site are affiliate links, and we mark them clearly. This guide has none, and it is written from the sources listed below. Read [how affiliate links work on our site](/disclosure/).

## Sources

- [Steamworks: Tax FAQ (Valve)](https://partner.steamgames.com/doc/finance/taxfaq)
- [Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/)

Pages were read on November 17, 2026. Tax rules and Valve's table can change, so check the source pages for the current wording. This is not legal advice.
