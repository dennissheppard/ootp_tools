/**
 * Service for applying aging curves to batter ratings.
 *
 * Provides deterministic baseline projections for rating changes based on age.
 * Does not account for "Talent Change Randomness" (TCR), only the expected average aging curve.
 *
 * Batter aging differs from pitcher aging:
 * - Power peaks later and holds longer than stuff
 * - Eye (plate discipline) ages gracefully, often improving into 30s
 * - AvoidK (bat speed) declines earlier as bat speed decreases
 * - Speed declines early and steadily
 */

export interface BatterRatingModifiers {
  power: number;
  eye: number;
  avoidK: number;
  speed: number;
}

class BatterAgingService {
  /**
   * Get expected rating changes from current age to next season (age + 1).
   *
   * Curve Logic (Calibrated to typical OOTP batter aging):
   * - < 22: Rapid development in all areas except speed
   * - 22-24: Late development, power/eye still improving
   * - 25-28: Peak years, ratings stable
   * - 29-32: Early decline, speed fading, power holding
   * - 33-36: Moderate decline in bat speed (avoidK), power fading
   * - 37+: Steep decline across the board
   *
   * @param age - Current age of the player
   */
  getAgingModifiers(age: number): BatterRatingModifiers {
    // Default: No change
    let mods: BatterRatingModifiers = { power: 0, eye: 0, avoidK: 0, speed: 0 };

    if (age < 22) {
      // Rapid Development - Raw strength developing, learning strike zone
      mods = { power: 2.0, eye: 2.5, avoidK: 1.5, speed: 0 };
    } else if (age < 25) {
      // Late Development - Still gaining strength and discipline
      mods = { power: 1.0, eye: 1.5, avoidK: 1.0, speed: -0.5 };
    } else if (age < 29) {
      // Peak Years - Ratings stable at peak
      mods = { power: 0.5, eye: 0.5, avoidK: 0, speed: -1.0 };
    } else if (age < 33) {
      // Early Decline (29-32) - Speed and bat speed start fading, power holds
      mods = { power: -0.5, eye: -0.5, avoidK: -1.0, speed: -1.5 };
    } else if (age < 37) {
      // Moderate Decline (33-36) - Power starts fading, bat speed declining
      mods = { power: -1.5, eye: -1.0, avoidK: -1.5, speed: -2.0 };
    } else if (age < 40) {
      // Steep Decline (37-39) - Significant losses
      mods = { power: -3.0, eye: -2.0, avoidK: -2.5, speed: -3.0 };
    } else if (age < 43) {
      // Very Steep Decline (40-42)
      mods = { power: -5.0, eye: -3.0, avoidK: -5.0, speed: -5.0 };
    } else {
      // Cliff (43+) - Career ending decline
      mods = { power: -10.0, eye: -5.0, avoidK: -10.0, speed: -10.0 };
    }

    return mods;
  }

  /**
   * Apply aging to a set of ratings
   */
  applyAging(
    ratings: { power: number; eye: number; avoidK: number; speed: number },
    age: number
  ): { power: number; eye: number; avoidK: number; speed: number } {
    const mods = this.getAgingModifiers(age);

    // Clamp all ratings between 20-80 (speed now uses same scale as other ratings)
    const clamp2080 = (val: number) => Math.max(20, Math.min(80, val));

    return {
      power: clamp2080(ratings.power + mods.power),
      eye: clamp2080(ratings.eye + mods.eye),
      avoidK: clamp2080(ratings.avoidK + mods.avoidK),
      speed: clamp2080(ratings.speed + mods.speed),
    };
  }

  /**
   * Project ratings forward by a number of years
   */
  projectRatingsForward(
    ratings: { power: number; eye: number; avoidK: number; speed: number },
    currentAge: number,
    yearsForward: number
  ): { power: number; eye: number; avoidK: number; speed: number } {
    let projected = { ...ratings };

    for (let i = 0; i < yearsForward; i++) {
      projected = this.applyAging(projected, currentAge + i);
    }

    return projected;
  }

  /**
   * Get the expected peak age for a batter (when they're at their best)
   * Unlike pitchers, batters tend to peak a bit later
   */
  getPeakAge(): number {
    return 27; // Batters typically peak around 27
  }

  /**
   * Calculate years until peak for a prospect
   */
  yearsUntilPeak(currentAge: number): number {
    const peakAge = this.getPeakAge();
    return Math.max(0, peakAge - currentAge);
  }
}

export const batterAgingService = new BatterAgingService();
