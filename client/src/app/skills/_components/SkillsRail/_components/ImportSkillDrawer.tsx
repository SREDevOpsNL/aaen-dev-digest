"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Drawer, FormField, TextInput } from "@devdigest/ui";
import { useCreateSkill } from "@/lib/hooks/skills";
import { deriveSkillName, isSupportedSkillFileName } from "../../../helpers";

export function ImportSkillDrawer({ onClose, onImported }: { onClose: () => void; onImported: (id: string) => void }) {
  const t = useTranslations("skills");
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [body, setBody] = React.useState("");
  const [filename, setFilename] = React.useState<string>();
  const [fileError, setFileError] = React.useState<string>();

  const readFile = async (file?: File) => {
    if (!file) return;
    setFileError(undefined);
    if (!isSupportedSkillFileName(file.name)) {
      setFileError(t("import.unsupportedFile"));
      return;
    }
    try {
      setFilename(file.name);
      const text = await file.text();
      setBody(text);
      if (!name.trim()) setName(deriveSkillName(text, file.name));
    } catch {
      setFileError(t("import.readFailed"));
    }
  };

  const submit = async () => {
    const resolvedName = name.trim() || deriveSkillName(body, filename);
    const skill = await create.mutateAsync({
      name: resolvedName,
      description: t("import.defaultDescription"),
      type: "custom",
      source: "manual",
      body,
      enabled: false,
    });
    onImported(skill.id);
  };

  const resolvedName = name.trim() || deriveSkillName(body, filename);
  return (
    <Drawer
      width={620}
      title={t("drawer.title")}
      subtitle={t("drawer.subtitle")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8 }}>
          <Button kind="primary" icon="Upload" onClick={() => void submit()} disabled={!resolvedName || !body.trim() || create.isPending}>
            {create.isPending ? t("actions.importing") : t("actions.import")}
          </Button>
          <Button kind="ghost" onClick={onClose}>{t("actions.cancel")}</Button>
        </div>
      }
    >
      <div style={{ padding: 14, marginBottom: 18, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-elevated)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
        {t("drawer.localOnly")}
      </div>
      <FormField label={t("import.fileLabel")} hint={t("import.fileHint")}>
        <input type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" onChange={(event) => void readFile(event.target.files?.[0])} />
      </FormField>
      {fileError && <div role="alert" style={{ color: "var(--crit)", fontSize: 13, marginBottom: 12 }}>{fileError}</div>}
      <FormField label={t("fields.name")} hint={t("import.nameHint")}>
        <TextInput value={name} onChange={setName} placeholder={t("fields.namePlaceholder")} mono />
      </FormField>
      <FormField label={t("fields.body")} required hint={t("import.bodyHint")}>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={t("import.bodyPlaceholder")}
          aria-label={t("fields.body")}
          className="mono"
          style={{ width: "100%", minHeight: 320, resize: "vertical", border: "1px solid var(--border-strong)", borderRadius: 8, padding: 12, background: "var(--bg-primary)", color: "var(--text-primary)", lineHeight: 1.6 }}
        />
      </FormField>
      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("community.unavailable")}</div>
      {create.isError && <div role="alert" style={{ color: "var(--crit)", fontSize: 13, marginTop: 12 }}>{t("import.createFailed")}</div>}
    </Drawer>
  );
}
