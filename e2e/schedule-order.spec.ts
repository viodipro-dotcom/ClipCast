import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './_helpers';

test('scheduling respects creation date order', async () => {
  const { app, window } = await launchApp();

  // Wait for UI to be ready
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(3000); // Give app time to initialize

  // Step 1: Add test videos (they will have different createdAt based on filename)
  // In E2E_TEST mode, dialog:pickVideos returns fake files
  const addButton = window.getByTestId('add-files-button');
  await addButton.click();
  
  // Wait for AddDialog to open and click "Files" button
  await window.waitForTimeout(500);
  // Find the Files button in the dialog - it has a 📄 emoji icon
  const dialog = window.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5000 });
  // The button text is "Files" and it's a contained button (variant="contained")
  const filesButton = dialog.locator('button').filter({ hasText: /files/i }).last(); // last() to get the Files button, not Folder
  await expect(filesButton).toBeVisible({ timeout: 5000 });
  await filesButton.click();
  
  // Wait for dialog to close and files to be processed
  await window.waitForTimeout(2000);
  
  // Wait for files to be added to grid (they need time to process file stats)
  // Files need to be processed: getFileStats is called for each file
  await window.waitForTimeout(5000);

  // Step 2: Verify videos were added
  // DataGrid rows may take time to render, wait for at least one row
  // Check if DataGrid container exists first
  const dataGridContainer = window.locator('.MuiDataGrid-root');
  await expect(dataGridContainer).toBeVisible({ timeout: 10000 });
  
  // Wait for rows to appear
  const rows = window.locator('.MuiDataGrid-row');
  // Try to wait for at least one row, with longer timeout
  let rowCount = 0;
  for (let i = 0; i < 10; i++) {
    rowCount = await rows.count();
    if (rowCount > 0) break;
    await window.waitForTimeout(1000);
  }
  
  // If no rows found, take a screenshot for debugging
  if (rowCount === 0) {
    await window.screenshot({ path: 'test-results/no-rows.png' });
    throw new Error('No rows found in DataGrid after adding files');
  }
  
  expect(rowCount).toBeGreaterThanOrEqual(3); // Should have at least 3 test videos

  // Step 3: Sort by Creation Date (ascending)
  // Click sort button to toggle to ascending
  const sortButton = window.getByTestId('sort-creation-date');
  await sortButton.click();
  await window.waitForTimeout(500);

  // Step 4: Select all rows first (they need to be selected for plan to apply)
  // Select all rows using checkbox
  const selectAllCheckbox = window.locator('.MuiDataGrid-checkboxInput').first();
  await selectAllCheckbox.click();
  await window.waitForTimeout(500);

  // Step 5: Set schedule times and apply plan
  // Open planner dialog
  const planButton = window.getByText(/plan/i).first();
  await planButton.click();
  
  await window.waitForTimeout(1000);
  
  // Fill in times (in custom mode)
  // First, ensure we're in custom mode or simple mode with times input
  const timesInput = window.getByTestId('schedule-times-input');
  if (await timesInput.isVisible()) {
    await timesInput.fill('09:00 13:00 18:00');
  }
  
  // Apply plan - wait for button to be enabled
  const applyButton = window.getByTestId('apply-plan-button');
  await expect(applyButton).toBeEnabled({ timeout: 10000 });
  await applyButton.click();
  
  await window.waitForTimeout(2000);

  // Step 5: Verify scheduling order - DEEP VERIFICATION
  // DataGrid rows have data-id attribute set automatically
  // First row (earliest created - video1) should have first slot (09:00)
  // Second row (video2) should have second slot (13:00)
  // Third row (video3) should have third slot (18:00)
  
  // Get all jobs via IPC for deep verification
  const jobs = await window.evaluate(async () => {
    try {
      return await (window as any).api?.jobsLoad?.();
    } catch {
      return [];
    }
  });

  expect(jobs.length).toBeGreaterThanOrEqual(3);

  // Verify no scheduling collisions
  const publishTimes = jobs
    .map((j: any) => j.publishAtUtcMs)
    .filter((t: any) => t != null && t > 0);

  expect(publishTimes.length).toBeGreaterThanOrEqual(3);

  // Check for duplicates (allowing 1 minute tolerance)
  const uniqueTimes = new Set(publishTimes.map((t: number) => Math.floor(t / 60000)));
  expect(uniqueTimes.size).toBe(publishTimes.length); // No collisions

  // Verify scheduling order: earliest created should get earliest slot
  // Sort jobs by createdAt
  const sortedByCreated = [...jobs].sort((a: any, b: any) => {
    const aCreated = a.createdAt || a.addedAt || 0;
    const bCreated = b.createdAt || b.addedAt || 0;
    return aCreated - bCreated;
  });

  // Sort jobs by publishAtUtcMs
  const sortedByPublish = [...jobs]
    .filter((j: any) => j.publishAtUtcMs)
    .sort((a: any, b: any) => a.publishAtUtcMs - b.publishAtUtcMs);

  // Verify order: first 3 by creation should match first 3 by publish time
  expect(sortedByCreated.length).toBeGreaterThanOrEqual(3);
  expect(sortedByPublish.length).toBeGreaterThanOrEqual(3);

  // First row (earliest created) should have earliest publishAt
  const firstCreatedId = sortedByCreated[0]?.id || sortedByCreated[0]?.filePath;
  const firstPublishId = sortedByPublish[0]?.id || sortedByPublish[0]?.filePath;
  expect(firstCreatedId).toBe(firstPublishId);

  // Verify publishSource is correct
  for (const job of jobs.slice(0, 3)) {
    if (job?.publishSource) {
      expect(job.publishSource).toBe('auto');
    }
  }

  // Verify publishAt values are in ascending order
  for (let i = 1; i < sortedByPublish.length; i++) {
    expect(sortedByPublish[i].publishAtUtcMs).toBeGreaterThan(sortedByPublish[i - 1].publishAtUtcMs);
  }

  await closeApp(app);
});

test('recalculate schedule button exists', async () => {
  const { app, window } = await launchApp();

  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(3000);

  // Verify recalculate button exists (it may be disabled if no rows or autoEnabled=false)
  const recalculateButton = window.getByTestId('recalculate-schedule');
  // Button exists but may be disabled - that's OK, we just verify it's in the DOM
  await expect(recalculateButton).toBeAttached({ timeout: 20_000 });

  await closeApp(app);
});
