import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './_helpers';
import { addFiles, clearJobs, clearRowPrefs, waitForRows } from './_test-helpers';

test('Publish skips platforms already done (jobs.json run.done)', async () => {
  const { app, window } = await launchApp();
  try {
    await clearJobs(window);
    await clearRowPrefs(window);

    await addFiles(window);
    const count = await waitForRows(window, 1);
    expect(count).toBeGreaterThan(0);

    const firstRow = window.locator('.MuiDataGrid-row').first();

    // Select first row
    await firstRow.locator('.MuiDataGrid-cellCheckbox').click({ force: true });
    await window.waitForTimeout(200);

    // Create a YouTube job already marked as done (avoid UI scheduling flakiness).
    const doneAt = 1234567890000;
    const filePath = path.join(process.cwd(), 'e2e', 'test-videos', 'video1.mp4');
    await window.evaluate(async ({ fp, atMs }) => {
      const api = (window as any).api;
      const jobs = (await api?.jobsLoad?.()) || [];
      jobs.push({
        id: `e2e-yt-done-${Date.now()}`,
        filePath: fp,
        publishAtUtcMs: Date.now() + 60_000,
        targets: { youtube: true, instagram: false, tiktok: false },
        visibility: 'private',
        selfDeclaredMadeForKids: false,
        createdAt: Date.now(),
        run: { youtube: { done: true, at: atMs, ok: true, videoId: 'already-posted' } },
      });
      await api?.jobsSave?.(jobs);
    }, { fp: filePath, atMs: doneAt });
    await window.waitForTimeout(300);

    // Sanity check: done flag is persisted before running Publish.
    const before = await window.evaluate(async () => {
      const jobs = await (window as any).api?.jobsLoad?.();
      const ytJob = (jobs || []).find((j: any) => String(j?.id || '').startsWith('e2e-yt-done-'));
      return { done: ytJob?.run?.youtube?.done, at: ytJob?.run?.youtube?.at };
    });
    expect(before.done).toBeTruthy();
    expect(before.at).toBe(doneAt);

    // Run Publish → YouTube only. It should SKIP (not require connection, not change at).
    const publishBtn = window.getByRole('button', { name: /🚀\s*publish/i });
    await expect(publishBtn).toBeVisible({ timeout: 15000 });
    await publishBtn.click();

    const publishDialog = window.locator('[role="dialog"]').filter({ hasText: /publish/i }).first();
    await expect(publishDialog).toBeVisible({ timeout: 5000 });

    await publishDialog.getByLabel(/YouTube only/i).click();
    await publishDialog.getByRole('button', { name: /publish to youtube/i }).click();

    await window.waitForTimeout(800);

    const jobsAfter = await window.evaluate(async () => {
      return await (window as any).api?.jobsLoad?.();
    });
    const ytJob = (jobsAfter || []).find((j: any) => String(j?.id || '').startsWith('e2e-yt-done-'));
    expect(ytJob?.run?.youtube?.done).toBeTruthy();
    expect(ytJob?.run?.youtube?.at).toBe(doneAt);
  } finally {
    await closeApp(app);
  }
});

