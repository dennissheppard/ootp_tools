import { playerService } from './PlayerService';
import { teamService } from './TeamService';
import { trueRatingsService } from './TrueRatingsService';
import { scoutingDataService } from './ScoutingDataService';
import { trueRatingsCalculationService } from './TrueRatingsCalculationService';
import { leagueStatsService } from './LeagueStatsService';
import { fipWarService } from './FipWarService';
import { PitcherScoutingRatings } from '../models/ScoutingData';

export interface RatedPlayer {
  playerId: number;
  name: string;
  trueRating: number;
  trueStuff: number;
  trueControl: number;
  trueHra: number;
  pitchCount: number;
  isSp: boolean;
  stats: {
    ip: number;
    k9: number;
    bb9: number;
    hr9: number;
    gs: number;
    era: number;
    fip: number;
  };
}

export interface TeamRatingResult {
  teamId: number;
  teamName: string;
  rotationScore: number;
  bullpenScore: number;
  rotation: RatedPlayer[];
  bullpen: RatedPlayer[];
}

class TeamRatingsService {
  async getTeamRatings(year: number): Promise<TeamRatingResult[]> {
    // 1. Fetch Data
    const [pitchingStats, leagueAverages, leagueStats, scoutingRatings, multiYearStats, allPlayers, allTeams] = await Promise.all([
      trueRatingsService.getTruePitchingStats(year),
      trueRatingsService.getLeagueAverages(year),
      leagueStatsService.getLeagueStats(year),
      scoutingDataService.getScoutingRatings(year),
      trueRatingsService.getMultiYearPitchingStats(year, 3),
      playerService.getAllPlayers(),
      teamService.getAllTeams()
    ]);

    // 2. Maps for lookup
    const playerMap = new Map(allPlayers.map(p => [p.id, p]));
    const teamMap = new Map(allTeams.map(t => [t.id, t]));
    const scoutingMap = new Map<number, PitcherScoutingRatings>();
    const scoutingByName = new Map<string, PitcherScoutingRatings[]>();

    scoutingRatings.forEach(s => {
      if (s.playerId > 0) scoutingMap.set(s.playerId, s);
      if (s.playerName) {
        const norm = this.normalizeName(s.playerName);
        if (norm) {
             const list = scoutingByName.get(norm) ?? [];
             list.push(s);
             scoutingByName.set(norm, list);
        }
      }
    });

    // 3. Prepare Input for TR Calculation
    const inputs = pitchingStats.map(stat => {
        let scouting = scoutingMap.get(stat.player_id);
        if (!scouting && stat.playerName) {
            const norm = this.normalizeName(stat.playerName);
            const matches = scoutingByName.get(norm);
            if (matches && matches.length === 1) scouting = matches[0];
        }

        return {
            playerId: stat.player_id,
            playerName: stat.playerName,
            yearlyStats: multiYearStats.get(stat.player_id) ?? [],
            scoutingRatings: scouting
        };
    });

    // 4. Calculate True Ratings
    const trResults = trueRatingsCalculationService.calculateTrueRatings(inputs, leagueAverages);
    const trMap = new Map(trResults.map(tr => [tr.playerId, tr]));

    // 5. Process Players & Classify
    const teamGroups = new Map<number, { rotation: RatedPlayer[], bullpen: RatedPlayer[] }>();

    pitchingStats.forEach(stat => {
        const player = playerMap.get(stat.player_id);
        if (!player) return;
        
        const teamId = stat.team_id;
        if (teamId === 0) return;

        const trData = trMap.get(stat.player_id);
        if (!trData) return;

        // Get scouting for pitch count
        let scouting = scoutingMap.get(stat.player_id);
        if (!scouting && stat.playerName) {
            const norm = this.normalizeName(stat.playerName);
            const matches = scoutingByName.get(norm);
            if (matches && matches.length === 1) scouting = matches[0];
        }

        const pitches = scouting?.pitches ?? {};
        const pitchCount = Object.keys(pitches).length;
        
        // Stats parsing
        const ip = trueRatingsService.parseIp(stat.ip);
        const k9 = ip > 0 ? (stat.k / ip) * 9 : 0;
        const bb9 = ip > 0 ? (stat.bb / ip) * 9 : 0;
        const hr9 = ip > 0 ? (stat.hra / ip) * 9 : 0;
        const era = ip > 0 ? (stat.er / ip) * 9 : 0;
        const fip = fipWarService.calculateFip({ ip, k9, bb9, hr9 }, leagueStats.fipConstant);

        // Classification
        // SP if > 2 pitches OR (no pitch data AND gs >= 5)
        const isSp = pitchCount > 2 || (pitchCount === 0 && stat.gs >= 5);

        const ratedPlayer: RatedPlayer = {
            playerId: stat.player_id,
            name: stat.playerName,
            trueRating: trData.trueRating,
            trueStuff: trData.estimatedStuff,
            trueControl: trData.estimatedControl,
            trueHra: trData.estimatedHra,
            pitchCount,
            isSp,
            stats: { 
                ip, k9, bb9, hr9, gs: stat.gs,
                era, fip
            }
        };

        if (!teamGroups.has(teamId)) {
            teamGroups.set(teamId, { rotation: [], bullpen: [] });
        }
        const group = teamGroups.get(teamId)!;
        if (isSp) {
            group.rotation.push(ratedPlayer);
        } else {
            group.bullpen.push(ratedPlayer);
        }
    });

    // 6. Aggregate per Team
    const results: TeamRatingResult[] = [];

    teamGroups.forEach((group, teamId) => {
        const team = teamMap.get(teamId);
        if (team && team.parentTeamId !== 0) return; 

        // Sort players by TR desc
        group.rotation.sort((a, b) => b.trueRating - a.trueRating);
        group.bullpen.sort((a, b) => b.trueRating - a.trueRating);

        // Calculate Scores
        const rotScore = group.rotation.slice(0, 5).reduce((sum, p) => sum + p.trueRating, 0);
        const penScore = group.bullpen.slice(0, 5).reduce((sum, p) => sum + p.trueRating, 0);

        results.push({
            teamId,
            teamName: team ? team.nickname : `Team ${teamId}`,
            rotationScore: Math.round(rotScore * 10) / 10,
            bullpenScore: Math.round(penScore * 10) / 10,
            rotation: group.rotation,
            bullpen: group.bullpen
        });
    });

    return results;
  }

  private normalizeName(name: string): string {
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
    const cleaned = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter((token) => token && !suffixes.has(token));
    return tokens.join('');
  }
}

export const teamRatingsService = new TeamRatingsService();
