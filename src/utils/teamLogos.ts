const TEAM_LOGOS = import.meta.glob<string>('../images/logos/*.png', { eager: true, import: 'default' });

export function getTeamLogoUrl(nickname: string): string | undefined {
  const normalized = nickname.replace(/['']/g, '').replace(/\s+/g, '_');
  const exactKey = `../images/logos/${normalized}.png`;
  if (TEAM_LOGOS[exactKey]) return TEAM_LOGOS[exactKey];
  const suffix = `_${normalized}.png`;
  const match = Object.keys(TEAM_LOGOS).find(k => k.endsWith(suffix));
  if (match) return TEAM_LOGOS[match];
  const lowerSuffix = `_${normalized.toLowerCase()}.png`;
  const lowerMatch = Object.keys(TEAM_LOGOS).find(k => k.endsWith(lowerSuffix));
  if (lowerMatch) return TEAM_LOGOS[lowerMatch];
  return undefined;
}

export function teamLogoImg(nickname: string, cssClass: string = 'team-dropdown-logo'): string {
  const url = getTeamLogoUrl(nickname);
  return url ? `<img class="${cssClass}" src="${url}" alt="">` : '';
}
