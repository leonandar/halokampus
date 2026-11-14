import type { ConfidenceWeights } from "@hk/shared";
import { roundScore } from "./threshold.js";

export interface ConfidenceInput {
  /** Highest retrieval similarity, 0..1. */
  retrieval: number;
  /** Intent-classifier probability for the chosen intent, 0..1. */
  intent: number;
  /** LLM self-assessment, 0..1. */
  self: number;
}

export interface ConfidenceResult {
  score: number;
  components: ConfidenceInput;
  weights: ConfidenceWeights;
  contributions: ConfidenceInput;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * Composite, explainable confidence score (FR-02):
 *   C = w_ret·S_ret + w_int·P_int + w_self·S_self
 * Weights are normalised so they always sum to 1, which keeps C in [0, 1] even if
 * PRM-09 is edited to values that do not sum exactly to 1.
 */
export function computeConfidence(input: ConfidenceInput, weights: ConfidenceWeights): ConfidenceResult {
  const total = weights.retrieval + weights.intent + weights.self;
  if (!(total > 0)) throw new Error("PRM-09 weights must have a positive sum");
  const w: ConfidenceWeights = {
    retrieval: weights.retrieval / total,
    intent: weights.intent / total,
    self: weights.self / total,
  };
  const c: ConfidenceInput = { retrieval: clamp01(input.retrieval), intent: clamp01(input.intent), self: clamp01(input.self) };
  const contributions = { retrieval: w.retrieval * c.retrieval, intent: w.intent * c.intent, self: w.self * c.self };
  return {
    score: roundScore(contributions.retrieval + contributions.intent + contributions.self),
    components: c,
    weights: w,
    contributions,
  };
}
