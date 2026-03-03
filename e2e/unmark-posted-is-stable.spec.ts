import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './_helpers';
import { addFiles, clearJobs, clearRowPrefs, waitForRows } from './_test-helpers';

test('Unmark Posted is stable even with rapid clicks', async () => {
  const { app, window } = await launchApp();
  try {
    await clearJobs(window);
    await clearRowPrefs(window);

    await addFiles(window);
    const count = await waitForRows(window, 1);
    expect(count).toBeGreaterThan(0);

    const firstRow = window.locator('.MuiDataGrid-row').first();
    const igCellButton = firstRow.locator('[data-field="instagram"] button').first();

    await expect(igCellButton).toBeVisible({ timeout: 15000 });

    // Mark as posted via context menu (works without metadata).
    await igCellButton.click({ button: 'right' });
    const markPosted = window.getByRole('menuitem', { name: /mark as posted/i });
    await expect(markPosted).toBeVisible({ timeout: 5000 });
    await markPosted.click();

    await expect(igCellButton).toHaveText(/Posted/i, { timeout: 15000 });

    // Rapid clicks (double/triple) should not cause "revert" back to Posted.
    await igCellButton.click({ force: true });
    await igCellButton.click({ force: true });
    await igCellButton.click({ force: true });

    // Allow async jobsSave/loadJobs to settle.
    await window.waitForTimeout(800);

    await expect(igCellButton).not.toHaveText(/Posted/i);
  } finally {
    await closeApp(app);
  }
});

