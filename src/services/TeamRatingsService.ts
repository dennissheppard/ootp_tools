import { playerService } from './PlayerService';
import { teamService } from './TeamService';
import { trueRatingsService } from './TrueRatingsService';
import { scoutingDataService } from './ScoutingDataService';
import { trueRatingsCalculationService } from './TrueRatingsCalculationService';
import { leagueStatsService } from './LeagueStatsService';
import { fipWarService } from './FipWarService';
import { PitcherScoutingRatings } from '../models/ScoutingData';
import { projectionService } from './ProjectionService';

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
    war?: number;
  };
}

export interface TeamRatingResult {
  teamId: number;
  teamName: string;
  seasonYear?: number;
  rotationRunsAllowed: number;
  bullpenRunsAllowed: number;
  rotationLeagueAvgRuns: number;
  bullpenLeagueAvgRuns: number;
  rotationRunsSaved: number;
  bullpenRunsSaved: number;
  rotation: RatedPlayer[];
  bullpen: RatedPlayer[];
}

class TeamRatingsService {
  async getProjectedTeamRatings(baseYear: number): Promise<TeamRatingResult[]> {
      const projections = await projectionService.getProjections(baseYear, { forceRosterRefresh: true });
      const leagueStats = await leagueStatsService.getLeagueStats(baseYear);
      
      const teamGroups = new Map<number, { rotation: RatedPlayer[], bullpen: RatedPlayer[] }>();
      const teams = await teamService.getAllTeams();
      const teamMap = new Map(teams.map(t => [t.id, t]));

      projections.forEach(p => {
          if (p.teamId === 0) return; // Skip FA

          // Use the role classification from the projection service
          // (already determined based on scouting, historical GS, etc.)
          const isSp = p.isSp;

          const ratedPlayer: RatedPlayer = {
              playerId: p.playerId,
              name: p.name,
              trueRating: p.projectedTrueRating,
              trueStuff: p.projectedRatings.stuff,
              trueControl: p.projectedRatings.control,
              trueHra: p.projectedRatings.hra,
              pitchCount: 0, // Not available in projection output, but used for classification which is already done
              isSp,
              stats: {
                  ip: p.projectedStats.ip,
                  k9: p.projectedStats.k9,
                  bb9: p.projectedStats.bb9,
                  hr9: p.projectedStats.hr9,
                  gs: isSp ? 30 : 0, // Mock GS
                  era: 0, // ERA not projected
                  fip: p.projectedStats.fip,
                  war: p.projectedStats.war
              }
          };

          if (!teamGroups.has(p.teamId)) {
              teamGroups.set(p.teamId, { rotation: [], bullpen: [] });
          }
          const group = teamGroups.get(p.teamId)!;
          if (isSp) {
              group.rotation.push(ratedPlayer);
          } else {
              group.bullpen.push(ratedPlayer);
          }
      });

      const results: TeamRatingResult[] = [];
      teamGroups.forEach((group, teamId) => {
          const team = teamMap.get(teamId);
          if (team && team.parentTeamId !== 0) return;

          // Sort by Projected TR desc
          group.rotation.sort((a, b) => b.trueRating - a.trueRating);
          group.bullpen.sort((a, b) => b.trueRating - a.trueRating);

          const topRotation = group.rotation.slice(0, 5);
          const topBullpen = group.bullpen.slice(0, 5);
          const rotationRuns = this.calculateRunSummary(topRotation, leagueStats.avgFip);
          const bullpenRuns = this.calculateRunSummary(topBullpen, leagueStats.avgFip);

          results.push({
              teamId,
              teamName: team ? team.nickname : `Team ${teamId}`,
              seasonYear: baseYear + 1,
              rotationRunsAllowed: rotationRuns.runsAllowed,
              bullpenRunsAllowed: bullpenRuns.runsAllowed,
              rotationLeagueAvgRuns: rotationRuns.leagueAvgRuns,
              bullpenLeagueAvgRuns: bullpenRuns.leagueAvgRuns,
              rotationRunsSaved: rotationRuns.runsSaved,
              bullpenRunsSaved: bullpenRuns.runsSaved,
              rotation: group.rotation,
              bullpen: group.bullpen
          });
      });

      return results;
  }

  async getTeamRatings(year: number): Promise<TeamRatingResult[]> {
    // 1. Fetch Data
    const [pitchingStats, leagueStats, scoutingRatings, multiYearStats, allPlayers, allTeams] = await Promise.all([
      trueRatingsService.getTruePitchingStats(year),
      leagueStatsService.getLeagueStats(year),
      scoutingDataService.getScoutingRatings(year),
      trueRatingsService.getMultiYearPitchingStats(year, 3),
      playerService.getAllPlayers(),
      teamService.getAllTeams()
    ]);

    // Note: getLeagueAverages removed from promise all since it wasn't being used directly in inputs anymore?
    // Wait, TrueRatingsCalculationService needs leagueAverages.
    // Let's re-add it to be safe and match original logic.
    const leagueAverages = await trueRatingsService.getLeagueAverages(year);

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
        const allPitchCount = Object.keys(pitches).length;
        const usablePitchCount = Object.values(pitches).filter(rating => rating >= 45).length;

        // Stats parsing
        const ip = trueRatingsService.parseIp(stat.ip);
        const k9 = ip > 0 ? (stat.k / ip) * 9 : 0;
        const bb9 = ip > 0 ? (stat.bb / ip) * 9 : 0;
        const hr9 = ip > 0 ? (stat.hra / ip) * 9 : 0;
        const era = ip > 0 ? (stat.er / ip) * 9 : 0;
        const fip = fipWarService.calculateFip({ ip, k9, bb9, hr9 }, leagueStats.fipConstant);

        // Classification Logic
        // Priority 1: Check multi-year GS history (most reliable)
        const historicalStats = multiYearStats.get(stat.player_id) ?? [];
        const totalGs = historicalStats.reduce((sum, s) => sum + (s.gs ?? 0), 0);
        const hasStarterHistory = totalGs >= 5;

        // Priority 2: Check current year stats
        const hasStarterRole = stat.gs >= 5;

        // Priority 3: Check scouting profile (usable pitches + stamina)
        const stamina = scouting?.stamina ?? 0;
        const hasStarterProfile = usablePitchCount >= 3 && stamina >= 30;

        // Classify as SP if they have starter history OR current starter role OR clear starter profile
        // BUT require at least some evidence (not just 3 weak pitches)
        let isSp = false;
        let classificationReason = 'RP (default)';

        if (hasStarterHistory || hasStarterRole) {
            // Stats say starter
            isSp = true;
            classificationReason = hasStarterHistory
                ? `SP (${totalGs} total GS in last 3 years)`
                : `SP (${stat.gs} GS this year)`;
        } else if (hasStarterProfile && allPitchCount > 0) {
            // Scouting says starter (only if we have actual scouting data)
            isSp = true;
            classificationReason = `SP (${usablePitchCount} pitches, ${stamina} stam)`;
        } else if (allPitchCount === 0 && stat.gs >= 1) {
            // Fallback: No scouting data, but started some games this year
            isSp = true;
            classificationReason = `SP (${stat.gs} GS, no scouting)`;
        } else {
            classificationReason = `RP (${usablePitchCount}/${allPitchCount} pitches, ${stamina} stam, ${totalGs} GS)`;
        }

        // Debug logging for high-rated relievers in rotations
        if (isSp && (stat.playerName.includes('DEBUG') || Math.random() < 0.01)) {
            console.log(`[Team Ratings] ${stat.playerName}: ${classificationReason}`, {
                currentGS: stat.gs,
                totalGs,
                usablePitchCount,
                allPitchCount,
                stamina,
                historicalStats: historicalStats.map(s => ({ year: s.year, gs: s.gs, ip: s.ip }))
            });
        }

        const ratedPlayer: RatedPlayer = {
            playerId: stat.player_id,
            name: stat.playerName,
            trueRating: trData.trueRating,
            trueStuff: trData.estimatedStuff,
            trueControl: trData.estimatedControl,
            trueHra: trData.estimatedHra,
            pitchCount: usablePitchCount,
            isSp,
            stats: {
                ip, k9, bb9, hr9, gs: stat.gs,
                era, fip,
                war: stat.war
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

        const topRotation = group.rotation.slice(0, 5);
        const topBullpen = group.bullpen.slice(0, 5);
        const rotationRuns = this.calculateRunSummary(topRotation, leagueStats.avgFip);
        const bullpenRuns = this.calculateRunSummary(topBullpen, leagueStats.avgFip);

        results.push({
            teamId,
            teamName: team ? team.nickname : `Team ${teamId}`,
            seasonYear: year,
            rotationRunsAllowed: rotationRuns.runsAllowed,
            bullpenRunsAllowed: bullpenRuns.runsAllowed,
            rotationLeagueAvgRuns: rotationRuns.leagueAvgRuns,
            bullpenLeagueAvgRuns: bullpenRuns.leagueAvgRuns,
            rotationRunsSaved: rotationRuns.runsSaved,
            bullpenRunsSaved: bullpenRuns.runsSaved,
            rotation: group.rotation,
            bullpen: group.bullpen
        });
    });

    return results;
  }

  async getAllTimeTeamRatings(years: number[]): Promise<TeamRatingResult[]> {
    const results: TeamRatingResult[] = [];
    for (const year of years) {
      try {
        const yearly = await this.getTeamRatings(year);
        results.push(...yearly);
      } catch (error) {
        console.warn(`TeamRatings: failed to load year ${year}`, error);
      }
    }
    return results;
  }

  private normalizeName(name: string): string {
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
    const cleaned = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter((token) => token && !suffixes.has(token));
    return tokens.join('');
  }

  private calculateRunSummary(players: RatedPlayer[], leagueAvgFip: number): { runsAllowed: number; leagueAvgRuns: number; runsSaved: number } {
    const totalIp = players.reduce((sum, player) => sum + (Number.isFinite(player.stats.ip) ? player.stats.ip : 0), 0);
    const runsAllowed = players.reduce((sum, player) => {
      if (!Number.isFinite(player.stats.fip) || !Number.isFinite(player.stats.ip)) return sum;
      return sum + this.calculateRunsAllowed(player.stats.fip, player.stats.ip);
    }, 0);
    const leagueAvgRuns = this.calculateRunsAllowed(leagueAvgFip, totalIp);
    return {
      runsAllowed,
      leagueAvgRuns,
      runsSaved: leagueAvgRuns - runsAllowed,
    };
  }

  private calculateRunsAllowed(fip: number, ip: number): number {
    if (!Number.isFinite(fip) || !Number.isFinite(ip) || ip <= 0) return 0;
    return (fip * ip) / 9;
  }
}

export const teamRatingsService = new TeamRatingsService();
