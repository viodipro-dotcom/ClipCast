import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './_helpers';
import { addFiles, waitForRows, clearJobs, clearRowPrefs, setSettings } from './_test-helpers';

test('Auto Plan OFF: scheduling YouTube creates only a YouTube job', async () => {
  const { app, window } = await launchApp();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  // Clean state so previous tests can't affect us.
  await clearJobs(window);
  await clearRowPrefs(window);

  // Turn Auto Plan off BEFORE importing.
  await setSettings(window, { autoEnabled: false });
  await window.waitForTimeout(500);

  await addFiles(window);
  const rowCount = await waitForRows(window, 1);
  expect(rowCount).toBeGreaterThanOrEqual(1);

  // Click Schedule in the YouTube column (this will automatically set YouTube target).
  const firstRow = window.locator('.MuiDataGrid-row').first();
  const ytScheduleButton = firstRow.locator('[data-field="youtube"]').getByRole('button', { name: /schedule/i });
  await ytScheduleButton.click();

  // Fill Date & Time and submit.
  const dialog = window.getByRole('dialog', { name: /schedule for/i });
  await expect(dialog).toBeVisible({ timeout: 5000 });

  const dt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  dt.setSeconds(0, 0);
  dt.setHours(9, 0, 0, 0);
  const v = dt.toISOString().slice(0, 16);
  await dialog.getByLabel('Date & Time').fill(v);

  await dialog.getByRole('button', { name: /^schedule$/i }).click();
  await window.waitForTimeout(800);

  // Verify only one job exists and it's YouTube-only.
  const jobs = await window.evaluate(async () => {
    try {
      return await (window as any).api?.jobsLoad?.();
    } catch {
      return [];
    }
  });
  expect(Array.isArray(jobs)).toBeTruthy();
  expect(jobs.length).toBe(1);
  expect(jobs[0]?.targets?.youtube).toBe(true);
  expect(jobs[0]?.targets?.instagram).toBe(false);
  expect(jobs[0]?.targets?.tiktok).toBe(false);

  await closeApp(app);
});

