---
layout: ../../layouts/Article.astro
section: guides
title: "Why a PC game costs a different amount in each country"
description: "Steam shows prices in 37 currencies and developers set each one. Here is how regional pricing works, what it means for you, and what the rules say about buying across borders."
updated: 2026-10-13
image: /og/why-game-prices-differ-by-country.png
imageAlt: "Diagram: a developer sets a price in each of 37 Steam currencies, with 4 region groups of discounted USD prices for countries without a local currency, and a 30-day pause on discounts after a price increase."
---

Two people look at the same game on the same day and see two different prices. It is not a glitch, and it is not always a trick. On Steam, a price is not one number converted by an exchange rate. It is a list of prices, one for each currency, and someone chose every line of that list.

Here is what Steam's own documents for developers and its customer agreement say about how that works, and what it means when you shop.

## The short version

- **A game has many prices.** Steam says each product is "specified and displayed using 37 different currencies and 4 region groups." The developer or publisher sets them, not Steam's exchange-rate feed.
- **Two stores in two countries can both be right.** Local pricing is a business choice, and the same game can look cheaper or dearer than a plain currency conversion would suggest.
- **Taxes can sit inside the price.** For the EU and the UK, Steam's agreement says fees "include the EU or UK VAT". In some places tax is added on top.
- **Do not hide where you live to get a lower price.** Steam's agreement forbids using IP proxying to buy "at pricing not applicable to your geography."

## Who sets the price

According to Steam's pricing documentation for developers, the developer (the Steamworks partner who is paid for the sales) sets the prices. Valve reviews the first prices and later changes, "usually within one or two business days". The documentation describes three optional tools that help a developer fill in the other currencies from a US dollar base price:

1. exchange rate only,
2. purchasing power only,
3. a multi-variable conversion that mixes several inputs.

These are optional tools. The developer can still type in a different number for a currency. So when a price in your currency looks odd next to the US price, the likely reason is a human decision or a conversion method, not a bug. We cannot see which method any given game used.

There is a floor too. The documentation says base prices must be at least the multi-variable conversion of the $0.99 tier, and that the lowest transaction price is about 50% below that base, roughly $0.49.

## What happens if your country has no local currency

Not every country has its own currency on Steam. The page on supported currencies says that where Steam does not have the native currency, "prices are presented and charged in US dollars, except for countries geographically located within Europe", which use the euro.

For some of these places the documentation recommends a lower dollar price. It lists four groups of countries without local pricing, each with its own country list: USD_CIS, USD_LATAM, USD_MENA and USD_SASIA. One line says developers "may still offer a different, usually discounted, USD price" in such areas. Note the word "may" and the word "recommend": these are suggestions to developers, not a rule you can count on for a given game.

Another detail matters for the buyer. The FAQ says a missing currency makes the game unavailable to customers who use that currency. So a game that is missing in your store may simply have no price set for your currency yet.

## Why sale prices differ too

Discounts are set by the developer as well, and Steam limits how often. The documentation says that, in general, you cannot submit a discount within 30 days of release, or 30 days after a launch discount ends. And "increasing a price in one or more currencies will generate a 30 day cooldown on your ability to submit discounts."

For you, that means a few things:

- A big discount on a fresh game is rare, because of the 30-day gap.
- A price rise in one currency can pause discounts for that game, so a game can sit at a flat price for a month.
- The percentage off is calculated against the price in your currency. Two countries can both see "-50%" and still pay different amounts, because the starting prices were different.

Our guide to [real and fake discounts](/guides/real-vs-fake-game-discounts/) covers how to check that the "was" price is a price the game really had.

## Taxes and the final amount

Steam's Subscriber Agreement (section 3.A) says "All fees on Steam in the European Union and the United Kingdom include the EU or UK VAT," and that Valve may charge taxes "in addition to" the fees published elsewhere. So a shelf price in one country may already include tax and in another may not. Comparing two countries' numbers without asking about tax can mislead you. The sources we opened do not say which countries add tax at checkout, so check the final amount on the checkout page.

## Buying from another country

The same section of the agreement says you may not use IP proxying to buy "at pricing not applicable to your geography", and that Valve may end account access for it. Section 3.A also says you may not disguise your residence "to circumvent geographical restrictions on game content." The agreement is the contract you accepted when you made your account. Whether a particular act is lawful where you live is a different question, and this is not legal advice.

The practical risk is bigger than the saving. A game bought through a workaround can be cheap today and cost you the account tomorrow, with its whole library.

## Five-minute checks

1. **Look at the currency on the page.** Is it your own currency, or US dollars? Dollars may mean there is no local price.
2. **Check whether tax is included.** Look at the final amount at checkout, not the shelf price.
3. **Compare the percentage and the amount.** A "-60%" from a high start can cost more than "-40%" from a low one.
4. **Use the same store and edition in any comparison.** A deluxe edition is not the same game.
5. **Do not use tricks that the store forbids.** Read the agreement before you try one.

## What we did not check

- We could not read the Steam Support article on store country. The page loads its text with scripts and our tools only saw the menu, so we say nothing about how to change your store country, or how often.
- We did not check how GOG, Epic or other stores set regional prices. Their support pages were closed to our tools or not opened, so this guide is about Steam only.
- We did not compare prices of any specific game between countries, and we do not say which method of conversion any game uses.
- Laws on consumer prices, tax and geoblocking differ by country, and we did not review them.

## How we handle this

Some store links elsewhere on our site, including links to GOG and IndieGala, are affiliate links, and we mark them clearly. This guide has no affiliate links and is written from the sources listed below. Read [how affiliate links work on our site](/disclosure/).

## Sources

- [Steamworks Documentation: Pricing](https://partner.steamgames.com/doc/store/pricing)
- [Steamworks Documentation: Supported Currencies](https://partner.steamgames.com/doc/store/pricing/currencies)
- [Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/)

Pages were read on October 13, 2026. Prices, rules and terms can change, so check the source pages for the current wording. This is not legal advice.
