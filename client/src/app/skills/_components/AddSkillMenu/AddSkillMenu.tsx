"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown } from "@devdigest/ui";
import { CreateSkillModal } from "../SkillsRail/_components/CreateSkillModal";
import { ImportSkillDrawer } from "../SkillsRail/_components/ImportSkillDrawer";

/** The single "Add skill" entry point: a menu offering Create (modal) or Import (drawer). */
export function AddSkillMenu({ size = "sm" }: { size?: "sm" | "md" }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const [open, setOpen] = React.useState<"create" | "import" | null>(null);
  const openDetails = (id: string) => {
    setOpen(null);
    router.push(`/skills/${id}?tab=config`);
  };

  return (
    <>
      <Dropdown
        align="right"
        width={240}
        trigger={<Button kind="primary" size={size} icon="Plus">{t("page.add")}</Button>}
        items={[
          { label: t("page.addCreate"), hint: t("page.addCreateHint"), icon: "Plus", onClick: () => setOpen("create") },
          { label: t("page.addImport"), hint: t("page.addImportHint"), icon: "Upload", onClick: () => setOpen("import") },
        ]}
      />
      {open === "create" && <CreateSkillModal onClose={() => setOpen(null)} onCreated={openDetails} />}
      {open === "import" && <ImportSkillDrawer onClose={() => setOpen(null)} onImported={openDetails} />}
    </>
  );
}
