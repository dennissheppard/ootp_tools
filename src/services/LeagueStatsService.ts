import { trueRatingsService } from './TrueRatingsService';

export interface LeagueStats {
    era: number;
    fipConstant: number;
    avgFip: number;
    ip: number;
    k: number;
    bb: number;
    hr: number;
    er: number;
}

class LeagueStatsService {
    private leagueStatsCache: Map<number, LeagueStats> = new Map();

    /**
     * Get comprehensive league stats for a year, including properly calibrated FIP constant.
     *
     * FIP constant is calculated as: lgERA - (((13×lgHR) + (3×lgBB) - (2×lgK)) / lgIP)
     * This ensures league average FIP = league average ERA.
     */
    public async getLeagueStats(year: number): Promise<LeagueStats> {
        const CACHE_KEY = `wbl-league-stats-${year}`;

        // Check in-memory cache first
        if (this.leagueStatsCache.has(year)) {
            return this.leagueStatsCache.get(year)!;
        }

        // For years before 2020, check localStorage for permanent cache
        if (year < 2020) {
            const cachedData = localStorage.getItem(CACHE_KEY);
            if (cachedData) {
                const stats = JSON.parse(cachedData);
                this.leagueStatsCache.set(year, stats); // Also put in in-memory cache
                return stats;
            }
        }

        const pitchingStats = await trueRatingsService.getTruePitchingStats(year);

        let totalEr = 0;
        let totalOuts = 0;
        let totalK = 0;
        let totalBb = 0;
        let totalHr = 0;

        for (const player of pitchingStats) {
            totalEr += player.er;
            totalOuts += this.parseIpToOuts(player.ip);
            totalK += player.k;
            totalBb += player.bb;
            totalHr += player.hra;  // 'hra' is home runs allowed in the API
        }

        const totalIp = totalOuts / 3;
        const leagueEra = (totalEr * 9) / totalIp;

        // FIP constant: Makes league average FIP = league average ERA
        // fipConstant = lgERA - (((13×lgHR) + (3×3bb) - (2×lgK)) / lgIP)
        const rawFipComponent = ((13 * totalHr) + (3 * totalBb) - (2 * totalK)) / totalIp;
        const fipConstant = leagueEra - rawFipComponent;

        // Calculate league average FIP (should equal ERA with correct constant)
        const avgFip = rawFipComponent + fipConstant;

        const stats: LeagueStats = {
            era: leagueEra,
            fipConstant,
            avgFip,
            ip: totalIp,
            k: totalK,
            bb: totalBb,
            hr: totalHr,
            er: totalEr,
        };

        this.leagueStatsCache.set(year, stats);

        // For years before 2020, store permanently in localStorage
        if (year < 2020) {
            localStorage.setItem(CACHE_KEY, JSON.stringify(stats));
        }

        return stats;
    }

    /**
     * Convenience method for backwards compatibility
     */
    public async getLeagueEra(year: number): Promise<number> {
        const stats = await this.getLeagueStats(year);
        return stats.era;
    }

    private parseIpToOuts(ip: string | number): number {
        const ipAsString = String(ip);
        const parts = ipAsString.split('.');
        const fullInnings = parseInt(parts[0], 10);
        const partialInnings = parts.length > 1 ? parseInt(parts[1], 10) : 0;
        return (fullInnings * 3) + partialInnings;
    }
}

export const leagueStatsService = new LeagueStatsService();
