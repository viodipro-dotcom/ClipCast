import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './_helpers';
import { addFiles, clearJobs, clearRowPrefs, waitForRows } from './_test-helpers';

test('Publish dialog has only Auto upload + YouTube only + Metadata only', async () => {
  const { app, window } = await launchApp();
  try {
    await clearJobs(window);
    await clearRowPrefs(window);

    await addFiles(window);
    const count = await waitForRows(window, 1);
    expect(count).toBeGreaterThan(0);

    const firstRow = window.locator('.MuiDataGrid-row').first();

    // Select first row via checkbox so Publish operates on it.
    // DataGrid uses a virtualized checkbox; click via CSS selector for stability.
    // Click the first row checkbox cell to select the row (works even if input is not directly clickable).
    await firstRow.locator('.MuiDataGrid-cellCheckbox').click({ force: true });
    await window.waitForTimeout(200);

    // Open Publish dialog (toolbar)
    const publishBtn = window.getByRole('button', { name: /🚀\s*publish/i });
    await expect(publishBtn).toBeVisible({ timeout: 15000 });
    await publishBtn.click();

    const publishDialog = window.locator('[role="dialog"]').filter({ hasText: /publish/i }).first();
    await expect(publishDialog).toBeVisible({ timeout: 5000 });

    // Must have these radios.
    await expect(publishDialog.getByLabel(/YouTube only/i)).toBeVisible();
    await expect(publishDialog.getByLabel(/Metadata only/i)).toBeVisible();

    // Must NOT have "All platforms" or "Custom" or any IG/TT reminder options.
    await expect(publishDialog.getByText(/All platforms/i)).toHaveCount(0);
    await expect(publishDialog.getByText(/Custom/i)).toHaveCount(0);
    await expect(publishDialog.getByText(/Create assist reminders/i)).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});

