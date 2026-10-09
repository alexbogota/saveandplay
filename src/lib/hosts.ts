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
