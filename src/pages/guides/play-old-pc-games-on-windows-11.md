---
layout: ../../layouts/Article.astro
section: guides
title: "How to run old PC games on Windows 11: what works, what cannot, and why"
description: "Old games fail on Windows 11 for three different reasons. Here is how to tell which one you have, and what Microsoft, GOG and the emulator projects say you can do."
updated: 2026-11-15
image: /og/play-old-pc-games-on-windows-11.png
imageAlt: "Chart with four rows. DOS game: use a DOS emulator. 16-bit Windows game: not supported on 64-bit Windows. Old disc game: copy protection may be turned off. Runs, but badly: try the compatibility troubleshooter."
---

You find a game you loved twenty years ago, put the disc in or copy the folder over, and nothing happens. Or the installer refuses to start. Or the game starts and looks wrong.

These are three different problems with three different answers, and most advice online mixes them up. Below is how to tell them apart, using what Microsoft and the tool makers say on their own pages.

## The short version

- **A DOS game** needs a DOS emulator. This is the easy case: open-source emulators such as DOSBox-X exist for it.
- **A 16-bit Windows game** cannot run on Windows 11 directly. Microsoft says 64-bit Windows does not support 16-bit programs, and Windows 11 requires a 64-bit processor.
- **A game from a disc that installs but will not start** may be blocked by its own old copy protection. Microsoft turned that driver off in older Windows versions in 2015 and does not recommend turning it back on.
- **A game that runs but badly** is the one case where Windows has a built-in tool: the Program Compatibility Troubleshooter.

## First: is there a maintained version already?

Before you spend an evening on fixes, check whether somebody already did the work. Some stores sell old games that were repaired for current PCs.

GOG runs a Preservation Program for this. In its launch post from November 2024, GOG says that for games in the program "we commit our own resources to maintaining its compatibility with modern and future systems", and that you can expect a game "to work on current and future popular PC configurations". The program started with 100 games. On November 15, 2026 the program page showed "Games in the program: 337".

Two honest limits. This means paying again for a game you may already own on a disc. And the promise covers only the games in the program, not every old game in the store. If you want to know what you get with a GOG copy, our [guide to Steam keys and DRM-free games](/guides/steam-key-vs-drm-free/) explains it.

If your game is not sold anywhere, or you want to use the copy you have, read on.

## The game runs, but badly

Wrong colours, a tiny window, a crash on start: this is the mildest case. The game is a normal Windows program that expects an older Windows.

Microsoft's support page for Windows 11 and Windows 10 gives these steps for Windows 11:

1. Select Start, then Settings, then System, then Troubleshoot, then Other troubleshooters.
2. Find Program Compatibility Troubleshooter and select Run.
3. Follow the instructions on the screen.

The tool is part of Windows, so it costs nothing and takes a few minutes. Start here.

## The installer will not start at all

If the setup program of a very old Windows game refuses to run, it may be a 16-bit program. Microsoft's own documentation is direct about it:

> "The x64-based versions of Windows don't support 16-bit programs, 16-bit processes, or 16-bit components."

Windows 11 is only made for 64-bit machines. Its system requirements ask for "a compatible 64-bit processor or System on a Chip". So on Windows 11 this is not a setting you can change.

Two details from the same Microsoft page are worth knowing:

- Windows "may recognize some 16-bit installers and automatically convert the 16-bit installer to a 32-bit installer". So a 16-bit installer sometimes works anyway, when only the installer is old and the game itself is not.
- For a real 16-bit program, Microsoft's answer is that "you must install the program on a 32-bit version of Windows". For most people today that is not practical.

The practical route is an emulator that can run old Windows inside it. DOSBox-X says on its site that "DOS-based Windows such as Windows 3.x and Windows 9x are officially supported". This takes patience: it is a weekend project, not a quick fix.

## The disc game installs, then refuses to start

Some older disc games rely on a copy protection driver, a file called secdrv.sys. Microsoft calls it "a third-party driver".

In September 2015 Microsoft released a security update, KB3086255, for Windows Vista, 7, 8 and 8.1. Its description says:

> "The update turns off the service for the secdrv.sys driver. This may affect the ability to run some older games."

The same page describes a way to turn the driver back on, and then says "We do not recommend this workaround" and that it "may make a computer or a network more vulnerable to attack by malicious users".

That page does not list Windows 10 or Windows 11, and we did not find a Microsoft page that describes the driver on those versions. What you can take from it: if an old disc game installs and then does nothing, the cause may be the copy protection, not the game, and Microsoft treats the old driver as a security risk. We cannot vouch for sites that offer "fixed" game files to get around the check: nothing Microsoft or the stores publish supports them. GOG says its games are DRM-free, so a version sold there does not depend on that driver.

## It is a DOS game

This is the best case, because there are tools made for exactly this and you do not have to touch Windows settings.

- **DOSBox-X** calls itself "an open-source DOS emulator for running DOS applications and games".
- **DOSBox Staging** describes itself as "a modern continuation of DOSBox" and offers downloads for Windows, macOS and Linux. Its guide notes that DOS games sold on GOG and Steam come with their own copy of DOSBox, which is why those versions start without any setup.
- **ScummVM** is for classic adventure and role-playing games. It "is not an emulator": it replaces the game's program and uses the original files. The catch is in its own description: it runs these games "provided you already have their data files". It lists more than 325 supported adventure games.

All three need the game itself. They run a game you have; they do not give you one.

## Which case is yours? Four questions

1. **Is it a DOS game?** Use a DOS emulator. If it is a classic adventure, look at ScummVM first.
2. **Does the installer refuse to start?** Think 16-bit. Windows 11 cannot run it directly.
3. **Does it install from a disc and then do nothing?** Think copy protection. Do not download "fixed" files from unknown sites.
4. **Does it start but look or behave wrong?** Run the Program Compatibility Troubleshooter.

If none of this helps, a maintained version, where one is sold, saves the hours but costs money again. Compare the price on the day in the [current deals](/deals/).

## What we did not check

- We did not test any game ourselves. This guide describes what the listed pages say, not our own results with a specific title.
- We could not open the original DOSBox site or PCGamingWiki with our tools, so nothing here comes from them. PCGamingWiki is where many players look up fixes for one specific game.
- We did not find a Microsoft page about the secdrv.sys driver on Windows 10 or Windows 11. The 2015 update covers Windows Vista to 8.1 only.
- GOG's program page showed two numbers on the day we read it: 337 games in the program at the top, and 298 in the list below. We quote the first and cannot explain the difference.
- Graphics problems of games that need old 3D cards are not covered. The pages we read do not address them.

## How we handle this

Some of the store links on our site, including links to GOG, are affiliate links, and we mark them clearly. This guide contains no affiliate links, and it is written from the pages listed below, not from our commission. Read [how affiliate links work on our site](/disclosure/).

## Sources

- [Microsoft Support: Make older apps or programs compatible with the latest version of Windows](https://support.microsoft.com/en-us/windows/make-older-apps-or-programs-compatible-with-windows-783d6dd7-b439-bdb0-0490-54eea0f45938)
- [Microsoft Learn: 64-bit versions of Windows don't support 16-bit components, 16-bit processes, or 16-bit applications](https://learn.microsoft.com/en-us/troubleshoot/windows-client/application-management/x64-windows-not-support-16-bit-programs)
- [Microsoft: Windows 11 specs and system requirements](https://www.microsoft.com/en-us/windows/windows-11-specifications)
- [Microsoft Support: MS15-097, security update KB3086255, September 8, 2015](https://support.microsoft.com/kb/3086255)
- [GOG blog: The GOG Preservation Program](https://www.gog.com/blog/the-gog-preservation-program/)
- [GOG Preservation Program page](https://www.gog.com/en/gog-preservation-program)
- [DOSBox-X](https://dosbox-x.com/)
- [DOSBox Staging](https://www.dosbox-staging.org/)
- [DOSBox Staging: getting started](https://www.dosbox-staging.org/0.83/getting-started/introduction/)
- [ScummVM](https://www.scummvm.org/)

Pages were read on November 15, 2026. Software and store programs change, so check the source pages for the current wording.
