/**
 * Fail tests when the page logs console errors or uncaught exceptions.
 * Call once per spec file with that file's `test` from `@playwright/test`.
 *
 * @param {import("@playwright/test").TestType} test
 */
export function installConsoleErrorAssertions(test) {
  const consoleErrors = new Map();

  test.beforeEach(async ({ page }) => {
    const errors = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(`Console error: ${msg.text()}`);
      }
    });

    page.on("pageerror", (error) => {
      errors.push(
        `Page error: ${error.message}${error.stack ? `\n${error.stack}` : ""}`,
      );
    });

    consoleErrors.set(page, errors);
  });

  test.afterEach(async ({ page }) => {
    const errors = consoleErrors.get(page) || [];
    if (errors.length > 0) {
      consoleErrors.delete(page);
      throw new Error(`Console/Page errors detected:\n${errors.join("\n")}`);
    }
    consoleErrors.delete(page);
  });
}
