---
layout: ../../layouts/Article.astro
section: guides
title: "Steam Cloud saves: which games have them and what that does not protect"
description: "Steam Cloud copies a game's save files to Valve's servers, but only if the developer set it up. How to check before you buy, how it syncs, and when to still back up."
updated: 2026-11-15
image: /og/steam-cloud-saves-what-it-covers.png
imageAlt: "Diagram: Steam syncs a game's cloud files before and after each session, only for games that list Steam Cloud under Features. You can turn it off globally or per game."
---

You can lose a Steam library to a dead drive and get it back with a download. Your save files are a different matter. Forty hours of progress sit in a folder on your PC, and a library does not bring that folder back by itself.

Steam Cloud is the feature meant to cover this. It is useful, but it is not automatic for every game, and it is not a full backup. Here is what Valve's own pages say about it.

<figure style="margin: 0 0 24px;">
<svg viewBox="0 0 520 210" role="img" aria-labelledby="cl-title cl-desc" style="display:block;width:100%;height:auto;font-family:var(--font-body);">
<title id="cl-title">Steam Cloud: sync before and after every session</title>
<desc id="cl-desc">Three boxes in a row: before the session Steam synchronizes the game's cloud files, during the session you play, after the session changed files are uploaded. A note says this only works for games that list Steam Cloud under Features on the store page.</desc>
<rect x="0.5" y="0.5" width="519" height="209" rx="14" style="fill:var(--panel);stroke:var(--border);"/>
<text x="24" y="34" font-size="16" style="fill:var(--muted);">What Steam does around one play session</text>
<rect x="24" y="52" width="148" height="76" rx="10" fill="none" stroke-width="2" style="stroke:var(--accent-text);"/>
<text x="98" y="86" font-size="20" font-weight="800" text-anchor="middle" style="fill:var(--heading);">Before</text>
<text x="98" y="110" font-size="13" text-anchor="middle" style="fill:var(--text);">files are synchronized</text>
<rect x="186" y="52" width="148" height="76" rx="10" fill="none" stroke-width="2" style="stroke:var(--border);"/>
<text x="260" y="86" font-size="20" font-weight="800" text-anchor="middle" style="fill:var(--heading);">During</text>
<text x="260" y="110" font-size="13" text-anchor="middle" style="fill:var(--text);">you play</text>
<rect x="348" y="52" width="148" height="76" rx="10" fill="none" stroke-width="2" style="stroke:var(--accent-text);"/>
<text x="422" y="86" font-size="20" font-weight="800" text-anchor="middle" style="fill:var(--heading);">After</text>
<text x="422" y="110" font-size="13" text-anchor="middle" style="fill:var(--text);">changed files upload</text>
<rect x="24" y="148" width="472" height="40" rx="10" style="fill:var(--badge);"/>
<text x="260" y="173" font-size="14" font-weight="700" text-anchor="middle" style="fill:var(--on-badge);">Only if the game lists "Steam Cloud" under Features</text>
</svg>
<figcaption style="margin-top:8px;font-size:13px;color:var(--muted);">Simplified from Valve's Steam Cloud documentation, read on November 15, 2026.</figcaption>
</figure>

## The short version

- **It is the developer's choice.** Valve's documentation says developers must configure Steam Cloud for their game. No setup, no cloud saves.
- **It syncs around sessions.** Steam synchronizes the cloud files "before and after every session" of the game.
- **You control it.** You can turn Cloud off for all games in Steam settings, or for one game in its properties.
- **It is a sync, not a promise to keep every version.** We found nothing on the pages we read that describes a history of old saves, so do not assume one.

## How to check before you buy

On a game's store page, look at the Features list. The Stardew Valley page, for example, lists "Steam Cloud" among its features, next to labels such as "Single-player" and "Steam Achievements". That label is the quickest way to tell that the developer set it up.

The same list is where you check other things that matter to you, such as co-op modes and Family Sharing. A game without the label may still keep saves in a normal folder on your PC. They just are not copied to Valve's servers.

## What actually gets synced

Valve's developer page says files named in the game's Auto-Cloud configuration, or written through the Cloud API, "will automatically be replicated to the Steam servers after the game exits". Auto-Cloud exists for games that choose not to use the Cloud API themselves, and it syncs file groups when the game starts and exits.

Two consequences for you:

- **Which files count is decided by the developer.** The page advises developers to avoid machine-specific settings such as video options. So your graphics settings may stay on one PC while your progress travels.
- **There is a size limit.** The quota is set by the developer, per user and per game. The page says Valve recommends "reasonable amounts for your game title". The Subscriber Agreement (section 6.A) adds that Valve "may place limits on the amount of storage you may use".

## Switching it off, and why you might

In Steam settings you can globally disable Cloud synchronization. In a game's properties you can disable it for that game only. Reasons to do this are rare but real: you want a save to stay on one PC, or you are testing something and do not want it uploaded.

If you turn it off, remember that your saves then live only on that computer. A reinstall of Windows would take them with it.

## Suspended games and the Steam Deck

Valve describes "Dynamic Cloud Sync", where cloud changes can reach a local machine during a session. Its own example is "a suspended game session on the Steam Deck". On suspend, Steam synchronizes files up to the cloud. The page also warns that developers should test it, because enabling it without proper handling could cause data loss. That is a developer matter, but it is a good reason to be careful with a game that behaves oddly after resume.

## Questions to ask yourself

1. Does the store page list Steam Cloud for this game?
2. Do I play on more than one PC or on a Steam Deck? Then Cloud matters more.
3. Is this save irreplaceable (a 100-hour run)? If yes, copy the save folder yourself now and then, whatever the label says.
4. Did I turn Cloud off once and forget? Check the game's properties.

## What we did not check

- Valve's consumer help article on Steam Cloud opened, but our tools returned only the page frame and no article text. We do not describe its wording.
- The developer page does not say what happens to your cloud files when you uninstall a game or lose access to it, and we do not guess.
- We did not test syncing on a real account, and we did not check what other stores (GOG, Epic) offer.
- Which files a specific game syncs, and its quota, differ per game. We checked one store page only as an example.

## How we handle this

Some store links elsewhere on our site are affiliate links, and we mark them clearly. This guide has none, and it is written from the pages listed below, not from commission. Read [how affiliate links work on our site](/disclosure/). For why the way you own a game matters, see [Steam key or DRM-free](/guides/steam-key-vs-drm-free/).

## Sources

- [Steam Cloud (Steamworks documentation, Valve)](https://partner.steamgames.com/doc/features/cloud)
- [Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/)
- [Stardew Valley on Steam (store page, example of the Features list)](https://store.steampowered.com/app/413150/Stardew_Valley/)

Pages were read on November 15, 2026. Valve can change how Steam Cloud works and what its pages say, so check the sources for current wording.
