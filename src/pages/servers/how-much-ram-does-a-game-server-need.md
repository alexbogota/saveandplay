---
layout: ../../layouts/Article.astro
title: "How much RAM does a game server need? Minecraft, Rust, ARK and Valheim"
description: "What the official guides and community wikis say about the memory a game server needs, for Minecraft, Rust, ARK: Survival Evolved and Valheim, and how to use those numbers when choosing a plan."
updated: 2026-10-05
---

RAM (memory) is the number one thing that decides how well a game server runs, and it is also the main thing a host charges for. The right amount depends heavily on the game. A small Minecraft server and a Rust server are in completely different leagues.

## What the sources say

| Game | What the source says | Source |
|------|----------------------|--------|
| Minecraft Java Edition | At least 2 GB for small servers. Larger servers may need 4 GB. A bigger world needs more memory. | Minecraft Wiki |
| Rust | 12 GB of free RAM as a minimum. A 6k map uses more. 15 GB of free disk space, SSD or NVMe preferred. | Facepunch Rust wiki |
| ARK: Survival Evolved | From 3.5 to 4.5 GiB for an empty The Island map with default settings and no players, up to 10 to 12.5 GiB for Genesis: Part 2. Each connected player may add 50 to 150 MiB. | ARK community wiki |
| Valheim | The official server guide does not state a memory requirement. It lists ports 2456 and 2457 as the default. | Valheim support site |

These are numbers for the server software itself. Your plan should be at least this big, with some room to spare, because the machine also runs other things.

## How to use these numbers

1. Find your game in the table. Note that Rust and ARK need many times more memory than Minecraft.
2. Choose a plan with at least that much memory.
3. Add room for growth if you plan to use mods, a large world or more players. The sources above say that world size, maps and player count all raise memory use.
4. For a game without an official number, such as Valheim, look at what the host recommends for that game, and ask its support if you are unsure.
5. Check whether you can change to a bigger plan later. Starting small and moving up is often cheaper than overpaying from day one.

## Common mistakes

- **Buying by price alone.** A cheap plan with too little memory leads to lag and crashes.
- **Ignoring the map.** In ARK the memory use depends strongly on the map, as the table shows.
- **Forgetting disk space.** Rust needs 15 GB free according to its wiki, and an ARK server installation takes around 18 GiB according to the community wiki.
- **Forgetting mods.** Mods use extra memory on top of the base game.

## Next step

When you know how much memory you need, read our [step-by-step guide to starting a server](/servers/start-a-game-server-for-friends/), or compare renting with [hosting at home](/servers/rent-a-server-or-host-at-home/).

## Sources

- [Minecraft Wiki: Setting up a Java Edition server](https://minecraft.wiki/w/Tutorial:Setting_up_a_Java_Edition_server)
- [Rust wiki (Facepunch): Creating a server](https://wiki.facepunch.com/rust/Creating-a-server)
- [ARK community wiki: Dedicated server setup](https://ark.wiki.gg/wiki/Dedicated_server_setup)
- [Valheim: A guide to dedicated servers](https://www.valheimgame.com/support/a-guide-to-dedicated-servers/)

Numbers were read on October 5, 2026. Games get updated, so check the current requirements on the game's own pages.
