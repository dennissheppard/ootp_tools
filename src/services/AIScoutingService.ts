/**
 * AI Scouting Service - Generates structured scouting blurbs via OpenAI API
 * Caches results in IndexedDB, keyed by player + rating hash
 *
 * Also provides league leader and org context data that can be used
 * independently by other parts of the app.
 */

import { indexedDBService, AIScoutingBlurbRecord } from './IndexedDBService';
import { trueRatingsService } from './TrueRatingsService';
import { teamRatingsService, TeamPowerRanking } from './TeamRatingsService';
import { dateService } from './DateService';

export interface AIScoutingPlayerData {
  playerName: string;
  age?: number;
  position?: string;
  positionNum?: number;
  team?: string;
  parentOrg?: string;
  injuryProneness?: string;

  // Scouting ratings (20-80) — secondary context
  scoutStuff?: number;
  scoutControl?: number;
  scoutHra?: number;
  scoutStamina?: number;
  scoutPower?: number;
  scoutEye?: number;
  scoutAvoidK?: number;
  scoutContact?: number;
  scoutGap?: number;
  scoutSpeed?: number;
  scoutOvr?: number;
  scoutPot?: number;

  // True Ratings — primary ratings source
  trueRating?: number;
  trueFutureRating?: number;

  // True component ratings (from stats, 20-80 scale) — the ratings you trust
  estimatedStuff?: number;
  estimatedControl?: number;
  estimatedHra?: number;
  estimatedPower?: number;
  estimatedEye?: number;
  estimatedAvoidK?: number;
  estimatedContact?: number;

  // Projected stats (pitcher)
  projFip?: number;
  projK9?: number;
  projBb9?: number;
  projHr9?: number;
  projWar?: number;
  projIp?: number;

  // Projected stats (batter)
  projAvg?: number;
  projObp?: number;
  projSlg?: number;
  projHr?: number;
  projSb?: number;
  projPa?: number;
  projBbPct?: number;
  projKPct?: number;

  // Rich context strings (populated internally by the service)
  teamContext?: string;
  leagueLeaders?: string;
  orgRoster?: string;
}

const SYSTEM_PROMPT = `You are the lead analyst at True Ratings — the FanGraphs of the World Baseball League (WBL). You're the scouting nerd who lives and dies by the numbers, but you have a sharp eye for the story behind them. You write with confidence, dry wit, and occasional bite. You're not mean, but you don't sugarcoat.

TERMINOLOGY:
- True Ratings are on a numeric scale (e.g., "a 4.2 True Rating" or "a 3.8 TR"). NEVER call them "stars" — they are not star ratings. You can say a team "is full of stars" colloquially, but "4.5-star True Rating" is WRONG. Just "4.5 True Rating" or "4.5 TR".
- True Future Rating (TFR) follows the same rule — "a 4.0 TFR", never "4.0-star TFR".
- Component ratings (True Stuff, True Power, etc.) are on a 20-80 scouting scale.

LEAGUE CONTEXT you already know:
- The WBL is a simulation baseball league with real baseball mechanics
- Pitching is at a premium in this league — good arms are hard to find and expensive
- Home runs have been trending down the last few years — power isn't what it used to be
- Good hitting catchers are unicorns — any catcher who can actually hit is worth his weight in gold
- True Ratings (TR) are derived from actual statistical performance and are your bread and butter — they're what matter
- Scouting ratings are the "old school" view — useful for context but your True Ratings are more reliable for MLB-level players
- True Future Rating (TFR) projects a prospect's peak ceiling — it blends their minor league stats with scouting data

ANALYSIS APPROACH:
- Lead with True Ratings when available — they're YOUR system, your pride and joy
- Reference scouting grades as supporting context or to highlight discrepancies ("the scouts see 55 power but the numbers say 62 — we'll take the numbers")
- For prospects without MLB stats, lean on TFR and scouting
- DON'T just restate the numbers — ANALYZE them. Compare to the league leaders provided, to the org's roster, to historical context
- If a player's projected K/9 would rank near the league leaders, say so. If their HR total would lead the league, say so
- Think about how this player fits (or doesn't fit) in their organization's current roster
- When the player is on a minor league team, always frame analysis in terms of the PARENT ORGANIZATION — that's who they're developing for
- Be specific with comparisons: "His projected 3.15 FIP would've ranked 4th in the league last year" is better than "He has good stuff"

Format your response EXACTLY as:

PROFILE:
[2-3 sentences — player archetype, how they fit their organization, what kind of player they are. Compare to league peers and org context.]

STRENGTHS:
- [strength with league/org comparison — e.g., "True Power of 68 puts him in the top tier; his projected 32 HR would've been 3rd in the WBL last year"]
- [strength with specific context]
- [strength with specific context]

RISK:
[1-2 sentences on limitations, red flags, or what could go wrong. Be specific and reference the data.]`;

class AIScoutingService {

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Generate an AI scouting analysis for a player.
   * Internally enriches the data with league leaders and org context.
   */
  async getAnalysis(playerId: number, playerType: 'pitcher' | 'hitter', data: AIScoutingPlayerData): Promise<string> {
    // Enrich with league context (league leaders, org roster, team ranking)
    const enriched = await this.enrichWithContext(data, playerType);

    const dataHash = this.hashData(playerType, enriched);
    const key = `${playerId}_${playerType}`;

    // Check cache
    const cached = await indexedDBService.getAIBlurb(playerId, playerType);
    if (cached && cached.dataHash === dataHash) {
      return cached.blurbText;
    }

    // Build prompt and call API
    const userPrompt = this.buildPrompt(playerType, enriched);
    const blurb = await this.callOpenAI(userPrompt);

    // Cache result
    const record: AIScoutingBlurbRecord = {
      key,
      playerId,
      playerType,
      blurbText: blurb,
      dataHash,
      generatedAt: Date.now()
    };
    await indexedDBService.saveAIBlurb(record);

    return blurb;
  }

  /**
   * Build formatted pitching league leaders string for the most recent season.
   * Returns K leaders, WAR leaders, FIP leaders, K/9 leaders.
   */
  async getPitchingLeaders(year: number): Promise<string> {
    const pitchingStats = await trueRatingsService.getTruePitchingStats(year);
    const mlbPitchers = pitchingStats.filter(s => s.level_id === 1);
    const qualifiedSP = mlbPitchers.filter(s => parseFloat(String(s.ip)) >= 100);
    const lines: string[] = [];

    // K leaders (all pitchers)
    const kLeaders = [...mlbPitchers].sort((a, b) => b.k - a.k).slice(0, 5);
    lines.push('Strikeout Leaders: ' + kLeaders.map((p, i) => `${i + 1}. ${p.playerName} (${p.k} K)`).join(', '));

    // WAR leaders (qualified SP)
    const warLeaders = [...qualifiedSP].sort((a, b) => b.war - a.war).slice(0, 5);
    lines.push('WAR Leaders (SP): ' + warLeaders.map((p, i) => `${i + 1}. ${p.playerName} (${p.war.toFixed(1)})`).join(', '));

    // FIP leaders (qualified, lower is better)
    if (qualifiedSP.length > 0) {
      const fipLeaders = [...qualifiedSP].sort((a, b) => this.calcFip(a) - this.calcFip(b)).slice(0, 5);
      lines.push('FIP Leaders (SP, 100+ IP): ' + fipLeaders.map((p, i) => `${i + 1}. ${p.playerName} (${this.calcFip(p).toFixed(2)})`).join(', '));
    }

    // K/9 leaders (qualified)
    if (qualifiedSP.length > 0) {
      const k9Leaders = [...qualifiedSP].sort((a, b) => this.calcK9(b) - this.calcK9(a)).slice(0, 5);
      lines.push('K/9 Leaders (SP, 100+ IP): ' + k9Leaders.map((p, i) => `${i + 1}. ${p.playerName} (${this.calcK9(p).toFixed(2)})`).join(', '));
    }

    return lines.join('\n');
  }

  /**
   * Build formatted batting league leaders string for the most recent season.
   * Returns HR leaders, WAR leaders, AVG leaders, SB leaders, OPS leaders.
   */
  async getBattingLeaders(year: number): Promise<string> {
    const battingStats = await trueRatingsService.getTrueBattingStats(year);
    const mlbBatters = battingStats.filter(s => s.level_id === 1);
    const qualified = mlbBatters.filter(s => s.pa >= 400);
    const lines: string[] = [];

    // HR leaders
    const hrLeaders = [...mlbBatters].sort((a, b) => b.hr - a.hr).slice(0, 5);
    lines.push('HR Leaders: ' + hrLeaders.map((p, i) => `${i + 1}. ${p.playerName} (${p.hr})`).join(', '));

    // WAR leaders (qualified)
    const warLeaders = [...qualified].sort((a, b) => b.war - a.war).slice(0, 5);
    lines.push('WAR Leaders: ' + warLeaders.map((p, i) => `${i + 1}. ${p.playerName} (${p.war.toFixed(1)})`).join(', '));

    // AVG leaders (qualified)
    if (qualified.length > 0) {
      const avgLeaders = [...qualified].sort((a, b) => b.avg - a.avg).slice(0, 5);
      lines.push('AVG Leaders (400+ PA): ' + avgLeaders.map((p, i) => `${i + 1}. ${p.playerName} (.${Math.round(p.avg * 1000).toString().padStart(3, '0')})`).join(', '));
    }

    // SB leaders
    const sbLeaders = [...mlbBatters].sort((a, b) => b.sb - a.sb).slice(0, 5);
    lines.push('SB Leaders: ' + sbLeaders.map((p, i) => `${i + 1}. ${p.playerName} (${p.sb})`).join(', '));

    // OPS leaders (qualified) — compute SLG from components
    if (qualified.length > 0) {
      const slg = (s: typeof qualified[0]) => s.ab > 0 ? (s.h + s.d + 2 * s.t + 3 * s.hr) / s.ab : 0;
      const ops = (s: typeof qualified[0]) => s.obp + slg(s);
      const opsLeaders = [...qualified].sort((a, b) => ops(b) - ops(a)).slice(0, 5);
      lines.push('OPS Leaders (400+ PA): ' + opsLeaders.map((p, i) => `${i + 1}. ${p.playerName} (.${Math.round(ops(p) * 1000).toString().padStart(3, '0')})`).join(', '));
    }

    return lines.join('\n');
  }

  /**
   * Build team context and org roster context for a given organization.
   * Returns { teamContext, orgRoster } strings for prompt injection or display.
   */
  async getOrgContext(
    orgName: string,
    playerType: 'pitcher' | 'hitter',
    year: number,
    positionNum?: number
  ): Promise<{ teamContext?: string; orgRoster?: string }> {
    const rankings = await teamRatingsService.getPowerRankings(year);
    const teamRank = rankings.find(r => r.teamName === orgName);
    if (!teamRank) return {};

    const teamContext = this.buildTeamContextString(teamRank, rankings);
    const orgRoster = playerType === 'pitcher'
      ? this.buildPitcherRosterString(teamRank)
      : this.buildBatterRosterString(teamRank, positionNum);

    return { teamContext, orgRoster };
  }

  // ─── Internal: Context Enrichment ────────────────────────────────────

  private async enrichWithContext(
    data: AIScoutingPlayerData,
    playerType: 'pitcher' | 'hitter'
  ): Promise<AIScoutingPlayerData> {
    try {
      const year = await dateService.getCurrentYear();
      const statsYear = year - 1;
      const orgName = data.parentOrg || data.team;

      const [leagueLeaders, orgContext] = await Promise.all([
        playerType === 'pitcher'
          ? this.getPitchingLeaders(statsYear)
          : this.getBattingLeaders(statsYear),
        orgName
          ? this.getOrgContext(orgName, playerType, statsYear, data.positionNum)
          : Promise.resolve({} as { teamContext?: string; orgRoster?: string }),
      ]);

      return {
        ...data,
        leagueLeaders,
        teamContext: orgContext.teamContext,
        orgRoster: orgContext.orgRoster,
      };
    } catch (e) {
      console.warn('Failed to enrich AI context:', e);
      return data;
    }
  }

  // ─── Internal: Roster/Context String Builders ────────────────────────

  private buildTeamContextString(teamRank: TeamPowerRanking, allRankings: TeamPowerRanking[]): string {
    const rank = allRankings.indexOf(teamRank) + 1;
    const lines: string[] = [];
    lines.push(`${teamRank.teamName} — Ranked #${rank} of ${allRankings.length} (${teamRank.teamRating.toFixed(1)} TR)`);
    lines.push(`Rotation: ${teamRank.rotationRating.toFixed(1)} | Bullpen: ${teamRank.bullpenRating.toFixed(1)} | Lineup: ${teamRank.lineupRating.toFixed(1)} | Bench: ${teamRank.benchRating.toFixed(1)}`);

    const weakest = Math.min(teamRank.rotationRating, teamRank.bullpenRating, teamRank.lineupRating);
    if (weakest === teamRank.rotationRating && teamRank.rotationRating < 3.0) {
      lines.push('Team NEED: Rotation is a weakness — quality starters are in demand.');
    } else if (weakest === teamRank.bullpenRating && teamRank.bullpenRating < 3.0) {
      lines.push('Team NEED: Bullpen is thin — relief arms are needed.');
    } else if (weakest === teamRank.lineupRating && teamRank.lineupRating < 3.0) {
      lines.push('Team NEED: Lineup is anemic — bats are the priority.');
    }

    return lines.join('\n');
  }

  private buildPitcherRosterString(teamRank: TeamPowerRanking): string | undefined {
    const lines: string[] = [];

    if (teamRank.rotation.length > 0) {
      lines.push('Current Rotation:');
      teamRank.rotation.forEach((p, i) => {
        const statsStr = p.stats ? ` — ${p.stats.war?.toFixed(1) ?? '?'} WAR, ${p.stats.fip.toFixed(2)} FIP, ${p.stats.k9.toFixed(1)} K/9` : '';
        lines.push(`  ${i + 1}. ${p.name} (${p.trueRating.toFixed(1)} TR, Stuff ${Math.round(p.trueStuff)}/Ctrl ${Math.round(p.trueControl)}/HRA ${Math.round(p.trueHra)})${statsStr}`);
      });
    }

    if (teamRank.bullpen.length > 0) {
      const topBullpen = teamRank.bullpen.slice(0, 3);
      lines.push('Top Bullpen Arms:');
      topBullpen.forEach(p => {
        const statsStr = p.stats ? ` — ${p.stats.fip.toFixed(2)} FIP, ${p.stats.k9.toFixed(1)} K/9` : '';
        lines.push(`  ${p.name} (${p.trueRating.toFixed(1)} TR)${statsStr}`);
      });
    }

    return lines.length > 0 ? lines.join('\n') : undefined;
  }

  private buildBatterRosterString(teamRank: TeamPowerRanking, positionNum?: number): string | undefined {
    const lines: string[] = [];

    if (teamRank.lineup.length > 0) {
      lines.push('Current Lineup:');
      teamRank.lineup.forEach((b, i) => {
        const statsStr = b.stats
          ? ` — .${Math.round(b.stats.avg * 1000).toString().padStart(3, '0')}/.${Math.round(b.stats.obp * 1000).toString().padStart(3, '0')}/.${Math.round(b.stats.slg * 1000).toString().padStart(3, '0')}, ${b.stats.hr} HR, ${b.stats.war?.toFixed(1) ?? '?'} WAR`
          : '';
        lines.push(`  ${i + 1}. ${b.positionLabel} ${b.name} (${b.trueRating.toFixed(1)} TR)${statsStr}`);
      });
    }

    // Highlight the current starter at this player's position
    if (positionNum) {
      const posStarter = teamRank.lineup.find(b => b.position === positionNum);
      if (posStarter) {
        lines.push(`Current ${posStarter.positionLabel} starter: ${posStarter.name} (${posStarter.trueRating.toFixed(1)} TR)`);
      }
    }

    if (teamRank.bench.length > 0) {
      const topBench = teamRank.bench.slice(0, 3);
      lines.push('Key Bench Bats:');
      topBench.forEach(b => {
        lines.push(`  ${b.positionLabel} ${b.name} (${b.trueRating.toFixed(1)} TR)`);
      });
    }

    return lines.length > 0 ? lines.join('\n') : undefined;
  }

  // ─── Internal: Stat Helpers ──────────────────────────────────────────

  private calcFip(s: { hra: number; bb: number; k: number; ip: string }): number {
    const ip = parseFloat(String(s.ip));
    return ip > 0 ? ((13 * s.hra + 3 * s.bb - 2 * s.k) / ip + 3.1) : 99;
  }

  private calcK9(s: { k: number; ip: string }): number {
    const ip = parseFloat(String(s.ip));
    return ip > 0 ? (s.k / ip * 9) : 0;
  }

  // ─── Internal: Prompt Building ───────────────────────────────────────

  private buildPrompt(playerType: 'pitcher' | 'hitter', data: AIScoutingPlayerData): string {
    const lines: string[] = [];

    // Header
    lines.push(`=== PLAYER REPORT: ${data.playerName.toUpperCase()} ===`);
    if (data.position) lines.push(`Position: ${data.position}`);
    if (data.age) lines.push(`Age: ${data.age}`);

    // Team / org context
    if (data.parentOrg && data.team && data.team !== data.parentOrg) {
      lines.push(`Current team: ${data.team} (affiliate of ${data.parentOrg})`);
      lines.push(`Parent organization: ${data.parentOrg}`);
    } else if (data.parentOrg) {
      lines.push(`Organization: ${data.parentOrg}`);
    } else if (data.team) {
      lines.push(`Organization: ${data.team}`);
    }
    if (data.injuryProneness) lines.push(`Durability: ${data.injuryProneness}`);

    // TRUE RATINGS — lead with these
    lines.push('');
    lines.push('=== TRUE RATINGS (your system, stats-derived) ===');
    if (data.trueRating !== undefined) lines.push(`Overall True Rating: ${data.trueRating.toFixed(1)}`);
    if (data.trueFutureRating !== undefined) lines.push(`True Future Rating (projected peak): ${data.trueFutureRating.toFixed(1)}`);

    if (playerType === 'pitcher') {
      if (data.estimatedStuff !== undefined) lines.push(`True Stuff: ${Math.round(data.estimatedStuff)}`);
      if (data.estimatedControl !== undefined) lines.push(`True Control: ${Math.round(data.estimatedControl)}`);
      if (data.estimatedHra !== undefined) lines.push(`True HRA: ${Math.round(data.estimatedHra)}`);
    } else {
      if (data.estimatedPower !== undefined) lines.push(`True Power: ${Math.round(data.estimatedPower)}`);
      if (data.estimatedEye !== undefined) lines.push(`True Eye: ${Math.round(data.estimatedEye)}`);
      if (data.estimatedAvoidK !== undefined) lines.push(`True Avoid K: ${Math.round(data.estimatedAvoidK)}`);
      if (data.estimatedContact !== undefined) lines.push(`True Contact: ${Math.round(data.estimatedContact)}`);
    }

    // SCOUTING — secondary context
    lines.push('');
    lines.push('=== SCOUTING GRADES (traditional, 20-80 scale) ===');
    if (playerType === 'pitcher') {
      if (data.scoutStuff !== undefined) lines.push(`Scout Stuff: ${data.scoutStuff}`);
      if (data.scoutControl !== undefined) lines.push(`Scout Control: ${data.scoutControl}`);
      if (data.scoutHra !== undefined) lines.push(`Scout HRA: ${data.scoutHra}`);
      if (data.scoutStamina !== undefined) lines.push(`Stamina: ${data.scoutStamina}`);
    } else {
      if (data.scoutPower !== undefined) lines.push(`Scout Power: ${data.scoutPower}`);
      if (data.scoutEye !== undefined) lines.push(`Scout Eye: ${data.scoutEye}`);
      if (data.scoutAvoidK !== undefined) lines.push(`Scout Avoid K: ${data.scoutAvoidK}`);
      if (data.scoutContact !== undefined) lines.push(`Scout Contact: ${data.scoutContact}`);
      if (data.scoutGap !== undefined) lines.push(`Scout Gap: ${data.scoutGap}`);
      if (data.scoutSpeed !== undefined) lines.push(`Scout Speed: ${data.scoutSpeed}`);
    }
    if (data.scoutOvr !== undefined) lines.push(`Scout OVR: ${data.scoutOvr}`);
    if (data.scoutPot !== undefined) lines.push(`Scout POT: ${data.scoutPot}`);

    // PROJECTIONS
    lines.push('');
    lines.push('=== PROJECTED STATS ===');
    if (playerType === 'pitcher') {
      if (data.projIp !== undefined) lines.push(`IP: ${data.projIp.toFixed(0)}`);
      if (data.projFip !== undefined) lines.push(`FIP: ${data.projFip.toFixed(2)}`);
      if (data.projK9 !== undefined) lines.push(`K/9: ${data.projK9.toFixed(2)}`);
      if (data.projBb9 !== undefined) lines.push(`BB/9: ${data.projBb9.toFixed(2)}`);
      if (data.projHr9 !== undefined) lines.push(`HR/9: ${data.projHr9.toFixed(2)}`);
      if (data.projWar !== undefined) lines.push(`WAR: ${data.projWar.toFixed(1)}`);
    } else {
      if (data.projPa !== undefined) lines.push(`PA: ${data.projPa}`);
      if (data.projAvg !== undefined) lines.push(`AVG: ${data.projAvg.toFixed(3)}`);
      if (data.projObp !== undefined) lines.push(`OBP: ${data.projObp.toFixed(3)}`);
      if (data.projSlg !== undefined) lines.push(`SLG: ${data.projSlg.toFixed(3)}`);
      if (data.projHr !== undefined) lines.push(`HR: ${data.projHr}`);
      if (data.projSb !== undefined) lines.push(`SB: ${data.projSb}`);
      if (data.projBbPct !== undefined) lines.push(`BB%: ${data.projBbPct.toFixed(1)}%`);
      if (data.projKPct !== undefined) lines.push(`K%: ${data.projKPct.toFixed(1)}%`);
      if (data.projWar !== undefined) lines.push(`WAR: ${data.projWar.toFixed(1)}`);
    }

    // LEAGUE LEADERS — for comparison context
    if (data.leagueLeaders) {
      lines.push('');
      lines.push('=== LEAGUE LEADERS (most recent season) ===');
      lines.push('Use these to contextualize this player\'s numbers. Compare where appropriate.');
      lines.push(data.leagueLeaders);
    }

    // ORG ROSTER — for fit context
    if (data.orgRoster) {
      lines.push('');
      lines.push('=== ORGANIZATION ROSTER CONTEXT ===');
      lines.push('Use this to discuss how this player fits (or could fit) in the org.');
      lines.push(data.orgRoster);
    }

    // TEAM CONTEXT (power ranking, needs)
    if (data.teamContext) {
      lines.push('');
      lines.push('=== TEAM POWER RANKING ===');
      lines.push(data.teamContext);
    }

    return lines.join('\n');
  }

  // ─── Internal: OpenAI API ────────────────────────────────────────────

  private async callOpenAI(userPrompt: string): Promise<string> {
    const apiKey = (import.meta as any).env?.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Add VITE_OPENAI_API_KEY to your .env file.');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.8,
        max_tokens: 600,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errBody}`);
    }

    const json = await response.json();
    return json.choices?.[0]?.message?.content?.trim() ?? 'No analysis generated.';
  }

  // ─── Internal: Cache Hashing ─────────────────────────────────────────

  private hashData(playerType: string, data: AIScoutingPlayerData): string {
    const hashInput: Record<string, any> = { playerType };

    const fields: (keyof AIScoutingPlayerData)[] = [
      'age', 'position', 'injuryProneness', 'parentOrg',
      'scoutStuff', 'scoutControl', 'scoutHra', 'scoutStamina',
      'scoutPower', 'scoutEye', 'scoutAvoidK', 'scoutContact', 'scoutGap', 'scoutSpeed',
      'scoutOvr', 'scoutPot',
      'trueRating', 'trueFutureRating',
      'estimatedStuff', 'estimatedControl', 'estimatedHra',
      'estimatedPower', 'estimatedEye', 'estimatedAvoidK', 'estimatedContact',
      'projFip', 'projK9', 'projBb9', 'projHr9', 'projWar', 'projIp',
      'projAvg', 'projObp', 'projSlg', 'projHr', 'projSb', 'projPa',
      'teamContext', 'leagueLeaders', 'orgRoster'
    ];

    for (const f of fields) {
      if (data[f] !== undefined) {
        const val = data[f];
        hashInput[f] = typeof val === 'number' ? Math.round(val * 100) / 100 : val;
      }
    }

    // Simple 32-bit hash
    const str = JSON.stringify(hashInput);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }
}

export const aiScoutingService = new AIScoutingService();
