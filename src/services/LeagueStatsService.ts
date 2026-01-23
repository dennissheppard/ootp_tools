import { trueRatingsService } from './TrueRatingsService';

class LeagueStatsService {
    private leagueEraCache: Map<number, number> = new Map();

    public async getLeagueEra(year: number): Promise<number> {
        if (this.leagueEraCache.has(year)) {
            return this.leagueEraCache.get(year)!;
        }

        const pitchingStats = await trueRatingsService.getTruePitchingStats(year);
        
        let totalEr = 0;
        let totalOuts = 0;

        for (const player of pitchingStats) {
            totalEr += player.er;
            totalOuts += this.parseIpToOuts(player.ip);
        }

        const totalIp = totalOuts / 3;
        const leagueEra = (totalEr * 9) / totalIp;

        this.leagueEraCache.set(year, leagueEra);
        return leagueEra;
    }

    private parseIpToOuts(ip: string): number {
        const parts = ip.split('.');
        const fullInnings = parseInt(parts[0], 10);
        const partialInnings = parts.length > 1 ? parseInt(parts[1], 10) : 0;
        return (fullInnings * 3) + partialInnings;
    }
}

export const leagueStatsService = new LeagueStatsService();
