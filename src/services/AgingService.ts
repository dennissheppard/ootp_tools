/**
 * Service for applying aging curves to pitcher ratings.
 * 
 * Provides deterministic baseline projections for rating changes based on age.
 * Does not account for "Talent Change Randomness" (TCR), only the expected average aging curve.
 */

export interface RatingModifiers {
  stuff: number;
  control: number;
  hra: number;
}

class AgingService {
  /**
   * Get expected rating changes from current age to next season (age + 1).
   * 
   * Curve Logic (Calibrated to typical OOTP aging):
   * - < 24: Development phase. Gains in Control/Stuff.
   * - 24-27: Peak. Minimal changes.
   * - 28-31: Slow decline. Minor Stuff loss, Control stable.
   * - 32+: Accelerated decline. Significant Stuff loss, Control/HRA fade.
   * 
   * @param age - Current age of the player
   */
  getAgingModifiers(age: number): RatingModifiers {
    // Default: No change
    let mods: RatingModifiers = { stuff: 0, control: 0, hra: 0 };

    if (age < 22) {
      // Rapid Development
      mods = { stuff: 2.0, control: 3.0, hra: 1.5 };
    } else if (age < 25) {
      // Late Development
      mods = { stuff: 1.0, control: 2.0, hra: 1.0 };
    } else if (age < 28) {
      // Peak Plateau
      mods = { stuff: 0, control: 0.5, hra: 0 };
    } else if (age < 32) {
      // Slow Decline
      mods = { stuff: -1.0, control: -0.5, hra: -0.5 };
    } else if (age < 35) {
      // Moderate Decline
      mods = { stuff: -2.5, control: -1.5, hra: -1.5 };
    } else {
      // Steep Decline
      mods = { stuff: -4.0, control: -2.5, hra: -2.5 };
    }

    return mods;
  }

  /**
   * Apply aging to a set of ratings
   */
  applyAging(
    ratings: { stuff: number; control: number; hra: number },
    age: number
  ): { stuff: number; control: number; hra: number } {
    const mods = this.getAgingModifiers(age);
    
    // Clamp between 20-80
    const clamp = (val: number) => Math.max(20, Math.min(80, val));

    return {
      stuff: clamp(ratings.stuff + mods.stuff),
      control: clamp(ratings.control + mods.control),
      hra: clamp(ratings.hra + mods.hra),
    };
  }
}

export const agingService = new AgingService();
