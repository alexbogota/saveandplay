// Games to play with friends on a rented server: data/coop-games.json (one block per game, no code change for a new game).
// Used by src/pages/servers/[game].astro (one page per game) and the list on /servers/. The posts about them are made by scripts/lib/coop-posts.mjs.
import data from '../../data/coop-games.json';
import { hostsByKey, type Host } from './hosts';

export interface CoopFact { text: string; source: string; url: string }
export interface CoopGame {
  slug: string;
  title: string;
  tags: string[];
  hashtag: string;
  steamAppId: number;
  image: string;
  checkedOn: string;
  intro: string;
  facts: CoopFact[];
  hosts: Record<string, { path: string; facts: string[] }>;
  posts: string[];
}

export const coopGames = data.games as CoopGame[];

// The hosts of one game, in the order of the game's block, each with its affiliate link to the page of this game.
export function hostsOf(game: CoopGame): { host: Host; href: string; facts: string[]; path: string }[] {
  return Object.entries(game.hosts).flatMap(([key, h]) => {
    const host = hostsByKey[key];
    if (!host || !host.gameUrl) throw new Error(`data/coop-games.json, ${game.slug}: unknown host "${key}" or the host has no gameUrl in src/lib/hosts.ts`);
    return [{ host, href: host.gameUrl(h.path), facts: h.facts, path: h.path }];
  });
}
