/**
 * AI Trade Analysis Service - Generates trade evaluation narratives via OpenAI API
 * Caches results in IndexedDB ai_scouting_blurbs store with key `trade_<hash>`
 */

import { indexedDBService, AIScoutingBlurbRecord } from './IndexedDBService';

export interface TradePlayerContext {
  name: string;
  role: string;        // 'SP', 'RP', 'C', '1B', etc.
  age: number;
  trueRating: number;
  trueFutureRating?: number;
  projectedWar: number;
  projectedFip?: number;
  projectedWoba?: number;
  salary?: number;
  contractYears?: number;
  isProspect: boolean;
}

export interface TradePickContext {
  displayName: string;
  estimatedValue: number;
}

export interface TradeTeamContext {
  teamName: string;
  teamRating?: number;
  rotationRating?: number;
  bullpenRating?: number;
  lineupRating?: number;
  benchRating?: number;
  sending: TradePlayerContext[];
  sendingPicks: TradePickContext[];
  postTradeRating?: number;
  postRotationRating?: number;
  postBullpenRating?: number;
  postLineupRating?: number;
  postBenchRating?: number;
}

export interface TradeContext {
  team1: TradeTeamContext;
  team2: TradeTeamContext;
  team1TotalWar: number;
  team2TotalWar: number;
}

const TRADE_SYSTEM_PROMPT = `You are the lead trade analyst at True Ratings — the FanGraphs of the World Baseball League (WBL). You write with confident, dry wit and sharp analytical insight.

Your job is to evaluate a proposed trade between two teams. Consider:
1. **WAR Balance** — Which side gets more projected WAR? Is the gap significant?
2. **Team Fit** — Does each team address a need? A rebuilding team values prospects differently than a contender.
3. **Timeline** — Age and contract years matter. A team getting younger or older changes the calculus.
4. **Positional Scarcity** — Pitching is scarce in this league. Good catchers are rare. Don't treat all WAR equally.
5. **Prospect Risk** — Prospects carry more risk than proven MLB players. Discount accordingly.
6. **Contract Value** — Salary dump vs taking on money matters. League min is $228k, good players make $6-10M, stars $12M+.

TERMINOLOGY:
- True Ratings (TR) are numeric (e.g., "4.2 TR"). NEVER refer to them as stars.
- True Future Rating (TFR) follows the same rule.

Write 2-3 paragraphs, max 250 words. Be direct about which team wins the trade and why. If it's close, say so. Reference specific players by name, not generic descriptions.`;

class AITradeAnalysisService {

  async getTradeAnalysis(context: TradeContext): Promise<string> {
    const dataHash = this.hashTradeContext(context);
    const cacheKey = `trade_${dataHash}`;

    // Check cache using the ai_scouting_blurbs store with a synthetic player ID
    const syntheticId = Math.abs(this.hashToNumber(dataHash));
    const cached = await indexedDBService.getAIBlurb(syntheticId, 'pitcher');
    if (cached && cached.dataHash === dataHash) {
      return cached.blurbText;
    }

    const userPrompt = this.buildTradePrompt(context);
    console.log('%c[Trade Analysis] Prompt', 'color: #f6c; font-weight: bold');
    console.log(userPrompt);

    const blurb = await this.callOpenAI(userPrompt);

    // Cache result
    const record: AIScoutingBlurbRecord = {
      key: cacheKey,
      playerId: syntheticId,
      playerType: 'pitcher',
      blurbText: blurb,
      dataHash,
      generatedAt: Date.now()
    };
    await indexedDBService.saveAIBlurb(record);

    return blurb;
  }

  private buildTradePrompt(context: TradeContext): string {
    const lines: string[] = [];

    lines.push('=== PROPOSED TRADE ===');
    lines.push('');

    // Team 1
    lines.push(`--- ${context.team1.teamName.toUpperCase()} SENDS ---`);
    this.appendPlayerLines(lines, context.team1.sending);
    this.appendPickLines(lines, context.team1.sendingPicks);
    lines.push(`Total WAR being sent: ${context.team1TotalWar.toFixed(1)}`);
    lines.push('');

    // Team 2
    lines.push(`--- ${context.team2.teamName.toUpperCase()} SENDS ---`);
    this.appendPlayerLines(lines, context.team2.sending);
    this.appendPickLines(lines, context.team2.sendingPicks);
    lines.push(`Total WAR being sent: ${context.team2TotalWar.toFixed(1)}`);
    lines.push('');

    // WAR balance
    const warDiff = Math.abs(context.team1TotalWar - context.team2TotalWar);
    lines.push(`=== WAR BALANCE ===`);
    lines.push(`Difference: ${warDiff.toFixed(1)} WAR`);
    lines.push('');

    // Team context
    if (context.team1.teamRating !== undefined) {
      lines.push('=== TEAM CONTEXT ===');
      lines.push('');
      this.appendTeamContext(lines, context.team1);
      lines.push('');
      this.appendTeamContext(lines, context.team2);
      lines.push('');
    }

    // Post-trade impact
    if (context.team1.postTradeRating !== undefined && context.team1.teamRating !== undefined) {
      lines.push('=== POST-TRADE IMPACT ===');
      const t1Delta = context.team1.postTradeRating! - context.team1.teamRating!;
      const t2Delta = context.team2.postTradeRating! - context.team2.teamRating!;
      lines.push(`${context.team1.teamName}: ${context.team1.teamRating!.toFixed(2)} -> ${context.team1.postTradeRating!.toFixed(2)} (${t1Delta >= 0 ? '+' : ''}${t1Delta.toFixed(2)})`);
      lines.push(`${context.team2.teamName}: ${context.team2.teamRating!.toFixed(2)} -> ${context.team2.postTradeRating!.toFixed(2)} (${t2Delta >= 0 ? '+' : ''}${t2Delta.toFixed(2)})`);
    }

    return lines.join('\n');
  }

  private appendPlayerLines(lines: string[], players: TradePlayerContext[]): void {
    for (const p of players) {
      const parts: string[] = [];
      parts.push(`${p.name} (${p.role}, Age ${p.age})`);
      parts.push(`TR: ${p.trueRating.toFixed(1)}`);
      if (p.trueFutureRating !== undefined) {
        parts.push(`TFR: ${p.trueFutureRating.toFixed(1)}`);
      }
      if (p.projectedFip !== undefined) {
        parts.push(`Proj FIP: ${p.projectedFip.toFixed(2)}`);
      }
      if (p.projectedWoba !== undefined) {
        parts.push(`Proj wOBA: ${p.projectedWoba.toFixed(3)}`);
      }
      parts.push(`Proj WAR: ${p.projectedWar.toFixed(1)}`);
      if (p.salary !== undefined && p.salary > 0) {
        parts.push(`Salary: $${(p.salary / 1000).toFixed(0)}k`);
      }
      if (p.contractYears !== undefined && p.contractYears > 0) {
        parts.push(`${p.contractYears}yr ctrl`);
      }
      if (p.isProspect) {
        parts.push('[PROSPECT]');
      }
      lines.push(`  ${parts.join(' | ')}`);
    }
  }

  private appendPickLines(lines: string[], picks: TradePickContext[]): void {
    for (const pick of picks) {
      lines.push(`  ${pick.displayName} (Est. ${pick.estimatedValue.toFixed(1)} WAR)`);
    }
  }

  private appendTeamContext(lines: string[], team: TradeTeamContext): void {
    lines.push(`${team.teamName}:`);
    if (team.teamRating !== undefined) {
      lines.push(`  Overall: ${team.teamRating.toFixed(2)} TR`);
    }
    if (team.rotationRating !== undefined) {
      lines.push(`  Rotation: ${team.rotationRating.toFixed(2)} | Bullpen: ${team.bullpenRating!.toFixed(2)} | Lineup: ${team.lineupRating!.toFixed(2)} | Bench: ${team.benchRating!.toFixed(2)}`);

      // Identify weakest area
      const weakest = Math.min(team.rotationRating!, team.bullpenRating!, team.lineupRating!);
      if (weakest < 3.0) {
        if (weakest === team.rotationRating) {
          lines.push('  NEED: Rotation is a weakness');
        } else if (weakest === team.bullpenRating) {
          lines.push('  NEED: Bullpen is thin');
        } else {
          lines.push('  NEED: Lineup needs help');
        }
      }
    }
  }

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
          { role: 'system', content: TRADE_SYSTEM_PROMPT },
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

  private hashTradeContext(context: TradeContext): string {
    // Build a stable hash from player IDs and pick descriptions
    const playerIds = [
      ...context.team1.sending.map(p => p.name),
      '|',
      ...context.team2.sending.map(p => p.name),
      '|',
      ...context.team1.sendingPicks.map(p => p.displayName),
      '|',
      ...context.team2.sendingPicks.map(p => p.displayName),
    ];
    const str = JSON.stringify(playerIds);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

  private hashToNumber(hash: string): number {
    let num = 0;
    for (let i = 0; i < hash.length; i++) {
      num = ((num << 5) - num) + hash.charCodeAt(i);
      num |= 0;
    }
    return num;
  }
}

export const aiTradeAnalysisService = new AITradeAnalysisService();
