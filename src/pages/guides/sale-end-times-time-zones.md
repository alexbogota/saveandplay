---
layout: ../../layouts/Article.astro
section: guides
title: "When does a game sale really end? Reading end times and time zones"
description: "Store sales end at a fixed clock time in one time zone, not at midnight where you live. How Steam and GOG show it, and a 30-second check to avoid missing the last hours."
updated: 2026-11-27
image: /og/sale-end-times-time-zones.png
imageAlt: "Diagram: one GOG sale end, December 3, 2026, 09:59 in Eastern European Time, equals 07:59 UTC. Steam's own pages use 10am Pacific as the usual switchover time."
---

"Ends December 3" sounds like you have until the end of that day. Often you do not. A sale ends at a set clock time in one time zone, and for many readers that hour falls in the middle of the previous night or the middle of a working day.

This guide shows how two stores state their end times, what the numbers mean on your own clock, and a short check you can do before you wait for the last day.

<figure style="margin: 0 0 24px;">
<svg viewBox="0 0 520 200" role="img" aria-labelledby="tz-title tz-desc" style="display:block;width:100%;height:auto;font-family:var(--font-body);">
<title id="tz-title">One sale end, written in two time zones</title>
<desc id="tz-desc">Two boxes joined by an equals sign. Left: 09:59 EET on December 3, 2026, as shown on a GOG page. Right: 07:59 UTC on the same date. A note says EET is two hours ahead of UTC in winter.</desc>
<rect x="0.5" y="0.5" width="519" height="199" rx="14" style="fill:var(--panel);stroke:var(--border);"/>
<text x="24" y="34" font-size="16" style="fill:var(--muted);">The same moment, two ways of writing it</text>
<rect x="32" y="56" width="200" height="86" rx="10" fill="none" stroke-width="2" style="stroke:var(--accent-text);"/>
<text x="132" y="96" font-size="28" font-weight="800" text-anchor="middle" style="fill:var(--heading);">09:59 EET</text>
<text x="132" y="122" font-size="14" text-anchor="middle" style="fill:var(--text);">Dec 3, 2026 (GOG page)</text>
<text x="260" y="108" font-size="26" font-weight="800" text-anchor="middle" style="fill:var(--text);">=</text>
<rect x="288" y="56" width="200" height="86" rx="10" fill="none" stroke-width="2" style="stroke:var(--accent-text);"/>
<text x="388" y="96" font-size="28" font-weight="800" text-anchor="middle" style="fill:var(--heading);">07:59 UTC</text>
<text x="388" y="122" font-size="14" text-anchor="middle" style="fill:var(--text);">Dec 3, 2026</text>
<rect x="32" y="158" width="456" height="30" rx="10" style="fill:var(--badge);"/>
<text x="260" y="178" font-size="14" font-weight="700" text-anchor="middle" style="fill:var(--on-badge);">Write the end time in UTC, then convert it to your clock</text>
</svg>
<figcaption style="margin-top:8px;font-size:13px;color:var(--muted);">Example from a GOG page read on November 26, 2026.</figcaption>
</figure>

## The short version

- **Every sale has a clock time and a time zone.** If you only remember the date, you may be off by up to a day.
- **Steam's own pages use Pacific Time.** Valve's discount documentation puts the usual switchover at 10am Pacific.
- **GOG prints its own end time on the game page**, with a time zone label such as EET.
- **Convert once, write it down.** A UTC time plus your local hour is enough.

## What Steam says about timing

Steam's documentation for developers explains how its discount types are scheduled. It is a page for publishers, but it shows the rhythm of the store. It says Weeklong Deals "begin every Monday morning at 10AM Pacific time and run for 7 days", and that Daily Deals "rotate every day at 10am Pacific". Launch discounts end "at 10am Pacific on the applicable day". Discounts "cannot run shorter than 1 day or longer than 14 days".

What this means for you: when a Steam promotion says it ends on a date, the end moment is usually 10am Pacific on that date, not midnight. In winter Pacific Time is eight hours behind UTC, so 10am there is 18:00 UTC. In summer the gap is seven hours, so the UTC hour is different. Use a time converter for the exact date, because the clock change moves it.

The page does not give a start time for custom discounts, so a custom sale can end at another hour. Read the end line on the game's own store page.

## What a GOG page shows

On the GOG page we opened for a game in our own list, the discount block reads "Offer ends on: 12/03/2026 09:59 EET". Two things to notice:

- **The zone is printed.** EET is Eastern European Time, two hours ahead of UTC in winter, so 09:59 EET is 07:59 UTC. Our own deals file stores the same moment as `2026-12-03T09:59:00+02:00`.
- **The date format is easy to misread.** `12/03/2026` can be read as 12 March or 3 December. Here the sale data says December 3, 2026. Other people's pages may use either order, so look for a month name or a second source before you plan around a number like this.

The same GOG page also showed a line, "Lowest price in the last 30 days before discount", next to the price. That line is about the previous 30 days, which is a different thing from the sale end. Our guide to [price history](/guides/how-to-read-game-price-history/) covers how to read it.

## A 30-second check

1. **Find the end line on the store page** and copy the full text, including the zone.
2. **Spot a numeric date?** If the day is 12 or less, check whether it is day-first or month-first.
3. **Convert to your clock.** Search for "EET to my time" or use a converter, and enter the date, because daylight saving changes the gap.
4. **Set a reminder at least a few hours before**, not at the end hour.
5. **Re-open the page just before you pay.** A store can end an offer earlier or later than planned, and the page is the only source that counts.

## Questions to ask yourself

- Does the end line name a time zone, or only a date?
- Is the date written day-first or month-first?
- Does the end time fall while you are asleep or at work?
- Is a different store selling the same game on a different schedule?
- Do you still want the game if the price returns tomorrow? Our guide on [Steam discount rules](/guides/steam-discount-rules-how-often/) explains how often a price can come back.

## What we did not check

- We did not read a Steam store page for a specific game, so we cannot say what end text Steam shows to buyers. The Steam timing above comes from Valve's partner documentation, which describes how discounts are scheduled.
- We did not check how every store (Epic, Humble, key resellers) states end times. Epic's pages returned an access error to our tools.
- We did not test whether a store ever ends a sale earlier than its page says.
- The Pacific to UTC conversion is our own arithmetic, not a quote from Valve.

## How we handle this

Some store links elsewhere on our site are affiliate links, and we mark them clearly. This guide has none, and it is written from the pages listed below, not from commission. Read [how affiliate links work on our site](/disclosure/).

## Sources

- [Steamworks Documentation: Discounts (Valve)](https://partner.steamgames.com/doc/marketing/discounts)
- [GOG game page, This War of Mine (GOG.com)](https://www.gog.com/en/game/this_war_of_mine)

Pages were read on November 26, 2026. Stores can change how they schedule and show sales, so check the page itself before you rely on a time.
