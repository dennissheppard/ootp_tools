/**
 * HitterAgingService
 *
 * Provides deterministic baseline projections for hitter rating changes based on age.
 * Does not account for "Talent Change Randomness" (TCR), only the expected average aging curve.
 *
 * Hitter Aging Characteristics:
 * - Power: Peaks 26-30, declines faster after 33
 * - Eye (plate discipline): Peaks later (28-32), declines slowly
 * - AvoidK (contact ability): Declines steadily from 28+
 * - Contact: Peaks 25-29, declines moderately after 32
 * - Speed: Declines from 27+ (not modeled here since not part of core wOBA)
 */

export interface HitterRatingModifiers {
  power: number;
  eye: number;
  avoidK: number;
  contact: number;
}

class HitterAgingService {
  /**
   * Get expected rating changes from current age to next season (age + 1).
   *
   * Curve Logic (Calibrated to typical OOTP aging):
   * - < 24: Development phase. Gains across the board.
   * - 24-26: Late development. Small gains, approaching peak.
   * - 27-29: Peak. Minimal changes.
   * - 30-32: Early decline. Power stable, other skills fade.
   * - 33-35: Moderate decline. Power starts fading.
   * - 36+: Accelerated decline.
   *
   * @param age - Current age of the player
   */
  getAgingModifiers(age: number): HitterRatingModifiers {
    // Default: No change
    let mods: HitterRatingModifiers = { power: 0, eye: 0, avoidK: 0, contact: 0 };

    if (age < 22) {
      // Rapid Development (18-21)
      mods = { power: 2.5, eye: 2.0, avoidK: 2.5, contact: 2.0 };
    } else if (age < 25) {
      // Late Development (22-24)
      mods = { power: 1.5, eye: 1.5, avoidK: 1.0, contact: 1.5 };
    } else if (age < 27) {
      // Approaching Peak (25-26)
      mods = { power: 0.5, eye: 1.0, avoidK: 0.5, contact: 0.5 };
    } else if (age < 30) {
      // Peak Plateau (27-29)
      mods = { power: 0, eye: 0.5, avoidK: 0, contact: 0 };
    } else if (age < 33) {
      // Early Decline (30-32)
      // Power holds longest, eye peaks late, avoidK/contact start declining
      mods = { power: -0.5, eye: 0, avoidK: -1.0, contact: -0.5 };
    } else if (age < 36) {
      // Moderate Decline (33-35)
      mods = { power: -1.5, eye: -0.5, avoidK: -1.5, contact: -1.0 };
    } else if (age < 39) {
      // Steep Decline (36-38)
      mods = { power: -2.5, eye: -1.5, avoidK: -2.5, contact: -2.0 };
    } else if (age < 42) {
      // Very Steep Decline (39-41)
      mods = { power: -4.0, eye: -3.0, avoidK: -4.0, contact: -3.5 };
    } else {
      // Cliff (42+)
      mods = { power: -8.0, eye: -5.0, avoidK: -8.0, contact: -6.0 };
    }

    return mods;
  }

  /**
   * Apply aging to a set of hitter ratings
   */
  applyAging(
    ratings: { power: number; eye: number; avoidK: number; contact: number },
    age: number
  ): { power: number; eye: number; avoidK: number; contact: number } {
    const mods = this.getAgingModifiers(age);

    // Internal clamp: 0-100 (wider than display range of 20-80)
    // This allows extreme ratings internally while preventing absurd outliers
    const clamp = (val: number) => Math.max(0, Math.min(100, val));

    return {
      power: clamp(ratings.power + mods.power),
      eye: clamp(ratings.eye + mods.eye),
      avoidK: clamp(ratings.avoidK + mods.avoidK),
      contact: clamp(ratings.contact + mods.contact),
    };
  }

  /**
   * Project ratings multiple years into the future
   */
  projectRatings(
    ratings: { power: number; eye: number; avoidK: number; contact: number },
    currentAge: number,
    yearsForward: number = 1
  ): { power: number; eye: number; avoidK: number; contact: number } {
    let projected = { ...ratings };

    for (let i = 0; i < yearsForward; i++) {
      projected = this.applyAging(projected, currentAge + i);
    }

    return projected;
  }

  /**
   * Get the expected peak age for each rating
   */
  getPeakAges(): { power: number; eye: number; avoidK: number; contact: number } {
    return {
      power: 28,   // Power peaks 26-30
      eye: 30,     // Eye peaks later (28-32)
      avoidK: 27,  // AvoidK peaks 25-28
      contact: 27, // Contact peaks 25-29
    };
  }
}

export const hitterAgingService = new HitterAgingService();
