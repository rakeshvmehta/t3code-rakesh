import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Custom sections retain their order through Working, dragging and reload",
  WEB,
  async ({ t3, app, screen, browser }) => {
    const project = await t3.project("section-order");
    for (const title of ["First task", "Middle task", "Last task"]) {
      await t3.thread({ project, title, messages: ["Start"], model: "showcase" });
    }
    await t3.open();
    await expect(screen.getByText("Middle task", { exact: true }).first()).toBeVisible();
    await browser.evaluate(`() => {
      const names = ["First task", "Middle task", "Last task"];
      const rows = [...document.querySelectorAll("[data-thread-item]")];
      const assignments = Object.fromEntries(
        rows
          .filter((row) => names.some((name) => row.textContent?.includes(name)))
          .map((row) => [row.dataset.threadItem, "priority"]),
      );
      const key = "t3code:rakesh:sidebar-sections:v1";
      localStorage.setItem(
        key,
        JSON.stringify({
          sections: [{ id: "priority", name: "Priority", collapsed: false }],
          assignments,
          chatsCollapsed: false,
        }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key }));
      return null;
    }`);
    await expect(screen.getByTestId("sidebar-custom-section-toggle")).toBeVisible();
    const order = () =>
      browser.evaluate<string[]>(`() => {
        const names = ["First task", "Middle task", "Last task"];
        return [...document.querySelectorAll("[data-thread-item]")].flatMap((row) =>
          names.filter((name) => row.textContent?.includes(name)),
        );
      }`);
    await expect(await order()).toEqual(["Last task", "Middle task", "First task"]);
    await screen.getByRole("button", /^Middle task,/).tap();
    await screen.getByRole("textbox").fill("Continue working");
    await screen.getByRole("textbox").press("Enter");
    await expect(screen.getByTestId("sidebar-working-header")).toBeVisible();
    await expect(screen.getByRole("button", "Stop generation")).toBeHidden();
    await expect(screen.getByTestId("sidebar-working-header")).toBeHidden();
    await app.screenshot("returned-to-section");
    await expect(await order()).toEqual(["Last task", "Middle task", "First task"]);
    await screen
      .getByRole("button", /^First task,/)
      .dragTo(screen.getByRole("button", /^Last task,/));
    await expect(await order()).toEqual(["First task", "Last task", "Middle task"]);
    await browser.reload();
    await expect(screen.getByTestId("sidebar-custom-section-toggle")).toBeVisible();
    await expect(await order()).toEqual(["First task", "Last task", "Middle task"]);
    await app.screenshot("saved-drag-order");
  },
);
