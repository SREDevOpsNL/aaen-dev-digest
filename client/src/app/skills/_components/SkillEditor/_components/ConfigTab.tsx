"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useDeleteSkill, useSkillAgents, useUpdateSkill } from "@/lib/hooks/skills";
import { approximateTokens } from "../../../helpers";
import { SKILL_TYPES } from "../../../constants";
import { skillStyles as s } from "../../../styles";

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const update = useUpdateSkill();
  const remove = useDeleteSkill();
  const linkedAgents = useSkillAgents(skill.id);
  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);

  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
  }, [skill]);

  const isDirty = name !== skill.name || description !== skill.description || type !== skill.type || body !== skill.body;
  const save = async () => {
    await update.mutateAsync({
      id: skill.id,
      patch: { name: name.trim(), description: description.trim(), type, body },
    });
  };
  const deleteSkill = async () => {
    const names = linkedAgents.data?.map((agent) => agent.name).join(", ");
    const impact = names ? `\n\n${t("config.deleteLinkedAgents", { names })}` : "";
    if (!window.confirm(`${t("config.deleteConfirm", { name: skill.name })}${impact}`)) return;
    await remove.mutateAsync(skill.id);
    router.push("/skills");
  };

  return (
    <div style={s.content}>
      <div style={s.sectionRow}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t("config.title")}</h2>
        <Badge color="var(--text-secondary)" mono>{t("editor.version", { version: skill.version })}</Badge>
        <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, color: "var(--text-secondary)" }}>
          {t("config.enabled")}
          <Toggle on={skill.enabled} onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })} />
        </label>
      </div>
      <FormField label={t("fields.name")} required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>
      <FormField label={t("fields.description")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label={t("fields.type")}>
        <SelectInput
          value={type}
          onChange={(value) => setType(value as SkillType)}
          options={SKILL_TYPES.map((value) => ({ value, label: t(`listItem.type.${value}`) }))}
        />
      </FormField>
      <FormField label={t("fields.body")} required hint={t("config.bodyHint")}>
        <div style={s.editorFrame}>
          <div style={s.editorBar}>
            <span className="mono" style={{ fontSize: 12 }}>{name || skill.name}.md</span>
            {isDirty && <Badge color="var(--warn)">{t("config.unsaved")}</Badge>}
            <span className="mono" style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 11 }}>
              {t("config.tokens", { count: approximateTokens(body) })}
            </span>
          </div>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            aria-label={t("fields.body")}
            className="mono"
            spellCheck={false}
            style={s.bodyInput}
          />
        </div>
      </FormField>
      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={() => void save()} disabled={!isDirty || !name.trim() || !body.trim() || update.isPending}>
          {update.isPending ? t("actions.saving") : t("actions.save")}
        </Button>
        <Button kind="danger" icon="Trash" onClick={() => void deleteSkill()} disabled={remove.isPending}>
          {remove.isPending ? t("actions.deleting") : t("actions.delete")}
        </Button>
      </div>
      {(update.isError || remove.isError) && <div role="alert" style={{ color: "var(--crit)", fontSize: 13 }}>{t("config.mutationFailed")}</div>}
    </div>
  );
}
