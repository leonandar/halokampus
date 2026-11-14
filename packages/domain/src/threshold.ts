/** Scores are compared in integer basis points (4 decimals) to avoid float drift (KB-01/KB-02). */
export function toBasisPoints(x: number): number {
  return Math.round(x * 10000);
}

/** True when `score` is strictly below `threshold`. A score equal to the threshold is NOT below. */
export function isBelowThreshold(score: number, threshold: number): boolean {
  return toBasisPoints(score) < toBasisPoints(threshold);
}

export function roundScore(x: number): number {
  return toBasisPoints(x) / 10000;
}
