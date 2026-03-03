import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './_helpers';

test('Metadata is not shared between different files with same basename', async () => {
  test.setTimeout(60_000);

  const { app, window } = await launchApp();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(3000);

  // Two different file paths with the same basename
  const fileA = path.join(process.cwd(), 'e2e', 'test-videos', 'dup', 'same.mp4');
  const fileB = path.join(process.cwd(), 'e2e', 'test-videos', 'dup2', 'same.mp4');

  // The main process derives stem from basename ("same")
  const stem = 'same';
  const metaDir = path.join(process.cwd(), 'yt_pipeline', 'outputs', 'Metadata');
  const metaPath = path.join(metaDir, `${stem}.json`);

  // Ensure directory exists
  fs.mkdirSync(metaDir, { recursive: true });

  // Write metadata for fileA only. (This matches pipeline output shape used by outputs:readForPath.)
  const payload = {
    source_video: fileA,
    generated_at: new Date().toISOString(),
    platforms: {
      youtube: { title: 't', description: 'd', hashtags: ['#a'] },
      instagram: { title: 't', description: 'd', hashtags: ['#a'] },
      tiktok: { title: 't', description: 'd', hashtags: ['#a'] },
    },
  };
  fs.writeFileSync(metaPath, JSON.stringify(payload, null, 2), 'utf8');

  try {
    const resA = await window.evaluate(async (fp) => {
      return await (window as any).api?.readOutputsForPath?.(fp);
    }, fileA);
    const resB = await window.evaluate(async (fp) => {
      return await (window as any).api?.readOutputsForPath?.(fp);
    }, fileB);

    expect(resA?.ok).toBeTruthy();
    expect(resB?.ok).toBeTruthy();

    // Both should map to the same stem, reproducing the collision case
    expect(resA?.stem).toBe(stem);
    expect(resB?.stem).toBe(stem);

    // Metadata should only be returned for the matching source_video
    expect(resA?.metadata).toBeTruthy();
    expect(resA?.metadata?.source_video).toBe(fileA);

    expect(resB?.metadata).toBeNull();
  } finally {
    try {
      fs.unlinkSync(metaPath);
    } catch {
      // ignore
    }
    await closeApp(app);
  }
});

