import { projectionService } from './ProjectionService';
import { trueRatingsService } from './TrueRatingsService';
import { leagueStatsService } from './LeagueStatsService';
import { fipWarService } from './FipWarService';
import { teamService } from './TeamService';

export interface AccuracyMetrics {
  mae: number;
  rmse: number;
  count: number;
  bias: number;
}

export interface StatMetrics {
  k9: AccuracyMetrics;
  bb9: AccuracyMetrics;
  hr9: AccuracyMetrics;
  fip: AccuracyMetrics;
}

export interface StatDiffs {
  k9: number;
  bb9: number;
  hr9: number;
  fip: number;
}

export interface YearAnalysisResult {
  year: number;
  metrics: StatMetrics; // Overall metrics for this year
  metricsByTeam: Map<string, StatMetrics>;
  metricsByAge: Map<string, StatMetrics>;
  details: {
      playerId: number;
      name: string;
      teamName: string;
      age: number;
      
      projected: { k9: number; bb9: number; hr9: number; fip: number; };
      actual: { k9: number; bb9: number; hr9: number; fip: number; };
      diff: StatDiffs; // Actual - Projected
      
      ip: number;
  }[];
}

export interface AggregateAnalysisReport {
  years: YearAnalysisResult[];
  overallMetrics: StatMetrics;
  metricsByTeam: Map<string, StatMetrics>;
  metricsByAge: Map<string, StatMetrics>;
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
    // 1. Get Projections
    const statsBaseYear = year - 1;
    const context = await projectionService.getProjectionsWithContext(statsBaseYear);
    
    // 2. Get Actuals
    const actuals = await trueRatingsService.getTruePitchingStats(year);
    if (!actuals || actuals.length === 0) return null;

    const leagueStats = await leagueStatsService.getLeagueStats(year);
    const actualsMap = new Map(actuals.map(a => [a.player_id, a]));

    // 3. Match and Calculate Details
    const details: YearAnalysisResult['details'] = [];
    
    for (const proj of context.projections) {
        const act = actualsMap.get(proj.playerId);
        if (!act) continue;

        const actualIp = trueRatingsService.parseIp(act.ip);
        if (actualIp < 10) continue; // Ignore small sample sizes

        // Calculate Actual Rate Stats
        const actualK9 = (act.k / actualIp) * 9;
        const actualBB9 = (act.bb / actualIp) * 9;
        const actualHR9 = (act.hra / actualIp) * 9;
        const actualFip = fipWarService.calculateFip({ k9: actualK9, bb9: actualBB9, hr9: actualHR9, ip: actualIp }, leagueStats.fipConstant);
        
        // Get Projected Stats
        const projK9 = proj.projectedStats.k9;
        const projBB9 = proj.projectedStats.bb9;
        const projHR9 = proj.projectedStats.hr9;
        const projFip = proj.projectedStats.fip;

        // Resolve Team Name
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
            age: proj.age,
            projected: { k9: projK9, bb9: projBB9, hr9: projHR9, fip: projFip },
            actual: { k9: actualK9, bb9: actualBB9, hr9: actualHR9, fip: actualFip },
            diff: {
                k9: actualK9 - projK9,
                bb9: actualBB9 - projBB9,
                hr9: actualHR9 - projHR9,
                fip: actualFip - projFip
            },
            ip: actualIp
        });
    }

    if (details.length === 0) return null;

    // 4. Group and Calculate Metrics
    const metrics = this.calculateStatMetrics(details.map(d => d.diff));
    
    // Group by Team
    const teamGroups = new Map<string, StatDiffs[]>();
    details.forEach(d => {
        const list = teamGroups.get(d.teamName) ?? [];
        list.push(d.diff);
        teamGroups.set(d.teamName, list);
    });
    const metricsByTeam = new Map<string, StatMetrics>();
    teamGroups.forEach((diffs, key) => metricsByTeam.set(key, this.calculateStatMetrics(diffs)));

    // Group by Age
    const ageGroups = new Map<string, StatDiffs[]>();
    details.forEach(d => {
        const bucket = this.getAgeBucket(d.age);
        const list = ageGroups.get(bucket) ?? [];
        list.push(d.diff);
        ageGroups.set(bucket, list);
    });
    const metricsByAge = new Map<string, StatMetrics>();
    ageGroups.forEach((diffs, key) => metricsByAge.set(key, this.calculateStatMetrics(diffs)));

    return {
        year,
        metrics,
        metricsByTeam,
        metricsByAge,
        details
    };
  }

  private aggregateResults(years: YearAnalysisResult[]): AggregateAnalysisReport {
      const allDetails = years.flatMap(y => y.details);
      const overallMetrics = this.calculateStatMetrics(allDetails.map(d => d.diff));

      // Aggregate by Team
      const teamGroups = new Map<string, StatDiffs[]>();
      allDetails.forEach(d => {
          const list = teamGroups.get(d.teamName) ?? [];
          list.push(d.diff);
          teamGroups.set(d.teamName, list);
      });
      const metricsByTeam = new Map<string, StatMetrics>();
      teamGroups.forEach((diffs, key) => metricsByTeam.set(key, this.calculateStatMetrics(diffs)));

      // Aggregate by Age
      const ageGroups = new Map<string, StatDiffs[]>();
      allDetails.forEach(d => {
          const bucket = this.getAgeBucket(d.age);
          const list = ageGroups.get(bucket) ?? [];
          list.push(d.diff);
          ageGroups.set(bucket, list);
      });
      const metricsByAge = new Map<string, StatMetrics>();
      ageGroups.forEach((diffs, key) => metricsByAge.set(key, this.calculateStatMetrics(diffs)));

      return {
          years,
          overallMetrics,
          metricsByTeam,
          metricsByAge
      };
  }

  private calculateStatMetrics(diffs: StatDiffs[]): StatMetrics {
      return {
          k9: this.calculateMetrics(diffs.map(d => d.k9)),
          bb9: this.calculateMetrics(diffs.map(d => d.bb9)),
          hr9: this.calculateMetrics(diffs.map(d => d.hr9)),
          fip: this.calculateMetrics(diffs.map(d => d.fip))
      };
  }

  private calculateMetrics(values: number[]): AccuracyMetrics {
      const count = values.length;
      if (count === 0) return { mae: 0, rmse: 0, count: 0, bias: 0 };

      const sumAbs = values.reduce((sum, v) => sum + Math.abs(v), 0);
      const sumSq = values.reduce((sum, v) => sum + (v * v), 0);
      const sumVal = values.reduce((sum, v) => sum + v, 0);

      return {
          mae: sumAbs / count,
          rmse: Math.sqrt(sumSq / count),
          count,
          bias: sumVal / count
      };
  }

  private getAgeBucket(age: number): string {
      if (age <= 23) return '< 24';
      if (age <= 26) return '24-26'; // Peak growth
      if (age <= 29) return '27-29'; // Peak plateau
      if (age <= 33) return '30-33'; // Decline
      return '34+';
  }
}

export const projectionAnalysisService = new ProjectionAnalysisService();