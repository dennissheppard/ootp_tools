import { projectionService } from './ProjectionService';
import { trueRatingsService } from './TrueRatingsService';
import { leagueStatsService } from './LeagueStatsService';
import { fipWarService } from './FipWarService';
import { teamService } from './TeamService';

export interface AccuracyMetrics {
  mae: number; // Mean Absolute Error
  rmse: number; // Root Mean Square Error
  count: number;
  bias: number; // Mean Error (Actual - Projected). Positive means we under-projected (Actual > Projected)
}

export interface YearAnalysisResult {
  year: number;
  metrics: AccuracyMetrics;
  metricsByTeam: Map<string, AccuracyMetrics>; // Keyed by Team Name
  details: {
      playerId: number;
      name: string;
      teamName: string;
      projectedFip: number;
      actualFip: number;
      diff: number; // Actual - Projected
      ip: number;
  }[];
}

export interface AggregateAnalysisReport {
  years: YearAnalysisResult[];
  overallMetrics: AccuracyMetrics;
  metricsByTeam: Map<string, AccuracyMetrics>;
}

class ProjectionAnalysisService {
  
  async runAnalysis(startYear: number, endYear: number, progressCallback?: (year: number) => void): Promise<AggregateAnalysisReport> {
    const results: YearAnalysisResult[] = [];
    const allTeams = await teamService.getAllTeams();
    const teamLookup = new Map(allTeams.map(t => [t.id, t]));

    for (let year = startYear; year <= endYear; year++) {
      if (progressCallback) progressCallback(year);
      
      try {
        const result = await this.analyzeYear(year, teamLookup);
        if (result) {
            results.push(result);
        }
      } catch (e) {
          console.warn(`Analysis failed for ${year}`, e);
      }
    }

    return this.aggregateResults(results);
  }

  private async analyzeYear(year: number, teamLookup: Map<number, any>): Promise<YearAnalysisResult | null> {
    // 1. Get Projections (using previous year's data)
    // We want the projections that would have been generated at the START of 'year'.
    // So we tell the service to look at year-1 stats.
    // The service `getProjectionsWithContext(year-1)` does exactly this (projects FOR 'year' using 'year-1' stats).
    // Wait, let's verify usage in ProjectionsView.
    // In ProjectionsView: `const context = await projectionService.getProjectionsWithContext(statsBaseYear...);`
    // where `statsBaseYear` is `targetYear - 1`.
    // So if we want to analyze 2020 accuracy, we need projections based on 2019 stats.
    const statsBaseYear = year - 1;
    const context = await projectionService.getProjectionsWithContext(statsBaseYear);
    
    // 2. Get Actuals for 'year'
    const actuals = await trueRatingsService.getTruePitchingStats(year);
    if (!actuals || actuals.length === 0) return null;

    const leagueStats = await leagueStatsService.getLeagueStats(year);
    const actualsMap = new Map(actuals.map(a => [a.player_id, a]));

    // 3. Match and Calculate
    const details: YearAnalysisResult['details'] = [];
    
    for (const proj of context.projections) {
        const act = actualsMap.get(proj.playerId);
        if (!act) continue;

        const actualIp = trueRatingsService.parseIp(act.ip);
        if (actualIp < 10) continue; // Ignore small sample sizes

        const k9 = (act.k / actualIp) * 9;
        const bb9 = (act.bb / actualIp) * 9;
        const hr9 = (act.hra / actualIp) * 9;
        const actualFip = fipWarService.calculateFip({ k9, bb9, hr9, ip: actualIp }, leagueStats.fipConstant);
        
        // Use 2 decimals for consistency
        const projFip = proj.projectedStats.fip;
        const diff = actualFip - projFip;

        // Resolve Team Name (MLB Parent)
        let teamName = proj.teamName;
        const team = teamLookup.get(proj.teamId);
        if (team && team.parentTeamId !== 0) {
            const parent = teamLookup.get(team.parentTeamId);
            if (parent) teamName = parent.nickname;
        } else if (team) {
            teamName = team.nickname;
        }

        details.push({
            playerId: proj.playerId,
            name: proj.name,
            teamName,
            projectedFip: projFip,
            actualFip,
            diff,
            ip: actualIp
        });
    }

    if (details.length === 0) return null;

    // 4. Calculate Year Metrics
    const metrics = this.calculateMetrics(details.map(d => d.diff));
    
    // 5. Calculate Team Metrics for this Year
    const teamGroups = new Map<string, number[]>();
    details.forEach(d => {
        const diffs = teamGroups.get(d.teamName) ?? [];
        diffs.push(d.diff);
        teamGroups.set(d.teamName, diffs);
    });

    const metricsByTeam = new Map<string, AccuracyMetrics>();
    teamGroups.forEach((diffs, teamName) => {
        metricsByTeam.set(teamName, this.calculateMetrics(diffs));
    });

    return {
        year,
        metrics,
        metricsByTeam,
        details
    };
  }

  private aggregateResults(years: YearAnalysisResult[]): AggregateAnalysisReport {
      // Overall Metrics
      const allDiffs = years.flatMap(y => y.details.map(d => d.diff));
      const overallMetrics = this.calculateMetrics(allDiffs);

      // Aggregate by Team across all years
      const teamDiffs = new Map<string, number[]>();
      years.forEach(y => {
          y.details.forEach(d => {
              const diffs = teamDiffs.get(d.teamName) ?? [];
              diffs.push(d.diff);
              teamDiffs.set(d.teamName, diffs);
          });
      });

      const metricsByTeam = new Map<string, AccuracyMetrics>();
      teamDiffs.forEach((diffs, teamName) => {
          metricsByTeam.set(teamName, this.calculateMetrics(diffs));
      });

      return {
          years,
          overallMetrics,
          metricsByTeam
      };
  }

  private calculateMetrics(diffs: number[]): AccuracyMetrics {
      const count = diffs.length;
      if (count === 0) return { mae: 0, rmse: 0, count: 0, bias: 0 };

      const sumAbs = diffs.reduce((sum, d) => sum + Math.abs(d), 0);
      const sumSq = diffs.reduce((sum, d) => sum + (d * d), 0);
      const sumDiff = diffs.reduce((sum, d) => sum + d, 0);

      return {
          mae: sumAbs / count,
          rmse: Math.sqrt(sumSq / count),
          count,
          bias: sumDiff / count
      };
  }
}

export const projectionAnalysisService = new ProjectionAnalysisService();
