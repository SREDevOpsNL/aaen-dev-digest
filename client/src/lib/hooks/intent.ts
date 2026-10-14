"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PrIntentView } from "@devdigest/shared";
import { api } from "../api";

const intentKey = (prId: string | null | undefined) => ["pr-intent", prId] as const;

/** Cached PR intent and its freshness. Reading never calls a model. */
export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: intentKey(prId),
    queryFn: () => api.get<PrIntentView>(`/pulls/${prId}/intent`),
    enabled: !!prId,
  });
}

/** First-open generation: the server derives only when nothing usable is cached. */
export function useEnsurePrIntent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prId: string) => api.post<PrIntentView>(`/pulls/${prId}/intent`, {}),
    onSuccess: (view, prId) => queryClient.setQueryData(intentKey(prId), view),
  });
}

/** Explicit Recompute. On failure the server keeps the previous intent and reports `last_error`. */
export function useRecomputePrIntent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prId: string) => api.post<PrIntentView>(`/pulls/${prId}/intent/recompute`, {}),
    onSuccess: (view, prId) => queryClient.setQueryData(intentKey(prId), view),
  });
}
