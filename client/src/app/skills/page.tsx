"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useSkills } from "@/lib/hooks/skills";
import { SkillsRail } from "./_components/SkillsRail";
import { skillStyles as s } from "./styles";

export default function SkillsPage() {
  const t = useTranslations("skills");
  const skills = useSkills();
  const isEmpty = !skills.isLoading && !skills.isError && (skills.data?.length ?? 0) === 0;
  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      <div style={s.layout}>
        <SkillsRail />
        <div style={{ ...s.detail, justifyContent: "center" }}>
          <EmptyState
            icon="Sparkles"
            title={isEmpty ? t("page.empty.title") : t("page.selectPrompt.title")}
            body={isEmpty ? t("page.empty.body") : t("page.selectPrompt.body")}
          />
        </div>
      </div>
    </AppShell>
  );
}
