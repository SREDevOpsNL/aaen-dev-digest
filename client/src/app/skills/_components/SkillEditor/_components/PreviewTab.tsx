"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { skillStyles as s } from "../../../styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={s.content}>
      <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t("preview.title")}</h2>
      <p style={{ ...s.muted, margin: "4px 0 16px" }}>{t("preview.subtitle")}</p>
      <div style={s.preview}><Markdown>{skill.body}</Markdown></div>
    </div>
  );
}
