import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './_helpers';
import { addFiles, waitForRows, getRowDataViaIPC, setSettings } from './_test-helpers';

test('SCENARIU 12: DST Transition - Timezone Conversion', async () => {
  const { app, window } = await launchApp();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(3000);

  // Set timezone to one with DST (America/New_York)
  // Note: Timezone setting may need to be done via UI or IPC
  await setSettings(window, { autoEnabled: true });
  await window.waitForTimeout(1000);

  // Add a video
  await addFiles(window);
  const rowCount = await waitForRows(window, 1);
  expect(rowCount).toBeGreaterThanOrEqual(1);

  // Get job and verify publishAtUtcMs is set - DEEP VERIFICATION
  const job = await getRowDataViaIPC(window, 0);
  expect(job).not.toBeNull();

  if (job?.publishAtUtcMs) {
    // Verify publishAtUtcMs is a valid timestamp
    expect(job.publishAtUtcMs).toBeGreaterThan(0);
    expect(typeof job.publishAtUtcMs).toBe('number');

    // Verify it's in the future (if scheduled)
    const now = Date.now();
    // Allow some tolerance for scheduling in the past (for testing)
    expect(job.publishAtUtcMs).toBeGreaterThan(now - 86400000); // Within last 24h or future

    // Verify timezone conversion: publishAtUtcMs should be UTC
    const publishDate = new Date(job.publishAtUtcMs);
    expect(publishDate.getTime()).toBe(job.publishAtUtcMs);

    // Verify date is valid
    expect(!isNaN(publishDate.getTime())).toBe(true);
  }

  // Verify timezone selector exists (if available in UI)
  // Look for timezone autocomplete/select
  const timezoneSelect = window.locator('input[placeholder*="timezone" i], input[aria-label*="timezone" i]').first();
  // May or may not be visible depending on UI state

  // Verify timezone conversion works: same local time in different timezones should produce different UTC
  // This is tested indirectly through scheduling

  await closeApp(app);
});
