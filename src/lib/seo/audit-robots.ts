/** A small robots.txt reader. Empty Disallow means allow. */

export interface RobotsRules {
  present: boolean;
  disallow: string[];
  sitemaps: string[];
}

export function parseRobots(text: string, userAgent = 'marketingos'): RobotsRules {
  const groups: Array<{ agents: string[]; disallow: string[] }> = [];
  const sitemaps: string[] = [];
  let current: { agents: string[]; disallow: string[] } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === 'sitemap') { if (value) sitemaps.push(value); continue; }
    if (key === 'user-agent') {
      if (!current || current.disallow.length) {
        current = { agents: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (key === 'disallow' && current && value) current.disallow.push(value);
  }
  const agent = userAgent.toLowerCase();
  const specific = groups.find(group => group.agents.some(name => name !== '*' && agent.includes(name)));
  const wildcard = groups.find(group => group.agents.includes('*'));
  return { present: true, disallow: (specific || wildcard)?.disallow ?? [], sitemaps };
}

export function pathAllowed(pathname: string, disallow: string[]): boolean {
  const path = pathname || '/';
  return !disallow.some(rule => rule === '/' || path === rule || path.startsWith(rule.endsWith('/') ? rule : `${rule}`));
}
