import { Player, isPitcher, getFullName } from '../models/Player';
import { playerService } from './PlayerService';
import { teamService } from './TeamService';
import { trueRatingsService, TruePlayerStats, TruePlayerBattingStats } from './TrueRatingsService';

const START_YEAR = 2015;
const END_YEAR = 2021;
const MIN_IP = 30;
const MIN_PA = 100;

// --- Interfaces ---

interface PlayerYearEntry {
  year: number;
  war: number;
  orgId: number;
  orgName: string;
  age: number;
}

export interface OrgPlayerDevelopment {
  playerId: number;
  playerName: string;
  type: 'P' | 'Pos';
  ageStart: number;
  ageEnd: number;
  warStart: number;
  warEnd: number;
  warDelta: number;
  peakWar: number;
}

export interface TradeEvent {
  playerId: number;
  playerName: string;
  fromOrgId: number;
  fromOrgName: string;
  toOrgId: number;
  toOrgName: string;
  year: number;
  warBefore: number;
  warAfter: number;
  warDelta: number;
}

export interface OrgDevRanking {
  orgId: number;
  orgName: string;
  devScore: number;
  devRank: number;
  developmentScore: number;
  peakScore: number;
  agingScore: number;
  tradeImpactScore: number;
  // Raw values behind each percentile score
  rawYouthAvgDelta: number;   // Avg WAR delta for youth players
  rawPeakAvgWar: number;      // Avg peak single-season WAR
  rawAgingAvgDelta: number;   // Avg WAR delta for aging players
  rawTradeNetWar: number;     // Net WAR from trades
  playerCount: number;
  developerCount: number;
  veteranCount: number;
  topRisers: OrgPlayerDevelopment[];
  topAgers: OrgPlayerDevelopment[];
  tradeGains: TradeEvent[];
  tradeLosses: TradeEvent[];
}

// --- Service ---

class DevTrackerService {
  private cachedRankings: OrgDevRanking[] | null = null;

  async getOrgRankings(): Promise<OrgDevRanking[]> {
    if (this.cachedRankings) return this.cachedRankings;

    // Load all data in parallel
    const years = Array.from({ length: END_YEAR - START_YEAR + 1 }, (_, i) => START_YEAR + i);

    const [allTeams, allPlayers, ...statsArrays] = await Promise.all([
      teamService.getAllTeams(),
      playerService.getAllPlayers(),
      ...years.flatMap(year => [
        trueRatingsService.getTruePitchingStats(year).catch(() => [] as TruePlayerStats[]),
        trueRatingsService.getTrueBattingStats(year).catch(() => [] as TruePlayerBattingStats[]),
      ]),
    ]);

    // Build team -> parent org lookup
    const teamToOrg = new Map<number, number>();
    const orgNames = new Map<number, string>();
    for (const team of allTeams) {
      const orgId = team.parentTeamId || team.id;
      teamToOrg.set(team.id, orgId);
    }
    // Build org name lookup from parent teams (level 1 teams where parentTeamId === id or 0)
    for (const team of allTeams) {
      if (team.parentTeamId === 0 || team.parentTeamId === team.id) {
        orgNames.set(team.id, `${team.nickname}`);
      }
    }
    // Fill in any missing org names
    for (const team of allTeams) {
      const orgId = teamToOrg.get(team.id) ?? team.id;
      if (!orgNames.has(orgId)) {
        orgNames.set(orgId, `${team.nickname}`);
      }
    }

    // Build player lookup
    const playerMap = new Map<number, Player>();
    for (const p of allPlayers) {
      playerMap.set(p.id, p);
    }

    // Build player trajectories
    const trajectories = new Map<number, PlayerYearEntry[]>();

    for (let yi = 0; yi < years.length; yi++) {
      const year = years[yi];
      const pitchingStats = statsArrays[yi * 2] as TruePlayerStats[];
      const battingStats = statsArrays[yi * 2 + 1] as TruePlayerBattingStats[];

      // Process pitching stats
      for (const stat of pitchingStats) {
        const ip = trueRatingsService.parseIp(stat.ip);
        if (ip < MIN_IP) continue;
        const player = playerMap.get(stat.player_id);
        if (!player) continue;
        const teamId = stat.team_id;
        const orgId = teamToOrg.get(teamId) ?? teamId;
        const age = player.age - (END_YEAR - year);

        if (!trajectories.has(stat.player_id)) trajectories.set(stat.player_id, []);
        trajectories.get(stat.player_id)!.push({
          year, war: stat.war, orgId, orgName: orgNames.get(orgId) ?? 'Unknown', age,
        });
      }

      // Process batting stats
      for (const stat of battingStats) {
        if (stat.pa < MIN_PA) continue;
        const player = playerMap.get(stat.player_id);
        if (!player) continue;
        // Skip pitchers who happen to have batting stats
        if (isPitcher(player) && trajectories.has(stat.player_id)) continue;
        const teamId = stat.team_id;
        const orgId = teamToOrg.get(teamId) ?? teamId;
        const age = player.age - (END_YEAR - year);

        if (!trajectories.has(stat.player_id)) trajectories.set(stat.player_id, []);
        // Avoid duplicate year entries for same player (pitching already added)
        const existing = trajectories.get(stat.player_id)!;
        if (existing.some(e => e.year === year)) continue;
        existing.push({
          year, war: stat.war, orgId, orgName: orgNames.get(orgId) ?? 'Unknown', age,
        });
      }
    }

    // Sort each trajectory by year
    trajectories.forEach(entries => entries.sort((a, b) => a.year - b.year));

    // Detect trades
    const allTrades: TradeEvent[] = [];
    trajectories.forEach((entries, playerId) => {
      const player = playerMap.get(playerId);
      if (!player) return;
      const name = getFullName(player);
      for (let i = 0; i < entries.length - 1; i++) {
        if (entries[i].orgId !== entries[i + 1].orgId) {
          allTrades.push({
            playerId,
            playerName: name,
            fromOrgId: entries[i].orgId,
            fromOrgName: entries[i].orgName,
            toOrgId: entries[i + 1].orgId,
            toOrgName: entries[i + 1].orgName,
            year: entries[i + 1].year,
            warBefore: entries[i].war,
            warAfter: entries[i + 1].war,
            warDelta: entries[i + 1].war - entries[i].war,
          });
        }
      }
    });

    // Collect unique org IDs
    const orgIds = new Set<number>();
    trajectories.forEach(entries => {
      for (const e of entries) orgIds.add(e.orgId);
    });

    // Build per-org data
    const orgData = new Map<number, {
      youthDeltas: number[];
      peakWars: number[];
      agingDeltas: number[];
      tradeNetWar: number;
      playerIds: Set<number>;
      developerIds: Set<number>;
      veteranIds: Set<number>;
      youthPlayers: OrgPlayerDevelopment[];
      agingPlayers: OrgPlayerDevelopment[];
      tradeGains: TradeEvent[];
      tradeLosses: TradeEvent[];
    }>();

    for (const orgId of orgIds) {
      orgData.set(orgId, {
        youthDeltas: [],
        peakWars: [],
        agingDeltas: [],
        tradeNetWar: 0,
        playerIds: new Set(),
        developerIds: new Set(),
        veteranIds: new Set(),
        youthPlayers: [],
        agingPlayers: [],
        tradeGains: [],
        tradeLosses: [],
      });
    }

    // Process trajectories per org
    trajectories.forEach((entries, playerId) => {
      const player = playerMap.get(playerId);
      if (!player) return;
      const name = getFullName(player);
      const type = isPitcher(player) ? 'P' as const : 'Pos' as const;

      // Group entries by org
      const orgEntries = new Map<number, PlayerYearEntry[]>();
      for (const e of entries) {
        if (!orgEntries.has(e.orgId)) orgEntries.set(e.orgId, []);
        orgEntries.get(e.orgId)!.push(e);
      }

      orgEntries.forEach((oe, orgId) => {
        const data = orgData.get(orgId);
        if (!data) return;

        data.playerIds.add(playerId);

        // Peak WAR for this player on this org
        const peakWar = Math.max(...oe.map(e => e.war));
        data.peakWars.push(peakWar);

        if (oe.length < 2) return;

        // Youth development: players age 20-26 with 2+ years
        const youthEntries = oe.filter(e => e.age >= 20 && e.age <= 26);
        if (youthEntries.length >= 2) {
          const yFirst = youthEntries[0];
          const yLast = youthEntries[youthEntries.length - 1];
          const delta = yLast.war - yFirst.war;
          data.youthDeltas.push(delta);
          data.developerIds.add(playerId);
          data.youthPlayers.push({
            playerId, playerName: name, type,
            ageStart: yFirst.age, ageEnd: yLast.age,
            warStart: yFirst.war, warEnd: yLast.war,
            warDelta: delta,
            peakWar: Math.max(...youthEntries.map(e => e.war)),
          });
        }

        // Aging: players age 27+ with 2+ years
        const agingEntries = oe.filter(e => e.age >= 27);
        if (agingEntries.length >= 2) {
          const aFirst = agingEntries[0];
          const aLast = agingEntries[agingEntries.length - 1];
          const delta = aLast.war - aFirst.war;
          data.agingDeltas.push(delta);
          data.veteranIds.add(playerId);
          data.agingPlayers.push({
            playerId, playerName: name, type,
            ageStart: aFirst.age, ageEnd: aLast.age,
            warStart: aFirst.war, warEnd: aLast.war,
            warDelta: delta,
            peakWar: Math.max(...agingEntries.map(e => e.war)),
          });
        }
      });
    });

    // Process trades per org
    for (const trade of allTrades) {
      const gainOrg = orgData.get(trade.toOrgId);
      const lossOrg = orgData.get(trade.fromOrgId);
      if (gainOrg) {
        gainOrg.tradeNetWar += trade.warDelta;
        if (trade.warDelta > 0) gainOrg.tradeGains.push(trade);
      }
      if (lossOrg) {
        lossOrg.tradeNetWar -= Math.max(0, trade.warDelta);
        if (trade.warDelta > 0) lossOrg.tradeLosses.push(trade);
      }
    }

    // Calculate raw scores per org
    const rawScores: {
      orgId: number;
      youth: number;
      peak: number;
      aging: number;
      trade: number;
    }[] = [];

    for (const orgId of orgIds) {
      const data = orgData.get(orgId)!;
      const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      rawScores.push({
        orgId,
        youth: avg(data.youthDeltas),
        peak: avg(data.peakWars),
        aging: avg(data.agingDeltas),
        trade: data.tradeNetWar,
      });
    }

    // Percentile rank function (0-100)
    const percentileRank = (values: number[], value: number): number => {
      const sorted = [...values].sort((a, b) => a - b);
      const idx = sorted.findIndex(v => v >= value);
      if (idx === -1) return 100;
      if (idx === 0) return (value === sorted[0]) ? (100 / sorted.length) : 0;
      return (idx / sorted.length) * 100;
    };

    const youthValues = rawScores.map(s => s.youth);
    const peakValues = rawScores.map(s => s.peak);
    const agingValues = rawScores.map(s => s.aging);
    const tradeValues = rawScores.map(s => s.trade);

    // Build final rankings
    const rankings: OrgDevRanking[] = rawScores.map(raw => {
      const data = orgData.get(raw.orgId)!;
      const developmentScore = Math.round(percentileRank(youthValues, raw.youth));
      const peakScore = Math.round(percentileRank(peakValues, raw.peak));
      const agingScore = Math.round(percentileRank(agingValues, raw.aging));
      const tradeImpactScore = Math.round(percentileRank(tradeValues, raw.trade));
      const devScore = Math.round(
        developmentScore * 0.40 + peakScore * 0.25 + agingScore * 0.20 + tradeImpactScore * 0.15
      );

      // Sort players by WAR delta descending
      const topRisers = [...data.youthPlayers]
        .sort((a, b) => b.warDelta - a.warDelta)
        .slice(0, 5);
      const topAgers = [...data.agingPlayers]
        .sort((a, b) => b.warDelta - a.warDelta)
        .slice(0, 5);
      const tradeGains = [...data.tradeGains]
        .sort((a, b) => b.warDelta - a.warDelta)
        .slice(0, 5);
      const tradeLosses = [...data.tradeLosses]
        .sort((a, b) => b.warDelta - a.warDelta)
        .slice(0, 5);

      return {
        orgId: raw.orgId,
        orgName: orgNames.get(raw.orgId) ?? 'Unknown',
        devScore,
        devRank: 0,
        developmentScore,
        peakScore,
        agingScore,
        tradeImpactScore,
        rawYouthAvgDelta: Math.round(raw.youth * 100) / 100,
        rawPeakAvgWar: Math.round(raw.peak * 100) / 100,
        rawAgingAvgDelta: Math.round(raw.aging * 100) / 100,
        rawTradeNetWar: Math.round(raw.trade * 100) / 100,
        playerCount: data.playerIds.size,
        developerCount: data.developerIds.size,
        veteranCount: data.veteranIds.size,
        topRisers,
        topAgers,
        tradeGains,
        tradeLosses,
      };
    });

    // Sort by devScore descending and assign ranks
    rankings.sort((a, b) => b.devScore - a.devScore);
    rankings.forEach((r, i) => r.devRank = i + 1);

    // Keep only top 20
    this.cachedRankings = rankings.slice(0, 20);
    return this.cachedRankings;
  }
}

export const devTrackerService = new DevTrackerService();
