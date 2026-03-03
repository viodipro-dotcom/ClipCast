import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './_helpers';
import { clearJobs } from './_test-helpers';

test('AutoUpload: IG manual assist queues for overlay and runs once', async () => {
  const { app, window } = await launchApp();
  try {
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1200);

    // Ensure clean persisted jobs so this test doesn't leak into others.
    await clearJobs(window);

    // Seed a due Instagram job directly.
    const filePath = 'd:\\Programs\\yt_uploader_app_FIXED10\\e2e\\test-videos\\video1.mp4';
    const job = {
      id: 'e2e-ig-1',
      filePath,
      publishAtUtcMs: Date.now() - 60_000,
      targets: { youtube: false, instagram: true, tiktok: false },
      visibility: 'private',
      createdAt: Date.now(),
      run: {},
    };

    await window.evaluate(async (j) => {
      await (window as any).api?.jobsSave?.([j]);
    }, job);

    // Ensure autoupload enabled; Silent ON so manual assist does NOT auto-open (overlay only).
    await window.evaluate(async () => {
      await (window as any).api?.autouploadSetSilentMode?.(true);
      await (window as any).api?.autouploadSetEnabled?.(true);
    });

    await window.waitForTimeout(800);

    const first = await window.evaluate(async () => {
      const jobs = await (window as any).api?.jobsLoad?.();
      return Array.isArray(jobs) ? jobs[0] : null;
    });
    expect(first).toBeTruthy();
    const assistAt1 = first?.run?.instagram?.assistAt;
    expect(assistAt1).toBeFalsy();

    const count = await window.evaluate(async () => {
      const res = await (window as any).api?.assistOverlayGetCount?.();
      return res?.count ?? 0;
    });
    expect(count).toBe(1);

    const result = await window.evaluate(async () => {
      return await (window as any).api?.assistOverlayNext?.();
    });
    expect(result?.ok).toBeTruthy();

    const after = await window.evaluate(async () => {
      const jobs = await (window as any).api?.jobsLoad?.();
      return Array.isArray(jobs) ? jobs[0] : null;
    });
    expect(after?.run?.instagram?.done).toBe(true);
    expect(after?.run?.instagram?.mode).toBe('manual_assist');
  } finally {
    // Cleanup: disable autoupload + clear persisted jobs
    await window.evaluate(async () => {
      await (window as any).api?.autouploadSetEnabled?.(false);
    }).catch(() => {});
    await clearJobs(window).catch(() => {});
    await closeApp(app);
  }
});

