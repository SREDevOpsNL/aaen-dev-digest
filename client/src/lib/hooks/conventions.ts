"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentSkillDetail,
  ConventionCandidate,
  ConventionExtractResult,
  ConventionSkillDraft,
  ConventionStatus,
} from "@devdigest/shared";
import { api } from "../api";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useExtractConventions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<ConventionExtractResult>(`/repos/${repoId}/conventions/extract`, {}),
    onSuccess: (result, repoId) => {
      queryClient.setQueryData(["conventions", repoId], result.candidates);
    },
  });
}

export interface UpdateConventionInput {
  repoId: string;
  id: string;
  patch: { rule?: string; rationale?: string | null; status?: ConventionStatus };
}

export function useUpdateConvention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: (updated, { repoId }) => {
      queryClient.setQueryData<ConventionCandidate[]>(["conventions", repoId], (previous) =>
        previous?.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
    },
  });
}

export function useDeleteConvention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { repoId: string; id: string }) =>
      api.del<{ ok: boolean }>(`/conventions/${id}`),
    onSuccess: (_result, { repoId, id }) => {
      queryClient.setQueryData<ConventionCandidate[]>(["conventions", repoId], (previous) =>
        previous?.filter((candidate) => candidate.id !== id),
      );
    },
  });
}

export function useConventionSkillDraft() {
  return useMutation({
    mutationFn: ({ repoId, conventionIds }: { repoId: string; conventionIds?: string[] }) =>
      api.post<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill`, {
        ...(conventionIds ? { convention_ids: conventionIds } : {}),
      }),
  });
}

/** Append a skill to an agent without replacing any existing ordered links. */
export function useAppendAgentSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ agentId, skillId }: { agentId: string; skillId: string }) => {
      const current = await api.get<AgentSkillDetail[]>(`/agents/${agentId}/skills`);
      const skillIds = current.map((link) => link.skill.id);
      if (!skillIds.includes(skillId)) skillIds.push(skillId);
      return api.post<AgentSkillDetail[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds });
    },
    onSuccess: (links, { agentId }) => {
      queryClient.setQueryData(["agent-skills", agentId], links);
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
    },
  });
}
