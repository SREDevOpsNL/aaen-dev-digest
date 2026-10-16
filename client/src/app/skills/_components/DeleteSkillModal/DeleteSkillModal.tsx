"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ConfirmModal } from "@/components/confirm-modal";
import { useDeleteSkill, useSkillAgents } from "@/lib/hooks/skills";

/** Confirms deleting a skill and names the agents that will lose it. */
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
  const names = linkedAgents.data?.map((agent) => agent.name).join(", ");

  const confirm = async () => {
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
      error={remove.isError ? t("delete.failed") : null}
      onConfirm={() => void confirm()}
      onCancel={onClose}
    >
      <p>{t("config.deleteConfirm", { name: skill.name })}</p>
      {names && <p style={{ marginTop: 8 }}>{t("config.deleteLinkedAgents", { names })}</p>}
    </ConfirmModal>
  );
}
