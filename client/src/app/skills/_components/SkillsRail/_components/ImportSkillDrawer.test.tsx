import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/skills.json";

const createSkill = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutateAsync: createSkill, isPending: false, isError: false }),
}));

import { ImportSkillDrawer } from "./ImportSkillDrawer";

afterEach(cleanup);

describe("ImportSkillDrawer", () => {
  it("previews the uploaded file and records the skill as imported_file", async () => {
    createSkill.mockResolvedValue({ id: "imported" });
    const onImported = vi.fn();
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <ImportSkillDrawer onClose={vi.fn()} onImported={onImported} />
      </NextIntlClientProvider>,
    );
    const text = "# deprecation-policy\n\nDeprecate before removing.";
    const file = new File([text], "deprecation-policy.md", { type: "text/markdown" });
    // jsdom's File has no text(); the browser's does.
    Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
    fireEvent.change(container.ownerDocument.querySelector('input[type="file"]')!, { target: { files: [file] } });

    const body = (await screen.findByDisplayValue(/Deprecate before removing/)) as HTMLTextAreaElement;
    expect(body.value).toBe("# deprecation-policy\n\nDeprecate before removing."); // shown before saving
    expect(createSkill).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Import skill" }));
    await waitFor(() =>
      expect(createSkill).toHaveBeenCalledWith(
        expect.objectContaining({ name: "deprecation-policy", source: "imported_file", body: "# deprecation-policy\n\nDeprecate before removing." }),
      ),
    );
    expect(onImported).toHaveBeenCalledWith("imported");
  });
});
