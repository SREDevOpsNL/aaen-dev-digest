"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { ApiError } from "@/lib/api";
import { useSkill } from "@/lib/hooks/skills";
import { SKILL_TABS } from "../constants";
import { SkillsRail } from "../_components/SkillsRail";
import { SkillEditor } from "../_components/SkillEditor";
import { skillStyles as s } from "../styles";

export default function SkillPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const t = useTranslations("skills");
  const skill = useSkill(id);
  const requestedTab = search.get("tab") ?? "config";
  const tab = (SKILL_TABS as readonly string[]).includes(requestedTab) ? requestedTab : "config";
  const setTab = (next: string) => {
    const params = new URLSearchParams(search.toString());
    params.set("tab", next);
    router.replace(`/skills/${id}?${params.toString()}`);
  };
  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbSkills"), href: "/skills" }];

  if (skill.isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("detail.notFound.title")}
          body={skill.error instanceof ApiError ? skill.error.message : t("detail.loadError")}
          onRetry={() => void skill.refetch()}
        />
      </AppShell>
    );
  }
  return (
    <AppShell crumb={crumb}>
      <div style={s.layout}>
        <SkillsRail activeId={id} tab={tab} />
        {skill.isLoading || !skill.data ? (
          <div style={{ ...s.detail, padding: 28, gap: 16 }}><Skeleton height={26} width={260} /><Skeleton height={280} /></div>
        ) : (
          <SkillEditor skill={skill.data} tab={tab} onTab={setTab} />
        )}
      </div>
    </AppShell>
  );
}
