"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, Icon, Modal, SelectInput, Skeleton, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { ConventionSkillDraft, SkillType } from "@devdigest/shared";
import { useAgents, useAppendAgentSkill, useCreateSkill } from "../../../../../../lib/hooks";
import { useToast } from "../../../../../../lib/toast";
import { s } from "../../styles";

const TYPE_VALUES: SkillType[] = ["convention", "rubric", "security", "custom"];

export interface CreateSkillModalProps {
  repoName: string;
  acceptedCount: number;
  draft: ConventionSkillDraft | undefined;
  onClose: () => void;
}

export function CreateSkillModal({ repoName, acceptedCount, draft, onClose }: CreateSkillModalProps) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const toast = useToast();
  const create = useCreateSkill();
  const appendSkill = useAppendAgentSkill();
  const { data: agents } = useAgents();

  const [name, setName] = React.useState(draft?.name ?? "");
  const [description, setDescription] = React.useState(draft?.description ?? "");
  const [type, setType] = React.useState<SkillType>(draft?.type ?? "convention");
  // Repository-derived guidance is untrusted until the maintainer has vetted
  // the editable draft, so extracted skills start globally disabled.
  const [enabled, setEnabled] = React.useState(false);
  const [body, setBody] = React.useState(draft?.body ?? "");
  const [agentId, setAgentId] = React.useState("");
  const seeded = React.useRef(false);

  React.useEffect(() => {
    if (!draft || seeded.current) return;
    seeded.current = true;
    setName(draft.name);
    setDescription(draft.description);
    setType(draft.type);
    setBody(draft.body);
  }, [draft]);

  const submit = async () => {
    try {
      const skill = await create.mutateAsync({
        name: name.trim(),
        description,
        type,
        body,
        source: "extracted",
        enabled,
        evidence_files: draft?.evidence_files,
      });
      if (agentId) await appendSkill.mutateAsync({ agentId, skillId: skill.id });
      toast.success(t("modal.created"));
      onClose();
      router.push(`/skills/${skill.id}?tab=config`);
    } catch {
      toast.error(t("modal.failed"));
    }
  };

  const pending = create.isPending || appendSkill.isPending;

  return (
    <Modal
      width={880}
      title={t("modal.title")}
      subtitle={name}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("modal.footerHint")}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <Button kind="ghost" onClick={onClose}>{t("modal.cancel")}</Button>
            <Button kind="primary" icon="Sparkles" onClick={submit} disabled={!draft || pending || name.trim().length === 0 || body.trim().length === 0}>
              {pending ? t("modal.submitting") : t("modal.submit")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.modalBody}>
        <div style={s.mergedBanner}>
          <Icon.Sparkles size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <span>{t("modal.mergedFrom", { count: acceptedCount, repo: repoName })}</span>
        </div>

        {!draft ? (
          <Skeleton height={320} />
        ) : (
          <>
            <FormField label={t("modal.name")} required><TextInput value={name} onChange={setName} /></FormField>
            <FormField label={t("modal.description")}><TextInput value={description} onChange={setDescription} /></FormField>
            <div style={{ display: "flex", gap: 24 }}>
              <div style={{ flex: 1 }}>
                <FormField label={t("modal.type")}>
                  <SelectInput value={type} onChange={(value) => setType(value as SkillType)} options={TYPE_VALUES.map((value) => ({ value, label: t(`modal.typeOption.${value}`) }))} />
                </FormField>
              </div>
              <div style={{ flex: 1 }}>
                <FormField label={t("modal.enabled")} hint={t("modal.enabledHint")}><Toggle on={enabled} onChange={setEnabled} /></FormField>
              </div>
            </div>
            <FormField label={t("modal.linkAgent")} hint={t("modal.linkAgentHint")}>
              <SelectInput value={agentId} onChange={setAgentId} options={[{ value: "", label: t("modal.linkAgentNone") }, ...(agents ?? []).map((agent) => ({ value: agent.id, label: agent.name }))]} />
            </FormField>
            <FormField label={t("modal.body")} required>
              <div style={s.bodyHeader}>
                <Icon.FileText size={13} />
                <span style={s.bodyFileName}>{name || t("modal.skillFileFallback")}.md</span>
                <span style={s.bodyTokens}>{t("modal.unsaved")}</span>
              </div>
              <Textarea value={body} onChange={setBody} rows={16} mono />
            </FormField>
          </>
        )}
      </div>
    </Modal>
  );
}
