// Game server hosts we link to. Every fact below is copied from the provider's own website
// on the date in "checkedOn". Do not add prices (they change) and do not add claims we have not seen on the site.
export interface Host {
  name: string;
  site: string;
  affiliateUrl: string;
  checkedOn: string;
  games: string;
  locations: string;
  facts: string[];
}

// Admitad link (see docs/partners.md, section 4). subid=site tells us the click came from the website.
const godlikeBase = 'https://yjfca.com/g/n4h0en61qnc9990a3d5952f0388f55/';

export const godlike: Host = {
  name: 'Godlike.Host',
  site: 'https://godlike.host',
  affiliateUrl: `${godlikeBase}?subid=site`,
  checkedOn: 'October 5, 2026',
  games: 'Minecraft (Java and Bedrock), Palworld, ARK: Survival Evolved, Terraria, Rust, Valheim and others. Also VPS and dedicated servers.',
  locations: 'USA (East and West), Canada, United Kingdom, Netherlands, Ukraine, Finland, Germany, Poland, Singapore, India, Australia.',
  facts: [
    'Support is advertised as 24/7 (Discord, tickets, email).',
    'DDoS protection and automatic backups are listed as included.',
    'Prices can be shown in USD, GBP, EUR or PLN.',
    "The front page mentions a 3-day money-back guarantee. Check its terms before you buy.",
  ],
};

// Direct affiliate program (no network, see docs/partners.md). ref = our account, trckit = campaign mark:
// "site" for every button; src/components/ClickMark.astro swaps it for the visit source on a real click (bots keep "site").
export const survivalServers: Host = {
  name: 'Survival Servers',
  site: 'https://www.survivalservers.com',
  affiliateUrl: 'https://www.survivalservers.com/?ref=alex70&trckit=site',
  checkedOn: 'October 22, 2026',
  games: 'More than 100 games, including cozy co-op games such as Stardew Valley, Core Keeper, Terraria and Necesse, plus Valheim, Palworld, Enshrouded and Minecraft.',
  locations: 'USA (Los Angeles, Seattle, Dallas, New York, Miami), Germany, France, Singapore.',
  facts: [
    'Servers are listed as set up instantly after payment.',
    'DDoS protection is listed for every server; automated off-site backups for selected games.',
    'You can switch the server location at any time, according to the feature list.',
    'Support is by ticket and email, with a community forum and a staff wiki.',
  ],
};

// Cards shown on /servers/ and under every server guide, in this order.
export const hosts: Host[] = [survivalServers, godlike];
