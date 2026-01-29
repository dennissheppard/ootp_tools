/**
 * Shared service for FIP and WAR calculations.
 * Both PotentialStatsService and RatingEstimatorService should use this
 * to ensure consistent results across the app.
 */

export interface FipWarInput {
    ip: number;
    k9: number;
    bb9: number;
    hr9: number;
}

export interface FipWarResult {
    fip: number;
    war: number;
}

export interface LeagueConstants {
    fipConstant: number;
    replacementFip: number;  // Baseline for WAR calculation (typically ~lgERA)
    runsPerWin: number;
}

// WBL league defaults - calibrated from OOTP 2018-2020 WAR data analysis
// Note: These are fallbacks only; prefer using league-specific context when available
const WBL_DEFAULTS: LeagueConstants = {
    fipConstant: 3.47,
    replacementFip: 5.20,  // Calibrated: avgFip (~4.20) + 1.00 (matches OOTP across all tiers)
    runsPerWin: 8.50,      // Standard WAR conversion rate
};

// Role-based WAR parameters (calibrated from OOTP 2018-2020 WAR distribution)
// OOTP uses consistent replacement level across roles
const ROLE_PARAMS = {
    starter: { replacementFip: 5.20, runsPerWin: 8.50 },    // IP >= 150
    middle: { replacementFip: 5.20, runsPerWin: 8.50 },     // 80 <= IP < 150
    reliever: { replacementFip: 5.20, runsPerWin: 8.50 },   // IP < 80
};

class FipWarService {
    /**
     * Calculate FIP (Fielding Independent Pitching)
     *
     * FIP = ((13×HR/9) + (3×BB/9) - (2×K/9)) / 9 + FIP constant
     *
     * The FIP constant is calibrated so that league average FIP = league average ERA
     */
    calculateFip(stats: FipWarInput, fipConstant: number = WBL_DEFAULTS.fipConstant): number {
        const fip = ((13 * stats.hr9) + (3 * stats.bb9) - (2 * stats.k9)) / 9 + fipConstant;
        return Math.round(fip * 100) / 100;  // Round to 2 decimal places
    }

    /**
     * Calculate WAR (Wins Above Replacement)
     *
     * WAR = ((replacementFIP - playerFIP) / runsPerWin) × (IP / 9)
     *
     * @param fip - Player's FIP
     * @param ip - Innings pitched
     * @param replacementFip - Replacement level FIP baseline (~league ERA)
     * @param runsPerWin - Runs per win (typically 10)
     */
    calculateWar(
        fip: number,
        ip: number,
        replacementFip: number = WBL_DEFAULTS.replacementFip,
        runsPerWin: number = WBL_DEFAULTS.runsPerWin
    ): number {
        const war = ((replacementFip - fip) / runsPerWin) * (ip / 9);
        return Math.round(war * 10) / 10;  // Round to 1 decimal place
    }

    /**
     * Get role-based WAR parameters based on IP
     * OOTP uses different replacement levels for starters vs relievers (leverage adjustment)
     */
    private getRoleParams(ip: number): { replacementFip: number; runsPerWin: number } {
        if (ip >= 150) return ROLE_PARAMS.starter;
        if (ip >= 80) return ROLE_PARAMS.middle;
        return ROLE_PARAMS.reliever;
    }

    /**
     * Calculate both FIP and WAR in one call
     * Uses role-based parameters (starter/reliever) when no explicit constants provided
     */
    calculate(stats: FipWarInput, constants: Partial<LeagueConstants> = {}): FipWarResult {
        const fipConstant = constants.fipConstant ?? WBL_DEFAULTS.fipConstant;

        // Use role-based params if not explicitly provided
        const roleParams = this.getRoleParams(stats.ip);
        const replacementFip = constants.replacementFip ?? roleParams.replacementFip;
        const runsPerWin = constants.runsPerWin ?? roleParams.runsPerWin;

        const fip = this.calculateFip(stats, fipConstant);
        const war = this.calculateWar(fip, stats.ip, replacementFip, runsPerWin);

        return { fip, war };
    }

    /**
     * Get the default WBL league constants
     */
    getDefaults(): LeagueConstants {
        return { ...WBL_DEFAULTS };
    }
}

export const fipWarService = new FipWarService();
