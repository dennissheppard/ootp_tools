/**
 * Check if any TFR component exceeds its TR counterpart by >= threshold points.
 * Works for both batters (6 components) and pitchers (3 components).
 */
export function hasComponentUpside(
  trComponents: (number | undefined)[],
  tfrComponents: (number | undefined)[],
  threshold = 5
): boolean {
  for (let i = 0; i < trComponents.length; i++) {
    const tr = trComponents[i];
    const tfr = tfrComponents[i];
    if (tr !== undefined && tfr !== undefined && tfr - tr >= threshold) return true;
  }
  return false;
}
