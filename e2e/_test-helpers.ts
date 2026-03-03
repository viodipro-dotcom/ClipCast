import { Page, expect } from '@playwright/test';

export async function clearJobs(window: Page) {
  await window.evaluate(async () => {
    try {
      await (window as any).api?.jobsSave?.([]);
    } catch {
      // ignore
    }
  });
  await window.waitForTimeout(300);
}

export async function clearRowPrefs(window: Page) {
  await window.evaluate(async () => {
    try {
      await (window as any).api?.rowPrefsSave?.({});
    } catch {
      // ignore
    }
  });
  await window.waitForTimeout(200);
}

// Helper to add files via dialog
export async function addFiles(window: Page) {
  const addButton = window.getByTestId('add-files-button');
  await expect(addButton).toBeVisible({ timeout: 15000 });
  await addButton.click();
  await window.waitForTimeout(500);
  const dialog = window.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5000 });
  const filesButton = dialog.locator('button').filter({ hasText: /files/i }).last();
  await filesButton.click();
  await window.waitForTimeout(2000);
}

// Helper to wait for rows to appear
export async function waitForRows(window: Page, minCount: number = 1) {
  const rows = window.locator('.MuiDataGrid-row');
  let rowCount = 0;
  for (let i = 0; i < 15; i++) {
    rowCount = await rows.count();
    if (rowCount >= minCount) break;
    await window.waitForTimeout(1000);
  }
  return rowCount;
}

// Helper to get row data from DataGrid
export async function getRowData(window: Page, rowIndex: number = 0) {
  return await window.evaluate((index) => {
    // Access React component state or DataGrid API
    // Try to get data from the grid
    const gridElement = document.querySelector('.MuiDataGrid-root');
    if (!gridElement) return null;

    // Get row element
    const rows = document.querySelectorAll('.MuiDataGrid-row');
    if (rows.length <= index) return null;

    const rowElement = rows[index];
    const rowId = rowElement.getAttribute('data-id');
    
    // Try to access React state via window (if exposed)
    // Or get data from rendered cells
    const cells = rowElement.querySelectorAll('.MuiDataGrid-cell');
    const data: any = { id: rowId };
    
    // Extract data from cells (filename, status, etc.)
    cells.forEach((cell, i) => {
      const field = cell.getAttribute('data-field');
      if (field) {
        const text = cell.textContent?.trim() || '';
        data[field] = text;
      }
    });

    return data;
  }, rowIndex);
}

// Helper to get all rows data
export async function getAllRowsData(window: Page) {
  const rowCount = await waitForRows(window, 1);
  const allData: Array<Record<string, any>> = [];
  for (let i = 0; i < rowCount; i++) {
    const data = await getRowData(window, i);
    if (data) allData.push(data);
  }
  return allData;
}

// Helper to get row data via IPC (more reliable)
export async function getRowDataViaIPC(window: Page, rowIndex: number = 0) {
  return await window.evaluate(async (index) => {
    try {
      // Get jobs from IPC
      const jobs = await (window as any).api?.jobsLoad?.();
      if (!Array.isArray(jobs) || jobs.length <= index) return null;
      return jobs[index];
    } catch {
      return null;
    }
  }, rowIndex);
}

// Helper to verify publishAt values are unique (no collisions)
export async function verifyNoSchedulingCollisions(window: Page) {
  const jobs = await window.evaluate(async () => {
    try {
      return await (window as any).api?.jobsLoad?.();
    } catch {
      return [];
    }
  });

  if (!Array.isArray(jobs) || jobs.length < 2) return true;

  const publishTimes = jobs
    .map((j: any) => j.publishAtUtcMs)
    .filter((t: any) => t != null && t > 0);

  // Check for duplicates (allowing 1 minute tolerance for same slot)
  const uniqueTimes = new Set(publishTimes.map((t: number) => Math.floor(t / 60000)));
  return uniqueTimes.size === publishTimes.length;
}

// Helper to verify scheduling order (earliest created gets earliest slot)
export async function verifySchedulingOrder(window: Page, times: string[]) {
  const jobs = await window.evaluate(async () => {
    try {
      return await (window as any).api?.jobsLoad?.();
    } catch {
      return [];
    }
  });

  if (!Array.isArray(jobs) || jobs.length < 2) return false;

  // Sort by createdAt
  const sortedByCreated = [...jobs].sort((a: any, b: any) => {
    const aCreated = a.createdAt || a.addedAt || 0;
    const bCreated = b.createdAt || b.addedAt || 0;
    return aCreated - bCreated;
  });

  // Sort by publishAtUtcMs
  const sortedByPublish = [...jobs].filter((j: any) => j.publishAtUtcMs).sort((a: any, b: any) => {
    return a.publishAtUtcMs - b.publishAtUtcMs;
  });

  // Verify order matches
  const sortedCreatedIds = sortedByCreated.map((j: any) => j.id || j.filePath);
  const sortedPublishIds = sortedByPublish.map((j: any) => j.id || j.filePath);

  // First N jobs by creation should match first N jobs by publish time
  const minLength = Math.min(sortedCreatedIds.length, sortedPublishIds.length, times.length);
  for (let i = 0; i < minLength; i++) {
    if (sortedCreatedIds[i] !== sortedPublishIds[i]) {
      return false;
    }
  }

  return true;
}

// Helper to get settings
export async function getSettings(window: Page) {
  return await window.evaluate(async () => {
    try {
      return {
        // These settings are renderer state; don't attempt to read via IPC here.
        autoEnabled: null,
        autoUploadEnabled: null,
      };
    } catch {
      return { autoEnabled: null, autoUploadEnabled: null };
    }
  });
}

// Helper to set settings
export async function setSettings(window: Page, settings: { autoEnabled?: boolean; autoUploadEnabled?: boolean }) {
  const setSwitch = async (testId: string, value: boolean) => {
    const root = window.getByTestId(testId);
    await expect(root).toBeVisible({ timeout: 5000 });
    const input = root.locator('input');
    await expect(input).toHaveCount(1, { timeout: 5000 });
    const checked = await input.isChecked();
    if (checked !== value) {
      await root.click();
      await window.waitForTimeout(200);
    }
  };

  if (settings.autoEnabled !== undefined) {
    // Auto Plan is now controlled from the Plan dialog (toolbar).
    const planBtn = window.getByRole('button', { name: /📅\s*plan/i });
    await expect(planBtn).toBeVisible({ timeout: 15000 });
    await planBtn.click();

    const dialog = window.locator('[role="dialog"]').filter({ hasText: /plan/i }).first();
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await setSwitch('auto-plan-switch', settings.autoEnabled);

    await window.keyboard.press('Escape').catch(() => {});
    await window.waitForTimeout(300);
  }

  if (settings.autoUploadEnabled !== undefined) {
    // Auto Upload is now controlled from the Publish dialog (toolbar).
    const publishBtn = window.getByRole('button', { name: /🚀\s*publish/i });
    await expect(publishBtn).toBeVisible({ timeout: 15000 });
    await publishBtn.click();

    const dialog = window.locator('[role="dialog"]').filter({ hasText: /publish/i }).first();
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await setSwitch('auto-upload-switch', settings.autoUploadEnabled);

    await window.keyboard.press('Escape').catch(() => {});
    await window.waitForTimeout(300);
  }
}

// Helper to verify targets
export async function verifyTargets(window: Page, rowIndex: number, expected: { youtube: boolean; instagram: boolean; tiktok: boolean }) {
  const job = await getRowDataViaIPC(window, rowIndex);
  if (!job) return false;
  
  const targets = job.targets || { youtube: false, instagram: false, tiktok: false };
  return (
    targets.youtube === expected.youtube &&
    targets.instagram === expected.instagram &&
    targets.tiktok === expected.tiktok
  );
}

// Helper to verify publishSource
export async function verifyPublishSource(window: Page, rowIndex: number, expected: 'auto' | 'manual') {
  const job = await getRowDataViaIPC(window, rowIndex);
  if (!job) return false;
  return job.publishSource === expected;
}

// Helper to verify publishAt is set
export async function verifyPublishAtSet(window: Page, rowIndex: number) {
  const job = await getRowDataViaIPC(window, rowIndex);
  if (!job) return false;
  return job.publishAtUtcMs != null && job.publishAtUtcMs > 0;
}
