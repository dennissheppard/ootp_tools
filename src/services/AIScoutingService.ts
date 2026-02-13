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
  scoutStealAbility?: number;
  scoutStealAggression?: number;
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

  // Personality traits (H = high, N = neutral, L = low)
  leadership?: 'H' | 'N' | 'L';
  loyalty?: 'H' | 'N' | 'L';
  adaptability?: 'H' | 'N' | 'L';
  greed?: 'H' | 'N' | 'L';
  workEthic?: 'H' | 'N' | 'L';
  intelligence?: 'H' | 'N' | 'L';

  // Contract info
  contractSalary?: string;
  contractYears?: string;
  contractClauses?: string;

  // Rich context strings (populated internally by the service)
  teamContext?: string;
  leagueLeaders?: string;
  orgRoster?: string;
}

const SYSTEM_PROMPT = `You are the snarky lead analyst at True Ratings — the FanGraphs of the World Baseball League (WBL). You write with confident, dry wit and sharp analytical insight. Sometimes you can be biting. You value numbers first, but understand roster construction and league context.

TERMINOLOGY:
- True Ratings (TR) are numeric (e.g., "4.2 True Rating" or "4.2 TR"). NEVER refer to them as stars.
- True Future Rating (TFR) follows the same rule.
- Component ratings (True Stuff, True Power, etc.) use the 20–80 scouting scale.

LEAGUE CONTEXT:
- WBL uses real baseball mechanics.
- Pitching is scarce and highly valued.
- Home runs are trending down; the gap between 70 and 80 power is smaller than it used to be. League leaders are hitting about 30, so lower power guys who hit ~10 aren't necessarily considered low value, especially if they have high Average or Gap ratings. 
- Because home runs have been trending down, elite HRA (home run allowed) rated pitchers might not be as valuable as they once were - guys with a 60 only give up a few more homers than a guy with an 80.
- Good hitting catchers are extremely rare/valuable.
- True Ratings are performance-driven and more reliable than scouting for MLB-level players. The more MLB data a player has, the more reliable True Ratings are.
- TFR blends minor league performance and scouting to project ceiling.
- Older players who have been on the same team for many years are emotionally valuable and revered. Numbers will be retired, children named after, etc.

ANALYSIS PRINCIPLES:
- Lead with True Ratings — they are the foundation, your bread & butter. True Ratings are the intended replacement for scouting ratings.
- Only use scouting ratings as supporting context if they differ from the TR. But you know True Ratings are better.
- For prospects under 21, only look at Future Ratings and scouting. Those players haven't had time to develop their True Ratings yet.
- For prospects 21 and over, you can use True Ratings more, but until they have MLB experience, you're Future focused
- Once a player has a couple of major league seasons under his belt his True Future Ratings become his True Ratings. Scouting ratings are always 'potential' or future focused.
- Analyze the ratings and stats and context — do not simply restate numbers.
- Compare projections to league leaders, team needs, and historical context.
- Frame minor leaguers in terms of their parent organization.
- Be specific: “His projected 3.15 FIP would have ranked 4th last season” is better than “He has good stuff.”
- A 5.0 TR is a superstar. A 2.5 TR is average. 2.0 is probably replacement level. A 5.0 TFR signals elite prospect ceiling.
- Put a player's history into perspective. If he's been on a team for 15 years and is aging and not as good now, nod to that, show respect, don't just bash.
- If salary information is available and you reference it, use the following as context: league minimum salary is $228k. Arbitration eligible guys are usually getting between $1m-$8m. Very good players make $6m-$10m. Super stars make $12m+. Anything north of $21m for a single season is eye popping.
- If personality information is available and you reference it, only link personality to performance where it makes sense. Greed doesn't impact performance, but might impact contract. A low work ethic or adaptibility or intelligence may impact performance or development or growth.

Format your response in a structured, sectioned summary style scouting report of no more than 200 words. Use bullets if it helps your point. All of the numbers you'd be referencing are already in charts above this analysis. Do not restate a table or listing or bullets of ratings or stats or player information. It would be redundant with the player profile.
`;

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
    console.log(`%c[True Analysis] Prompt for ${data.playerName}`, 'color: #6cf; font-weight: bold');
    console.log(userPrompt);
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

    // PERSONALITY — clubhouse context
    const traitMap: Record<string, string> = { H: 'High', N: 'Average', L: 'Low' };
    const traits: string[] = [];
    if (data.leadership) traits.push(`Leadership: ${traitMap[data.leadership]}`);
    if (data.workEthic) traits.push(`Work Ethic: ${traitMap[data.workEthic]}`);
    if (data.intelligence) traits.push(`Intelligence: ${traitMap[data.intelligence]}`);
    if (data.loyalty) traits.push(`Loyalty: ${traitMap[data.loyalty]}`);
    if (data.greed) traits.push(`Greed: ${traitMap[data.greed]}`);
    if (data.adaptability) traits.push(`Adaptability: ${traitMap[data.adaptability]}`);
    if (traits.length > 0) {
      lines.push('');
      lines.push('=== PERSONALITY ===');
      traits.forEach(t => lines.push(t));
    }

    // CONTRACT — financial context
    if (data.contractSalary || data.contractYears) {
      lines.push('');
      lines.push('=== CONTRACT ===');
      if (data.contractSalary) lines.push(`Current Salary: ${data.contractSalary}`);
      if (data.contractYears) lines.push(`Contract: ${data.contractYears}`);
      if (data.contractClauses) lines.push(`Clauses: ${data.contractClauses}`);
    }

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
      if (data.scoutStealAbility !== undefined) lines.push(`Stealing Ability: ${data.scoutStealAbility}`);
      if (data.scoutStealAggression !== undefined) lines.push(`Stealing Aggressiveness: ${data.scoutStealAggression}`);
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
      'scoutStealAbility', 'scoutStealAggression',
      'scoutOvr', 'scoutPot',
      'trueRating', 'trueFutureRating',
      'estimatedStuff', 'estimatedControl', 'estimatedHra',
      'estimatedPower', 'estimatedEye', 'estimatedAvoidK', 'estimatedContact',
      'projFip', 'projK9', 'projBb9', 'projHr9', 'projWar', 'projIp',
      'projAvg', 'projObp', 'projSlg', 'projHr', 'projSb', 'projPa',
      'leadership', 'loyalty', 'adaptability', 'greed', 'workEthic', 'intelligence',
      'contractSalary', 'contractYears', 'contractClauses',
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

/**
 * Convert markdown text (as returned by the AI) to safe HTML.
 * Handles: headers, bold, italic, unordered lists, horizontal rules, paragraphs, line breaks.
 */
export function markdownToHtml(md: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    escape(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/  $/, '<br>');

  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let inParagraph = false;

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Horizontal rule
    if (/^-{3,}$/.test(line) || /^\*{3,}$/.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inParagraph) { out.push('</p>'); inParagraph = false; }
      out.push('<hr>');
      continue;
    }

    // Headers
    const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inParagraph) { out.push('</p>'); inParagraph = false; }
      // Map # → h3, ## → h3, ### → h4, #### → h5 (keep headings small in modal)
      const level = Math.min(hMatch[1].length + 2, 5);
      out.push(`<h${level}>${inline(hMatch[2])}</h${level}>`);
      continue;
    }

    // Unordered list items
    const liMatch = line.match(/^[-*]\s+(.+)$/);
    if (liMatch) {
      if (inParagraph) { out.push('</p>'); inParagraph = false; }
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(liMatch[1])}</li>`);
      continue;
    }

    // Close list if we hit a non-list line
    if (inList) { out.push('</ul>'); inList = false; }

    // Empty line = paragraph break
    if (line.trim() === '') {
      if (inParagraph) { out.push('</p>'); inParagraph = false; }
      continue;
    }

    // Regular text
    if (!inParagraph) { out.push('<p>'); inParagraph = true; }
    else { out.push('<br>'); }
    out.push(inline(line));
  }

  if (inList) out.push('</ul>');
  if (inParagraph) out.push('</p>');

  return out.join('\n');
}
