import { test, expect } from "@playwright/test";

test("ingest: adding a URL enables the primary action", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /into focus/i })).toBeVisible();

  const cta = page.getByRole("button", { name: /Parse & index/i });
  await expect(cta).toBeDisabled();

  await page.getByLabel("PDF URL").fill("https://example.com/quarterly-report.pdf");
  await page.getByRole("button", { name: "Add" }).click();

  await expect(page.getByText("quarterly-report.pdf")).toBeVisible();
  await expect(cta).toBeEnabled();
});

test("ingest: rejects a non-URL", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("PDF URL").fill("not a url");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText(/valid http\(s\) URL/i)).toBeVisible();
});

test("explore: graceful fallback when embed isn't configured", async ({ page }) => {
  await page.goto("/explore?doc=chunks_demo");
  await expect(page.getByText(/isn't embeddable yet/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /Open in MotherDuck/i })).toBeVisible();
});

test("progress: a failed run surfaces the real reason", async ({ page }) => {
  // Run 10 of document-parse FAILED live (ACM 403). baseline above all runs → no embed run.
  await page.goto("/progress?parseRun=10&baselineEmbedRun=999999&doc=x");
  await expect(page.getByText(/Forbidden|403|FAILED/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /Try again/i })).toBeVisible();
});
