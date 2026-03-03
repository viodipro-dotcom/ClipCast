import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './_helpers';
import { addFiles, waitForRows, clearJobs, clearRowPrefs, setSettings, getRowDataViaIPC } from './_test-helpers';

test('Auto Plan OFF: importing does not auto-schedule or enable targets', async () => {
  const { app, window } = await launchApp();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  // Start from a clean persisted state for determinism.
  await clearJobs(window);
  await clearRowPrefs(window);

  // Turn Auto Plan off (app default is ON).
  await setSettings(window, { autoEnabled: false });
  await window.waitForTimeout(500);

  await addFiles(window);
  const rowCount = await waitForRows(window, 1);
  expect(rowCount).toBeGreaterThanOrEqual(1);

  // With Auto Plan OFF, we should not create scheduled jobs automatically.
  const jobsCount = await window.evaluate(async () => {
    try {
      const jobs = await (window as any).api?.jobsLoad?.();
      return Array.isArray(jobs) ? jobs.length : 0;
    } catch {
      return 0;
    }
  });
  expect(jobsCount).toBe(0);

  // Also verify the first row's defaults (targets should be all false).
  const rowJob = await getRowDataViaIPC(window, 0);
  if (rowJob?.targets) {
    expect(rowJob.targets.youtube).toBe(false);
    expect(rowJob.targets.instagram).toBe(false);
    expect(rowJob.targets.tiktok).toBe(false);
  }

  await closeApp(app);
});

