"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, TextInput } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { SKILL_TYPES } from "../../../constants";

export function CreateSkillModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useTranslations("skills");
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim(),
      description: description.trim(),
      type,
      source: "manual",
      body: t("create.starterBody", { name: name.trim() }),
      enabled: true,
    });
    onCreated(skill.id);
  };

  return (
    <Modal
      width={520}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8 }}>
          <Button kind="primary" onClick={() => void submit()} disabled={!name.trim() || create.isPending}>
            {create.isPending ? t("actions.creating") : t("create.create")}
          </Button>
          <Button kind="ghost" onClick={onClose}>{t("actions.cancel")}</Button>
        </div>
      }
    >
      <div style={{ padding: 24 }}>
        <FormField label={t("fields.name")} required>
          <TextInput value={name} onChange={setName} placeholder={t("fields.namePlaceholder")} mono />
        </FormField>
        <FormField label={t("fields.description")}>
          <TextInput value={description} onChange={setDescription} placeholder={t("fields.descriptionPlaceholder")} />
        </FormField>
        <FormField label={t("fields.type")}>
          <SelectInput
            value={type}
            onChange={(value) => setType(value as SkillType)}
            options={SKILL_TYPES.map((value) => ({ value, label: t(`listItem.type.${value}`) }))}
          />
        </FormField>
        {create.isError && <div role="alert" style={{ color: "var(--crit)", fontSize: 13 }}>{t("create.createFailed")}</div>}
      </div>
    </Modal>
  );
}
