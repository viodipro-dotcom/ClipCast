import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './_helpers';

test('app launches and UI is visible', async () => {
  const { app, window } = await launchApp();

  // Wait for React to render - check for stable UI elements
  // The button text is "ADD (FILES OR FOLDER)" from constants
  await expect(window.getByTestId('add-files-button')).toBeVisible({ timeout: 20_000 });

  await closeApp(app);
});

test('Auto Plan is disabled by default on launch', async () => {
  const { app, window } = await launchApp();

  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  // Auto Plan is now controlled from the Plan dialog (toolbar).
  await window.getByRole('button', { name: /📅\s*plan/i }).click();
  const dialog = window.locator('[role="dialog"]').filter({ hasText: /plan/i }).first();
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // Auto Plan should start OFF when the app launches (default changed).
  const autoPlanSwitch = window.getByTestId('auto-plan-switch').locator('input');
  await expect(autoPlanSwitch).toHaveCount(1);
  await expect(autoPlanSwitch).not.toBeChecked();

  // Close
  await window.keyboard.press('Escape').catch(() => {});
  await closeApp(app);
});

test('IPC handlers are available', async () => {
  const { app, window } = await launchApp();

  // Wait for app to be ready
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);

  // Check that window.api exists (via preload)
  const apiExists = await window.evaluate(() => {
    return typeof (window as any).api !== 'undefined';
  });

  expect(apiExists).toBe(true);

  await closeApp(app);
});
