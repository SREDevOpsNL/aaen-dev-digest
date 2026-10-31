"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentSkillDetail,
  Skill,
  SkillApprovalRecord,
  SkillSummary,
  SkillType,
  SkillVersion,
} from "@devdigest/shared";
import { api } from "../api";

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  source: "manual" | "imported_file" | "extracted";
  body: string;
  enabled?: boolean;
  evidence_files?: string[];
  /** Link the new skill to this agent in the same request (the server enforces the 4-skill limit). */
  link_agent_id?: string;
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
    onSuccess: (skill, input) => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.setQueryData(["skill", skill.id], skill);
      if (input.link_agent_id) {
        queryClient.invalidateQueries({ queryKey: ["agent-skills", input.link_agent_id] });
        queryClient.invalidateQueries({ queryKey: ["agent", input.link_agent_id] });
        queryClient.invalidateQueries({ queryKey: ["agents"] });
      }
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
      // Deleting a skill unlinks it from every agent: refresh their links and counts.
      queryClient.invalidateQueries({ queryKey: ["agent-skills"] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

/** Restore a previous version's body; the server appends it as a new version. */
export function useRestoreSkillVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.post<Skill>(`/skills/${id}/versions/${version}/restore`, {}),
    onSuccess: (skill) => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.invalidateQueries({ queryKey: ["skill-versions", skill.id] });
      queryClient.setQueryData(["skill", skill.id], skill);
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

/** Turn one linked skill on or off for one agent (the per-agent switch). */
export function useSetAgentSkillEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillId, enabled }: { agentId: string; skillId: string; enabled: boolean }) =>
      api.patch<AgentSkillDetail[]>(`/agents/${agentId}/skills/${skillId}`, { enabled }),
    onSuccess: (links, variables) => {
      queryClient.setQueryData(["agent-skills", variables.agentId], links);
    },
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
      // The agents list carries each agent's linked-skill count.
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

/** The append-only approval audit for one skill, newest first. */
export function useSkillApprovals(id: string) {
  return useQuery({
    queryKey: ["skill-approvals", id],
    queryFn: () => api.get<SkillApprovalRecord[]>(`/skills/${id}/approvals`),
  });
}

function useApprovalMutation<V extends { id: string }>(request: (variables: V) => Promise<Skill>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (skill) => {
      queryClient.setQueryData(["skill", skill.id], skill);
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.invalidateQueries({ queryKey: ["skill-approvals", skill.id] });
      // Agent Skills tabs show each linked skill's approval state.
      queryClient.invalidateQueries({ queryKey: ["agent-skills"] });
    },
  });
}

/**
 * Approve the exact content the owner reviewed: the version and body digest
 * the page showed. The server refuses (409) if the body changed since.
 */
export function useApproveSkill() {
  return useApprovalMutation(({ id, version, body_sha256, reason }: { id: string; version: number; body_sha256: string; reason?: string }) =>
    api.post<Skill>(`/skills/${id}/approval`, { version, body_sha256, ...(reason ? { reason } : {}) }),
  );
}

/** Revoke the skill's approval; its content then blocks reviews while enabled. */
export function useRevokeSkill() {
  return useApprovalMutation(({ id, reason }: { id: string; reason?: string }) =>
    api.del<Skill>(`/skills/${id}/approval`, reason ? { reason } : undefined),
  );
}
