import { teamService } from './TeamService';
import { trueRatingsService } from './TrueRatingsService';
import { scoutingDataFallbackService } from './ScoutingDataFallbackService';
import { trueRatingsCalculationService } from './TrueRatingsCalculationService';
import { leagueStatsService } from './LeagueStatsService';
import { fipWarService } from './FipWarService';
import { RatingEstimatorService } from './RatingEstimatorService';
import { PitcherScoutingRatings, HitterScoutingRatings } from '../models/ScoutingData';
import { projectionService } from './ProjectionService';
import { dateService } from './DateService';
import { playerService } from './PlayerService';
import { trueFutureRatingService } from './TrueFutureRatingService';
import { hitterTrueFutureRatingService, HitterTrueFutureRatingInput } from './HitterTrueFutureRatingService';
import { hitterScoutingDataService } from './HitterScoutingDataService';
import { minorLeagueBattingStatsService } from './MinorLeagueBattingStatsService';
import { leagueBattingAveragesService } from './LeagueBattingAveragesService';

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

export interface RatedProspect {
    playerId: number;
    name: string;
    trueFutureRating: number;
    age: number;
    level: string;
    teamId: number;
    orgId: number;
    peakFip: number;
    peakWar: number;
    peakIp?: number;
    projK9?: number;
    projBb9?: number;
    projHr9?: number;
    percentile?: number;
    stuffPercentile?: number;
    controlPercentile?: number;
    hraPercentile?: number;
    potentialRatings: {
        stuff: number;
        control: number;
        hra: number;
    };
    scoutingRatings: {
        stuff: number;
        control: number;
        hra: number;
        stamina: number;
        pitches: number;
    };
    stats: {
        ip: number;
        k9: number;
        bb9: number;
        hr9: number;
    };
}

export interface FarmSystemRankings {
    teamId: number;
    teamName: string;
    rotationScore: number;
    bullpenScore: number;
    rotation: RatedProspect[]; // Top 5
    bullpen: RatedProspect[];  // Top 5
    allProspects: RatedProspect[]; // Full List
}

export interface FarmSystemOverview {
    teamId: number;
    teamName: string;
    totalWar: number;
    prospectCount: number;
    topProspectName: string;
    topProspectId: number;
    tierCounts: {
        elite: number; // 4.5+
        aboveAvg: number; // 3.5 - 4.0
        average: number; // 2.5 - 3.0
        fringe: number; // < 2.5
    };
}

export interface FarmData {
    reports: FarmSystemRankings[];
    systems: FarmSystemOverview[];
    prospects: RatedProspect[];
}

// ============================================================================
// Hitter Prospect Interfaces
// ============================================================================

export interface RatedHitterProspect {
    playerId: number;
    name: string;
    trueFutureRating: number;
    age: number;
    level: string;
    teamId: number;
    orgId: number;
    /** Projected wOBA at peak */
    projWoba: number;
    /** Percentile rank among hitter prospects */
    percentile: number;
    /** Projected rate stats */
    projBbPct: number;
    projKPct: number;
    projIso: number;
    projAvg: number;
    /** Derived rate stats */
    projObp: number;
    projSlg: number;
    projOps: number;
    /** Projected PA (based on injury proneness) */
    projPa: number;
    /** wRC+ (100 = league average) */
    wrcPlus: number;
    /** Projected batting WAR */
    projWar: number;
    /** Total minor league PA */
    totalMinorPa: number;
    /** Injury proneness */
    injuryProneness?: string;
    /** Scouting ratings */
    scoutingRatings: {
        power: number;
        eye: number;
        avoidK: number;
        babip: number;
        gap: number;
        speed: number;
        ovr: number;
        pot: number;
    };
    /** Position */
    position: number;
}

export interface HitterFarmSystemRankings {
    teamId: number;
    teamName: string;
    totalScore: number;
    allProspects: RatedHitterProspect[];
}

export interface HitterFarmSystemOverview {
    teamId: number;
    teamName: string;
    totalScore: number;
    prospectCount: number;
    topProspectName: string;
    topProspectId: number;
    tierCounts: {
        elite: number;     // TFR >= 4.5
        aboveAvg: number;  // TFR 3.5-4.4
        average: number;   // TFR 2.5-3.4
        fringe: number;    // TFR < 2.5
    };
}

export interface HitterFarmData {
    reports: HitterFarmSystemRankings[];
    systems: HitterFarmSystemOverview[];
    prospects: RatedHitterProspect[];
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
  rotationWar: number;
  bullpenWar: number;
  rotation: RatedPlayer[];
  bullpen: RatedPlayer[];
}

class TeamRatingsService {
  async getFarmData(year: number): Promise<FarmData> {
      // Fetch scouting data first to handle fallback logic
      let scoutingData = await scoutingDataFallbackService.getScoutingRatingsWithFallback(year);
      if (scoutingData.ratings.length === 0) {
          console.warn(`[FarmRankings] No scouting data for ${year}. Falling back to latest...`);
          scoutingData = await scoutingDataFallbackService.getScoutingRatingsWithFallback();
      }

      const [allPlayers, tfrResults, teams, leagueStats] = await Promise.all([
          playerService.getAllPlayers(),
          trueFutureRatingService.getProspectTrueFutureRatings(year),
          teamService.getAllTeams(),
          leagueStatsService.getLeagueStats(year)
      ]);

      const playerMap = new Map(allPlayers.map(p => [p.id, p]));
      const teamMap = new Map(teams.map(t => [t.id, t]));
      const scoutingMap = new Map(scoutingData.ratings.map(s => [s.playerId, s]));
      
      // Calculate Replacement Level FIP (League Avg + 1.00)
      const replacementFip = (leagueStats.avgFip || 4.20) + 1.00;
      const runsPerWin = 8.5; // Standard WBL constant

      const orgGroups = new Map<number, { rotation: RatedProspect[], bullpen: RatedProspect[] }>();
      const allProspects: RatedProspect[] = [];

      let processedCount = 0;

      tfrResults.forEach(tfr => {
          const player = playerMap.get(tfr.playerId);
          if (!player) return;

          // Determine Organization ID via Team Service lookup
          const team = teamMap.get(player.teamId);
          if (!team || team.parentTeamId === 0) return;

          processedCount++;
          const orgId = team.parentTeamId;
          const scouting = scoutingMap.get(tfr.playerId);
          
          const pitches = scouting?.pitches ?? {};
          const pitchCount = Object.values(pitches).filter(v => v >= 45).length; // Usable pitches
          const stamina = scouting?.stamina ?? 0;
          const injury = scouting?.injuryProneness;

          // Classification: SP if Stamina >= 30 AND 3+ Usable Pitches
          const isSp = stamina >= 30 && pitchCount >= 3;

          // Calculate realistic IP projection based on stamina and injury proneness
          // PEAK PROJECTION: Age 27 peak assumes healthy, full workload season
          let projectedIp: number;
          if (isSp) {
              // SP: Peak workload formula
              // Elite starters (70+ stamina) should project to 220-240+ IP
              // stamina 50 → 180 IP, 60 → 210 IP, 70 → 240 IP
              const baseIp = 30 + (stamina * 3.0); // More aggressive for peak projection

              // Injury adjustment (less aggressive for peak - assume healthy season)
              let injuryFactor = 1.0;
              if (injury === 'Normal') injuryFactor = 1.0;
              else if (injury === 'Fragile') injuryFactor = 0.90; // Still capable of workhorse season
              else if (injury === 'Durable') injuryFactor = 1.10;
              else if (injury === 'Wrecked') injuryFactor = 0.75; // Significantly limits ceiling
              else if (injury === 'Ironman') injuryFactor = 1.15;

              projectedIp = Math.round(Math.max(120, Math.min(260, baseIp * injuryFactor)));
          } else {
              // RP: 50-75 IP typical range
              const baseIp = 50 + (stamina * 0.5); // stamina 30 → 65, 50 → 75

              let injuryFactor = 1.0;
              if (injury === 'Normal') injuryFactor = 1.0;
              else if (injury === 'Fragile') injuryFactor = 0.90;
              else if (injury === 'Durable') injuryFactor = 1.10;
              else if (injury === 'Wrecked') injuryFactor = 0.75;
              else if (injury === 'Ironman') injuryFactor = 1.15;

              projectedIp = Math.round(Math.max(40, Math.min(80, baseIp * injuryFactor)));
          }

          const peakWar = fipWarService.calculateWar(tfr.projFip, projectedIp, replacementFip, runsPerWin);

          const prospect: RatedProspect = {
              playerId: tfr.playerId,
              name: tfr.playerName,
              trueFutureRating: tfr.trueFutureRating,
              percentile: tfr.percentile,
              stuffPercentile: tfr.stuffPercentile,
              controlPercentile: tfr.controlPercentile,
              hraPercentile: tfr.hraPercentile,
              age: tfr.age,
              level: this.getLevelLabel(player.level),
              teamId: player.teamId,
              orgId: orgId,
              peakFip: tfr.projFip,
              peakWar: peakWar,
              peakIp: projectedIp,
              projK9: tfr.projK9,
              projBb9: tfr.projBb9,
              projHr9: tfr.projHr9,
              potentialRatings: {
                  stuff: tfr.projK9,
                  control: tfr.projBb9,
                  hra: tfr.projHr9
              },
              scoutingRatings: {
                  stuff: scouting?.stuff ?? 0,
                  control: scouting?.control ?? 0,
                  hra: scouting?.hra ?? 0,
                  stamina,
                  pitches: pitchCount
              },
              stats: {
                  ip: projectedIp,
                  k9: tfr.adjustedK9,
                  bb9: tfr.adjustedBb9,
                  hr9: tfr.adjustedHr9
              }
          };

          allProspects.push(prospect);

          if (!orgGroups.has(orgId)) {
              orgGroups.set(orgId, { rotation: [], bullpen: [] });
          }
          const group = orgGroups.get(orgId)!;
          if (isSp) {
              group.rotation.push(prospect);
          } else {
              group.bullpen.push(prospect);
          }
      });

      // Generate Reports (Rotation/Bullpen top 5s)
      const reports: FarmSystemRankings[] = [];
      const systems: FarmSystemOverview[] = [];

      orgGroups.forEach((group, orgId) => {
          const team = teamMap.get(orgId);
          if (!team) return;

          // 1. Reports Data
          group.rotation.sort((a, b) => b.peakWar - a.peakWar);
          const topRotation = group.rotation.slice(0, 5);
          const rotationScore = topRotation.reduce((sum, p) => sum + Math.max(0, p.peakWar), 0);

          group.bullpen.sort((a, b) => b.peakWar - a.peakWar);
          const topBullpen = group.bullpen.slice(0, 5);
          const bullpenScore = topBullpen.reduce((sum, p) => sum + Math.max(0, p.peakWar), 0);

          reports.push({
              teamId: orgId,
              teamName: team.nickname,
              rotationScore,
              bullpenScore,
              rotation: topRotation,
              bullpen: topBullpen,
              allProspects: [...group.rotation, ...group.bullpen].sort((a, b) => b.peakWar - a.peakWar)
          });

          // 2. System Overview Data
          const allOrgProspects = [...group.rotation, ...group.bullpen];

          // Top Prospect - Highest Peak WAR, with TFR as tie-breaker
          const topProspect = allOrgProspects.reduce((prev, current) => {
              if (current.peakWar > prev.peakWar) return current;
              if (current.peakWar === prev.peakWar && current.trueFutureRating > prev.trueFutureRating) return current;
              return prev;
          });

          // Tiers - bucket prospects by True Future Rating
          const tierCounts = {
              elite: 0,       // TFR >= 4.5
              aboveAvg: 0,    // TFR 3.5-4.4
              average: 0,     // TFR 2.5-3.4
              fringe: 0       // TFR < 2.5 (Depth)
          };

          allOrgProspects.forEach(p => {
              if (p.trueFutureRating >= 4.5) tierCounts.elite++;
              else if (p.trueFutureRating >= 3.5) tierCounts.aboveAvg++;
              else if (p.trueFutureRating >= 2.5) tierCounts.average++;
              else tierCounts.fringe++;
          });

          // Calculate Farm Score based on tier counts (out of 100)
          // Elite: 10 pts each, Good: 5 pts each, Avg: 1 pt each
          // Depth (Fringe): scaled based on count
          const eliteScore = tierCounts.elite * 10;
          const goodScore = tierCounts.aboveAvg * 5;
          const avgScore = tierCounts.average * 1;

          let depthScore = 0;
          if (tierCounts.fringe < 10) depthScore = 0;
          else if (tierCounts.fringe < 15) depthScore = 2;
          else if (tierCounts.fringe < 25) depthScore = 4;
          else depthScore = 5;

          const totalWar = eliteScore + goodScore + avgScore + depthScore;

          systems.push({
              teamId: orgId,
              teamName: team.nickname,
              totalWar,
              prospectCount: allOrgProspects.length,
              topProspectName: topProspect.name,
              topProspectId: topProspect.playerId,
              tierCounts
          });
      });

      // Sort Top 100 Prospects by Percentile (Precision TFR) desc
      const sortedProspects = allProspects.sort((a, b) => {
          if (b.percentile !== undefined && a.percentile !== undefined && b.percentile !== a.percentile) {
              return b.percentile - a.percentile;
          }
          if (b.trueFutureRating !== a.trueFutureRating) {
              return b.trueFutureRating - a.trueFutureRating;
          }
          return b.peakWar - a.peakWar;
      });

      return {
          reports,
          systems: systems.sort((a, b) => b.totalWar - a.totalWar),
          prospects: sortedProspects
      };
  }

  /**
   * Get hitter prospect farm data for all organizations.
   * Similar to getFarmData() but for hitters.
   */
  async getHitterFarmData(year: number): Promise<HitterFarmData> {
      // Fetch hitter scouting data and league averages in parallel
      const [myScoutingRatings, osaScoutingRatings, leagueAvg] = await Promise.all([
          hitterScoutingDataService.getLatestScoutingRatings('my'),
          hitterScoutingDataService.getLatestScoutingRatings('osa'),
          leagueBattingAveragesService.getLeagueAverages(year)
      ]);

      // Merge scouting data (my takes priority)
      const scoutingMap = new Map<number, HitterScoutingRatings>();
      for (const rating of osaScoutingRatings) {
          if (rating.playerId > 0) scoutingMap.set(rating.playerId, rating);
      }
      for (const rating of myScoutingRatings) {
          if (rating.playerId > 0) scoutingMap.set(rating.playerId, rating);
      }

      if (scoutingMap.size === 0) {
          console.warn(`[HitterFarmRankings] No hitter scouting data found.`);
          return { reports: [], systems: [], prospects: [] };
      }

      if (!leagueAvg) {
          console.warn(`[HitterFarmRankings] No league averages found for ${year}, using defaults.`);
      }

      // Fetch player and team data
      const [allPlayers, teams] = await Promise.all([
          playerService.getAllPlayers(),
          teamService.getAllTeams()
      ]);

      const playerMap = new Map(allPlayers.map(p => [p.id, p]));
      const teamMap = new Map(teams.map(t => [t.id, t]));

      // Fetch minor league batting stats for TFR calculation
      const allMinorStats = await minorLeagueBattingStatsService.getAllPlayerStatsBatch(
          year - 2,
          year
      );

      // Build TFR inputs for all prospects with scouting data
      const tfrInputs: HitterTrueFutureRatingInput[] = [];
      const prospectPlayerMap = new Map<number, { player: any; scouting: HitterScoutingRatings }>();

      scoutingMap.forEach((scouting, playerId) => {
          const player = playerMap.get(playerId);
          if (!player) return;

          // Only include minor leaguers (not on MLB roster)
          const team = teamMap.get(player.teamId);
          if (!team || team.parentTeamId === 0) return; // Skip MLB players

          const minorStats = allMinorStats.get(playerId) ?? [];

          tfrInputs.push({
              playerId,
              playerName: scouting.playerName ?? `${player.firstName} ${player.lastName}`,
              age: player.age,
              scouting,
              minorLeagueStats: minorStats,
          });

          prospectPlayerMap.set(playerId, { player, scouting });
      });

      // Calculate True Future Ratings
      const tfrResults = await hitterTrueFutureRatingService.calculateTrueFutureRatings(tfrInputs);

      // Build prospect list grouped by organization
      const orgGroups = new Map<number, RatedHitterProspect[]>();
      const allProspects: RatedHitterProspect[] = [];

      tfrResults.forEach(tfr => {
          const prospectInfo = prospectPlayerMap.get(tfr.playerId);
          if (!prospectInfo) return;

          const { player, scouting } = prospectInfo;
          const team = teamMap.get(player.teamId);
          if (!team) return;

          const orgId = team.parentTeamId;

          // Calculate derived stats
          const projSlg = tfr.projAvg + tfr.projIso;
          const projObp = tfr.projAvg + (tfr.projBbPct / 100); // Simplified OBP
          const projOps = projObp + projSlg;
          const projPa = leagueBattingAveragesService.getProjectedPa(scouting.injuryProneness);

          // Calculate wRC+ and WAR using league averages
          let wrcPlus = 100; // Default to league average
          let projWar = 0;
          if (leagueAvg) {
              wrcPlus = leagueBattingAveragesService.calculateWrcPlus(tfr.projWoba, leagueAvg);
              projWar = leagueBattingAveragesService.calculateBattingWar(tfr.projWoba, projPa, leagueAvg);
          }

          const prospect: RatedHitterProspect = {
              playerId: tfr.playerId,
              name: tfr.playerName,
              trueFutureRating: tfr.trueFutureRating,
              percentile: tfr.percentile,
              age: tfr.age,
              level: this.getLevelLabel(player.level),
              teamId: player.teamId,
              orgId,
              projWoba: tfr.projWoba,
              projBbPct: tfr.projBbPct,
              projKPct: tfr.projKPct,
              projIso: tfr.projIso,
              projAvg: tfr.projAvg,
              projObp: Math.round(projObp * 1000) / 1000,
              projSlg: Math.round(projSlg * 1000) / 1000,
              projOps: Math.round(projOps * 1000) / 1000,
              projPa,
              wrcPlus,
              projWar,
              totalMinorPa: tfr.totalMinorPa,
              injuryProneness: scouting.injuryProneness,
              scoutingRatings: {
                  power: scouting.power,
                  eye: scouting.eye,
                  avoidK: scouting.avoidK,
                  babip: scouting.babip ?? 50,
                  gap: scouting.gap ?? 50,
                  speed: scouting.speed ?? 50,
                  ovr: scouting.ovr,
                  pot: scouting.pot,
              },
              position: player.position,
          };

          allProspects.push(prospect);

          if (!orgGroups.has(orgId)) {
              orgGroups.set(orgId, []);
          }
          orgGroups.get(orgId)!.push(prospect);
      });

      // Generate reports and system overviews
      const reports: HitterFarmSystemRankings[] = [];
      const systems: HitterFarmSystemOverview[] = [];

      orgGroups.forEach((prospects, orgId) => {
          const team = teamMap.get(orgId);
          if (!team) return;

          // Sort by percentile/TFR descending
          prospects.sort((a, b) => {
              if (b.percentile !== a.percentile) return b.percentile - a.percentile;
              return b.trueFutureRating - a.trueFutureRating;
          });

          // Calculate score (similar to pitcher farm score)
          const tierCounts = {
              elite: 0,
              aboveAvg: 0,
              average: 0,
              fringe: 0
          };

          prospects.forEach(p => {
              if (p.trueFutureRating >= 4.5) tierCounts.elite++;
              else if (p.trueFutureRating >= 3.5) tierCounts.aboveAvg++;
              else if (p.trueFutureRating >= 2.5) tierCounts.average++;
              else tierCounts.fringe++;
          });

          const totalScore = (tierCounts.elite * 10) + (tierCounts.aboveAvg * 5) + (tierCounts.average * 1);

          reports.push({
              teamId: orgId,
              teamName: team.nickname,
              totalScore,
              allProspects: prospects,
          });

          const topProspect = prospects[0];
          systems.push({
              teamId: orgId,
              teamName: team.nickname,
              totalScore,
              prospectCount: prospects.length,
              topProspectName: topProspect?.name ?? '',
              topProspectId: topProspect?.playerId ?? 0,
              tierCounts,
          });
      });

      // Sort prospects by percentile
      const sortedProspects = allProspects.sort((a, b) => {
          if (b.percentile !== a.percentile) return b.percentile - a.percentile;
          return b.trueFutureRating - a.trueFutureRating;
      });

      return {
          reports: reports.sort((a, b) => b.totalScore - a.totalScore),
          systems: systems.sort((a, b) => b.totalScore - a.totalScore),
          prospects: sortedProspects,
      };
  }

  private getLevelLabel(level: number): string {
      // WBL-specific level mapping (verified with actual 2020 data)
      // 1: MLB, 2: AAA (league_id 201), 3: AA (league_id 202),
      // 4: A (league_id 203), 6: R (league_id 204)
      // WBL does NOT have Short-A, A+, or A- levels
      switch(level) {
          case 1: return 'MLB';
          case 2: return 'AAA';
          case 3: return 'AA';
          case 4: return 'A';
          case 5: return 'Short-A'; // Not used in WBL
          case 6: return 'R'; // Rookie
          case 7: return 'R'; // Also Rookie (fallback)
          case 8: return 'DSL'; // International Complex
          default: return `Lvl ${level}`;
      }
  }

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

      // 1. Organize Groups & Calculate Role-Specific Baselines
      // We need to compare Starters to Starters and Relievers to Relievers.
      // Comparing a Starter to the overall League Average (which includes elite relievers)
      // unfairly penalizes rotations.
      
      let totalRotationFipIp = 0;
      let totalRotationIp = 0;
      let totalBullpenFipIp = 0;
      let totalBullpenIp = 0;

      teamGroups.forEach((group, teamId) => {
          const team = teamMap.get(teamId);
          if (team && team.parentTeamId !== 0) return;

          // Sort Rotation by Projected TR desc
          group.rotation.sort((a, b) => b.trueRating - a.trueRating);

          // Handle Overflow: Move starters beyond top 5 to bullpen
          if (group.rotation.length > 5) {
              const overflow = group.rotation.slice(5);
              group.bullpen.push(...overflow);
              group.rotation = group.rotation.slice(0, 5);
          }

          // Sort Bullpen by Projected TR desc (now includes overflow starters)
          group.bullpen.sort((a, b) => b.trueRating - a.trueRating);

          // Aggregate stats for Baseline Calculation (using top 5 only)
          const topRotation = group.rotation;
          const topBullpen = group.bullpen.slice(0, 5);

          topRotation.forEach(p => {
              if (p.stats.ip > 0) {
                  totalRotationFipIp += p.stats.fip * p.stats.ip;
                  totalRotationIp += p.stats.ip;
              }
          });

          topBullpen.forEach(p => {
              if (p.stats.ip > 0) {
                  totalBullpenFipIp += p.stats.fip * p.stats.ip;
                  totalBullpenIp += p.stats.ip;
              }
          });
      });

      const avgRotationFip = totalRotationIp > 0 ? totalRotationFipIp / totalRotationIp : leagueStats.avgFip;
      const avgBullpenFip = totalBullpenIp > 0 ? totalBullpenFipIp / totalBullpenIp : leagueStats.avgFip;

      // 2. Calculate Runs Allowed & Zero-Sum Baseline
      const teamRunTotals: Array<{
          teamId: number;
          teamName: string;
          rotationRuns: number;
          bullpenRuns: number;
          rotationWar: number;
          bullpenWar: number;
          group: { rotation: RatedPlayer[]; bullpen: RatedPlayer[] };
      }> = [];

      let grandTotalRotationRuns = 0;
      let grandTotalBullpenRuns = 0;
      let count = 0;

      teamGroups.forEach((group, teamId) => {
          const team = teamMap.get(teamId);
          if (team && team.parentTeamId !== 0) return;

          const topRotation = group.rotation;
          const topBullpen = group.bullpen.slice(0, 5);
          
          // Use role-specific averages for replacement level
          // Pass avgRotationFip as the "League Average" to the helper.
          // The helper uses this to calculate replacement level (Input + 1.00)
          const rotationRuns = this.calculateRunSummary(topRotation, avgRotationFip, 950);
          const bullpenRuns = this.calculateRunSummary(topBullpen, avgBullpenFip, 500);

          // Calculate Team WAR
          const rotationWar = topRotation.reduce((sum, p) => sum + (p.stats.war ?? 0), 0);
          const bullpenWar = topBullpen.reduce((sum, p) => sum + (p.stats.war ?? 0), 0);

          grandTotalRotationRuns += rotationRuns.runsAllowed;
          grandTotalBullpenRuns += bullpenRuns.runsAllowed;
          count++;

          teamRunTotals.push({
              teamId,
              teamName: team ? team.nickname : `Team ${teamId}`,
              rotationRuns: rotationRuns.runsAllowed,
              bullpenRuns: bullpenRuns.runsAllowed,
              rotationWar,
              bullpenWar,
              group
          });
      });

      // Calculate the Global Average Runs (The "Zero Line" for Runs Saved)
      // This represents the average performance of a constructed team (including replacement filler)
      const globalAvgRotationRuns = count > 0 ? grandTotalRotationRuns / count : 0;
      const globalAvgBullpenRuns = count > 0 ? grandTotalBullpenRuns / count : 0;

      // 3. Finalize Results
      const results: TeamRatingResult[] = teamRunTotals.map(r => {
          return {
              teamId: r.teamId,
              teamName: r.teamName,
              seasonYear: baseYear + 1,
              rotationRunsAllowed: r.rotationRuns,
              bullpenRunsAllowed: r.bullpenRuns,
              rotationLeagueAvgRuns: globalAvgRotationRuns,
              bullpenLeagueAvgRuns: globalAvgBullpenRuns,
              rotationRunsSaved: globalAvgRotationRuns - r.rotationRuns,
              bullpenRunsSaved: globalAvgBullpenRuns - r.bullpenRuns,
              rotationWar: r.rotationWar,
              bullpenWar: r.bullpenWar,
              rotation: r.group.rotation,
              bullpen: r.group.bullpen
          };
      });

      return results;
  }

  async getTeamRatings(year: number): Promise<TeamRatingResult[]> {
    const currentYear = await dateService.getCurrentYear();
    const isHistoricalYear = year < currentYear;

    const pitchingStatsPromise = isHistoricalYear
      ? trueRatingsService.getTruePitchingStatsByTeam(year)
      : trueRatingsService.getTruePitchingStats(year);
    const combinedPitchingStatsPromise = isHistoricalYear
      ? trueRatingsService.getTruePitchingStats(year)
      : pitchingStatsPromise;

    // 1. Fetch Data
    const [pitchingStats, leagueStats, scoutingFallback, multiYearStats, allTeams, combinedPitchingStats] = await Promise.all([
      pitchingStatsPromise,
      leagueStatsService.getLeagueStats(year),
      scoutingDataFallbackService.getScoutingRatingsWithFallback(year),
      trueRatingsService.getMultiYearPitchingStats(year, 3),
      teamService.getAllTeams(),
      combinedPitchingStatsPromise
    ]);
    const scoutingRatings = scoutingFallback.ratings;

    // Note: getLeagueAverages removed from promise all since it wasn't being used directly in inputs anymore?
    // Wait, TrueRatingsCalculationService needs leagueAverages.
    // Let's re-add it to be safe and match original logic.
    const leagueAverages = await trueRatingsService.getLeagueAverages(year);

    // 2. Maps for lookup
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
    const inputs = combinedPitchingStats.map(stat => {
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
    const fipLikeValues = trResults.map(tr => tr.fipLike).sort((a, b) => a - b);

    const percentileForFipLike = (fipLike: number): number => {
        if (fipLikeValues.length === 0) return 50;
        let lower = 0;
        while (lower < fipLikeValues.length && fipLikeValues[lower] < fipLike) lower++;
        let upper = lower;
        while (upper < fipLikeValues.length && fipLikeValues[upper] === fipLike) upper++;
        const avgRank = (lower + upper + 2) / 2;
        const n = fipLikeValues.length + 1;
        return Math.round(((n - avgRank + 0.5) / n) * 1000) / 10;
    };

    // 5. Process Players & Classify
    const teamGroups = new Map<number, { rotation: RatedPlayer[], bullpen: RatedPlayer[] }>();

    pitchingStats.forEach(stat => {
        const rawTeamId = stat.team_id;
        if (rawTeamId === 0) return;
        const teamEntry = teamMap.get(rawTeamId);
        const teamId = teamEntry?.parentTeamId ? teamEntry.parentTeamId : rawTeamId;
        if (teamId === 0) return;

        const trData = trMap.get(stat.player_id);

        // Stats parsing
        const ip = trueRatingsService.parseIp(stat.ip);
        const k9 = ip > 0 ? (stat.k / ip) * 9 : 0;
        const bb9 = ip > 0 ? (stat.bb / ip) * 9 : 0;
        const hr9 = ip > 0 ? (stat.hra / ip) * 9 : 0;
        const era = ip > 0 ? (stat.er / ip) * 9 : 0;
        const fip = fipWarService.calculateFip({ ip, k9, bb9, hr9 }, leagueStats.fipConstant);

        const fallback =
            !trData && isHistoricalYear
                ? (() => {
                      const fipLike = trueRatingsCalculationService.calculateFipLike(k9, bb9, hr9);
                      const percentile = percentileForFipLike(fipLike);
                      return {
                          trueRating: trueRatingsCalculationService.percentileToRating(percentile),
                          estimatedStuff: RatingEstimatorService.estimateStuff(k9, ip).rating,
                          estimatedControl: RatingEstimatorService.estimateControl(bb9, ip).rating,
                          estimatedHra: RatingEstimatorService.estimateHRA(hr9, ip).rating
                      };
                  })()
                : null;

        if (!trData && !fallback) return;

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

        if (isHistoricalYear) {
            if (hasStarterRole) {
                isSp = true;
                classificationReason = `SP (${stat.gs} GS this year)`;
            } else {
                classificationReason = `RP (${stat.gs} GS this year)`;
            }
        } else {
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
            trueRating: trData?.trueRating ?? fallback?.trueRating ?? 0.5,
            trueStuff: trData?.estimatedStuff ?? fallback?.estimatedStuff ?? 20,
            trueControl: trData?.estimatedControl ?? fallback?.estimatedControl ?? 20,
            trueHra: trData?.estimatedHra ?? fallback?.estimatedHra ?? 20,
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

    // 6. Aggregate per Team (Two-Pass Approach)
    // Pass 1: Organize and Calculate League Baselines
    
    let totalRotationFipIp = 0;
    let totalRotationIp = 0;
    let totalBullpenFipIp = 0;
    let totalBullpenIp = 0;

    teamGroups.forEach((group, teamId) => {
        const team = teamMap.get(teamId);
        if (team && team.parentTeamId !== 0) return;

        // Sort Rotation (historical years prioritize actual usage)
        group.rotation.sort(isHistoricalYear
            ? (a, b) => (b.stats.gs - a.stats.gs) || (b.stats.ip - a.stats.ip) || (b.trueRating - a.trueRating)
            : (a, b) => b.trueRating - a.trueRating
        );

        // Handle Overflow
        if (group.rotation.length > 5) {
            const overflow = group.rotation.slice(5);
            group.bullpen.push(...overflow);
            group.rotation = group.rotation.slice(0, 5);
        }

        // Sort Bullpen
        group.bullpen.sort((a, b) => b.trueRating - a.trueRating);
        
        // Aggregate for Baseline Calculation
        const topRotation = group.rotation;
        const topBullpen = group.bullpen.slice(0, 5);

        topRotation.forEach(p => {
             if (p.stats.ip > 0) {
                 totalRotationFipIp += p.stats.fip * p.stats.ip;
                 totalRotationIp += p.stats.ip;
             }
        });

        topBullpen.forEach(p => {
             if (p.stats.ip > 0) {
                 totalBullpenFipIp += p.stats.fip * p.stats.ip;
                 totalBullpenIp += p.stats.ip;
             }
        });
    });

    const avgRotationFip = totalRotationIp > 0 ? totalRotationFipIp / totalRotationIp : leagueStats.avgFip;
    const avgBullpenFip = totalBullpenIp > 0 ? totalBullpenFipIp / totalBullpenIp : leagueStats.avgFip;

    // Pass 2: Calculate Runs Allowed & Zero-Sum Baseline
    const teamRunTotals: Array<{
        teamId: number;
        teamName: string;
        rotationRuns: number;
        bullpenRuns: number;
        rotationWar: number;
        bullpenWar: number;
        group: { rotation: RatedPlayer[]; bullpen: RatedPlayer[] };
    }> = [];

    let grandTotalRotationRuns = 0;
    let grandTotalBullpenRuns = 0;
    let count = 0;

    teamGroups.forEach((group, teamId) => {
        const team = teamMap.get(teamId);
        if (team && team.parentTeamId !== 0) return;

        const topRotation = group.rotation;
        const topBullpen = group.bullpen.slice(0, 5);

        // Use role-specific averages for replacement level
        const rotationRuns = this.calculateRunSummary(topRotation, avgRotationFip, 950);
        const bullpenRuns = this.calculateRunSummary(topBullpen, avgBullpenFip, 500);

        // Calculate Team WAR
        const rotationWar = topRotation.reduce((sum, p) => sum + (p.stats.war ?? 0), 0);
        const bullpenWar = topBullpen.reduce((sum, p) => sum + (p.stats.war ?? 0), 0);

        grandTotalRotationRuns += rotationRuns.runsAllowed;
        grandTotalBullpenRuns += bullpenRuns.runsAllowed;
        count++;

        teamRunTotals.push({
            teamId,
            teamName: team ? team.nickname : `Team ${teamId}`,
            rotationRuns: rotationRuns.runsAllowed,
            bullpenRuns: bullpenRuns.runsAllowed,
            rotationWar,
            bullpenWar,
            group
        });
    });

    // Calculate the Global Average Runs (The "Zero Line" for Runs Saved)
    const globalAvgRotationRuns = count > 0 ? grandTotalRotationRuns / count : 0;
    const globalAvgBullpenRuns = count > 0 ? grandTotalBullpenRuns / count : 0;

    const results: TeamRatingResult[] = teamRunTotals.map(r => {
        return {
            teamId: r.teamId,
            teamName: r.teamName,
            seasonYear: year,
            rotationRunsAllowed: r.rotationRuns,
            bullpenRunsAllowed: r.bullpenRuns,
            rotationLeagueAvgRuns: globalAvgRotationRuns,
            bullpenLeagueAvgRuns: globalAvgBullpenRuns,
            rotationRunsSaved: globalAvgRotationRuns - r.rotationRuns,
            bullpenRunsSaved: globalAvgBullpenRuns - r.bullpenRuns,
            rotationWar: r.rotationWar,
            bullpenWar: r.bullpenWar,
            rotation: r.group.rotation,
            bullpen: r.group.bullpen
        };
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

  private calculateRunSummary(players: RatedPlayer[], leagueAvgFip: number, targetIp: number): { runsAllowed: number; leagueAvgRuns: number; runsSaved: number } {
    let totalIp = players.reduce((sum, player) => sum + (Number.isFinite(player.stats.ip) ? player.stats.ip : 0), 0);
    
    // Calculate raw runs allowed from the players we have
    let runsAllowed = players.reduce((sum, player) => {
      if (!Number.isFinite(player.stats.fip) || !Number.isFinite(player.stats.ip)) return sum;
      return sum + this.calculateRunsAllowed(player.stats.fip, player.stats.ip);
    }, 0);

    // If total IP is less than target, fill with Replacement Level (League Avg FIP + 1.00)
    // This penalizes teams with shallow depth / low projections
    if (totalIp < targetIp) {
        const missingIp = targetIp - totalIp;
        const replacementFip = leagueAvgFip + 1.00;
        const replacementRuns = this.calculateRunsAllowed(replacementFip, missingIp);
        
        runsAllowed += replacementRuns;
        totalIp = targetIp; // Normalize total IP to target for league average calc
    } else if (totalIp > targetIp) {
        // Normalize to targetIp to prevent volume punishment/reward distortion in rankings
        // We only want to measure the *quality* of the rotation over a standard season duration
        // otherwise, a team pitching 1000 innings at a 4.00 FIP looks "worse" (more runs allowed)
        // than a team pitching 950 innings at a 4.00 FIP, despite being identical in quality.
        const ratio = targetIp / totalIp;
        runsAllowed = runsAllowed * ratio;
        totalIp = targetIp;
    }

    // League Average Benchmark uses the TARGET IP (normalized)
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
