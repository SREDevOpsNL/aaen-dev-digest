import type { ConventionStatus } from "@devdigest/shared";

export const FILTERS = ["pending", "accepted", "rejected", "all"] as const;
export type ConventionFilter = (typeof FILTERS)[number];

export const FILTER_STATUSES: Record<ConventionFilter, ConventionStatus[] | null> = {
  pending: ["pending"],
  accepted: ["accepted"],
  rejected: ["rejected"],
  all: null,
};

export const SKELETON_CARDS = 3;
export const CONFIDENCE_OK = 0.85;
export const CONFIDENCE_WARN = 0.65;
