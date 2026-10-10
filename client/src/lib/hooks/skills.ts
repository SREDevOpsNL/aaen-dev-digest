"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentSkillDetail,
  Skill,
  SkillSummary,
  SkillType,
  SkillVersion,
} from "@devdigest/shared";
import { api } from "../api";

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  source: "manual" | "extracted";
  body: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
}

export interface LinkedAgentSummary {
  id: string;
  name: string;
}

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<SkillSummary[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export function useCreateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: (skill) => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.setQueryData(["skill", skill.id], skill);
    },
  });
}

export function useUpdateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (skill) => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.invalidateQueries({ queryKey: ["skill-versions", skill.id] });
      queryClient.setQueryData(["skill", skill.id], skill);
    },
  });
}

export function useDeleteSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.removeQueries({ queryKey: ["skill", id] });
      queryClient.removeQueries({ queryKey: ["skill-versions", id] });
    },
  });
}

export function useSkillVersions(id: string) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
  });
}

export function useSkillAgents(id: string) {
  return useQuery({
    queryKey: ["skill-agents", id],
    queryFn: () => api.get<LinkedAgentSummary[]>(`/skills/${id}/agents`),
  });
}

export function useAgentSkills(agentId: string) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillDetail[]>(`/agents/${agentId}/skills`),
  });
}

export function useSetAgentSkills() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: { agentId: string; skillIds: string[] }) =>
      api.post<AgentSkillDetail[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (links, variables) => {
      queryClient.setQueryData(["agent-skills", variables.agentId], links);
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.invalidateQueries({ queryKey: ["agent", variables.agentId] });
    },
  });
}
