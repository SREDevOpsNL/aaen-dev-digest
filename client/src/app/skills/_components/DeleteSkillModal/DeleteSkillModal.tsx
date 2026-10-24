"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { ConfirmModal } from "@/components/confirm-modal";
import { useDeleteSkill, useSkillAgents } from "@/lib/hooks/skills";

/**
 * Confirms deleting a skill and names the agents that will lose it. Confirm stays
 * disabled until that impact is known: while it loads, and if loading fails
 * (with a Retry), so a skill is never deleted without its impact being shown.
 */
export function DeleteSkillModal({
  skill,
  onClose,
  onDeleted,
}: {
  skill: { id: string; name: string };
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const t = useTranslations("skills");
  const remove = useDeleteSkill();
  const linkedAgents = useSkillAgents(skill.id);
  const impactKnown = linkedAgents.isSuccess;
  const names = linkedAgents.data?.map((agent) => agent.name).join(", ");

  const confirm = async () => {
    if (!impactKnown) return;
    try {
      await remove.mutateAsync(skill.id);
      onClose();
      onDeleted?.();
    } catch {
      // Shown through `remove.isError`; the dialog stays open so the user can retry or cancel.
    }
  };

  return (
    <ConfirmModal
      title={t("delete.title")}
      confirmLabel={t("delete.confirm")}
      cancelLabel={t("delete.cancel")}
      pendingLabel={t("delete.deleting")}
      pending={remove.isPending}
      confirmDisabled={!impactKnown}
      error={remove.isError ? t("delete.failed") : null}
      onConfirm={() => void confirm()}
      onCancel={onClose}
    >
      <p>{t("config.deleteConfirm", { name: skill.name })}</p>
      <div style={{ marginTop: 8 }}>
        {impactKnown && <p>{names ? t("config.deleteLinkedAgents", { names }) : t("delete.noAgents")}</p>}
        {linkedAgents.isError && (
          <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--crit)" }}>
            <span style={{ flex: 1 }}>{t("delete.impactFailed")}</span>
            <Button kind="ghost" size="sm" onClick={() => void linkedAgents.refetch()}>{t("delete.retry")}</Button>
          </div>
        )}
        {!impactKnown && !linkedAgents.isError && <p role="status">{t("delete.impactLoading")}</p>}
      </div>
    </ConfirmModal>
  );
}
