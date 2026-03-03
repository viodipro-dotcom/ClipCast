import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { launchApp, closeApp } from './_helpers';
import { screenshotFocus, focusOutPath } from './screenshotFocus';

// This file is part of the repo but should NOT run in normal `npm run e2e`.
// It only runs when GENERATE_GUIDE=1. Uses E2E_SEED=1 to avoid the OS file picker.
test.skip(process.env.GENERATE_GUIDE !== '1', 'Set GENERATE_GUIDE=1 to generate guide screenshots');

const IMAGES_BASE = path.join(process.cwd(), 'website', 'public', 'docs', 'images');

/** Seed rows for guide screenshots (paths must contain 'e2e-seed' so main process returns ok from getFileStats). */
function getSeedRows(): any[] {
  const now = Date.now();
  return [1, 2, 3].map((i) => {
    const base = {
      id: `e2e-seed-${i}-${now}`,
      filePath: `C:\\e2e-seed\\seed-${i}.mp4`,
      filename: `seed-${i}.mp4`,
      status: 'Ready',
      visibility: 'public',
      publishMode: 'schedule' as const,
      publishSource: 'manual' as const,
      log: '',
      addedAt: now - (4 - i) * 3600000,
      targets: { youtube: true, instagram: true, tiktok: true },
    };
    // First row has metadata so step 05 can show title/description; others have none so step 06 can show Generate button
    if (i === 1) {
      return {
        ...base,
        meta: {
          byPlatform: {
            youtube: { title: 'Seed video 1 title', description: 'Seed description for screenshots.', source: 'metadata' as const },
          },
        },
      };
    }
    return base;
  });
}

async function seedLibraryAndReload(window: any): Promise<void> {
  const seedRows = getSeedRows();
  await window.evaluate(
    async (rows: any[]) => {
      const api = (window as any).api;
      if (!api?.librarySave || !api?.jobsSave) throw new Error('API not ready');
      await api.librarySave({ version: 1, updatedAt: Date.now(), rows });
      await api.jobsSave([]);
    },
    seedRows
  );
  await window.reload();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForLoadState('networkidle').catch(() => {});
  await window.waitForTimeout(3000);
}

/** Wait until the jobs table has at least minRows (deterministic for screenshots). */
async function waitForGridRows(window: any, minRows = 1, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await window.locator('.MuiDataGrid-row').count();
    if (count >= minRows) return;
    await window.waitForTimeout(500);
  }
  throw new Error(`Grid did not have >= ${minRows} row(s) within ${timeoutMs}ms`);
}

function sectionDir(section: string): string {
  return path.join(IMAGES_BASE, section);
}

/** Copy a generated image to another section/filename so each guide step has a real image. */
function copyScreenshot(fromSection: string, fromFile: string, toSection: string, toFile: string): void {
  const src = path.join(sectionDir(fromSection), fromFile);
  const destDir = sectionDir(toSection);
  if (fs.existsSync(src)) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, path.join(destDir, toFile));
  }
}

async function settle(window: any, ms = 1200) {
  await window.waitForTimeout(ms);
}

test('generate guide screenshots', async () => {
  test.setTimeout(180_000); // 3 min: launch app, seed, many screenshots
  const { app, window } = await launchApp();
  try {
    fs.mkdirSync(IMAGES_BASE, { recursive: true });
    await window.setViewportSize({ width: 1920, height: 1080 });

    await window.evaluate(() => {
      try {
        localStorage.setItem('theme', 'dark');
        localStorage.setItem('uiScale', '120');
        localStorage.setItem('lang', 'en');
        localStorage.setItem(
          'creatorUploader.interfaceSettings.v1',
          JSON.stringify({
            commandBarPosition: 'top',
            panelsLayout: 'default',
            detailsPanelWidth: 462,
          })
        );
      } catch {
        // ignore
      }
    });
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await settle(window, 2000);

    await seedLibraryAndReload(window);
    await expect(window.getByTestId('add-files-button')).toBeVisible({ timeout: 20_000 });
    await waitForGridRows(window, 3);
    await expect(window.locator('.MuiDataGrid-row').first()).toBeVisible({ timeout: 5000 });
    await settle(window);

    // --- guide/01-home.jpg (main window: toolbar + jobs table, for docs/guide compatibility) ---
    const mainGrid = window.locator('.MuiDataGrid-root').first();
    await screenshotFocus(window, {
      outPath: focusOutPath('guide', '01-home.jpg'),
      focusLocator: mainGrid,
      padding: 80,
      shape: 'rect',
    });

    // --- getting-started/01-home.jpg (main window, crop + highlight top toolbar) ---
    await screenshotFocus(window, {
      outPath: focusOutPath('getting-started', '01-home.jpg'),
      focusLocator: window.getByTestId('add-files-button'),
      padding: 120,
      shape: 'rect',
    });
    copyScreenshot('getting-started', '01-home.jpg', 'getting-started', '02-install.jpg');
    copyScreenshot('getting-started', '01-home.jpg', 'getting-started', '03-launch.jpg');
    copyScreenshot('getting-started', '01-home.jpg', 'getting-started', '04-main-window.jpg');
    await screenshotFocus(window, {
      outPath: focusOutPath('getting-started', '05-top-toolbar.jpg'),
      focusLocator: window.getByTestId('add-files-button'),
      padding: 24,
      shape: 'rect',
    });

    // --- ui-overview/01-main-layout.jpg (crop + highlight main layout area) ---
    await screenshotFocus(window, {
      outPath: focusOutPath('ui-overview', '01-main-layout.jpg'),
      focusLocator: window.locator('.MuiDataGrid-root').first(),
      padding: 60,
      shape: 'rect',
    });
    await screenshotFocus(window, {
      outPath: focusOutPath('ui-overview', '02-toolbar-nav.jpg'),
      focusLocator: window.getByTestId('add-files-button'),
      padding: 80,
      shape: 'rect',
    });
    await screenshotFocus(window, {
      outPath: focusOutPath('ui-overview', '03-jobs-table.jpg'),
      focusLocator: mainGrid,
      padding: 24,
      shape: 'rect',
    });

    // --- add-files-jobs/01-add-files-button.jpg (crop to top toolbar, highlight ADD button) ---
    await screenshotFocus(window, {
      outPath: focusOutPath('add-files-jobs', '01-add-files-button.jpg'),
      focusLocator: window.getByTestId('add-files-button'),
      padding: 24,
      shape: 'rect',
    });

    // --- add-files-jobs/02-choose-mp4-files.jpg (crop to Add Videos dialog, highlight Files button; no OS picker) ---
    await window.getByTestId('add-files-button').click();
    const addDialog = window.getByRole('dialog', { name: /add videos/i });
    await expect(addDialog).toBeVisible({ timeout: 5000 });
    await settle(window, 600);
    const filesButton = addDialog.getByRole('button', { name: /files/i });
    await expect(filesButton).toBeVisible({ timeout: 3000 });
    await screenshotFocus(window, {
      outPath: focusOutPath('add-files-jobs', '02-choose-mp4-files.jpg'),
      focusLocator: filesButton,
      padding: 24,
      shape: 'rect',
    });
    await screenshotFocus(window, {
      outPath: focusOutPath('guide', '04-add-dialog.jpg'),
      focusLocator: addDialog,
      padding: 24,
      shape: 'rect',
    });
    await window.keyboard.press('Escape');
    await settle(window, 600);

    // --- add-files-jobs/03-jobs-grid.jpg (jobs table, populated from seed; crop + highlight) ---
    await expect(window.locator('.MuiDataGrid-root')).toBeVisible({ timeout: 10_000 });
    await expect(window.locator('.MuiDataGrid-row').first()).toBeVisible({ timeout: 10_000 });
    await settle(window);
    const gridRoot = window.locator('.MuiDataGrid-root').first();
    await screenshotFocus(window, {
      outPath: focusOutPath('add-files-jobs', '03-jobs-grid.jpg'),
      focusLocator: gridRoot,
      padding: 24,
      shape: 'rect',
    });
    await screenshotFocus(window, {
      outPath: focusOutPath('guide', '05-after-import.jpg'),
      focusLocator: gridRoot,
      padding: 24,
      shape: 'rect',
    });

    // --- add-files-jobs/04-select-row-details.jpg (first row selected, details panel visible) ---
    const firstRow = window.locator('.MuiDataGrid-row').first();
    await firstRow.scrollIntoViewIfNeeded();
    await settle(window, 400);
    await firstRow.click({ position: { x: 250, y: 18 }, force: true });
    await window.waitForTimeout(2000);
    const detailsPanel = window.getByTestId('details-panel');
    await expect(detailsPanel).toBeVisible({ timeout: 12_000 });
    await settle(window, 500);
    await screenshotFocus(window, {
      outPath: focusOutPath('add-files-jobs', '04-select-row-details.jpg'),
      focusLocator: detailsPanel,
      padding: 24,
      shape: 'rect',
    });
    copyScreenshot('add-files-jobs', '04-select-row-details.jpg', 'ui-overview', '04-details-panel.jpg');
    await screenshotFocus(window, {
      outPath: focusOutPath('ui-overview', '05-toolbar-actions.jpg'),
      focusLocator: window.getByTestId('add-files-button'),
      padding: 80,
      shape: 'rect',
    });

    // --- guide/06-targets-cell.jpg (YT/IG/TT chips in grid row) ---
    const rowForTargets = window.locator('.MuiDataGrid-row').first();
    const targetsCell = rowForTargets.locator('.MuiDataGrid-cell[data-field="youtube"], [data-field="youtube"]').first();
    await expect(targetsCell).toBeVisible({ timeout: 5000 });
    await screenshotFocus(window, {
      outPath: focusOutPath('guide', '06-targets-cell.jpg'),
      focusLocator: targetsCell,
      padding: 40,
      shape: 'rect',
    });

    // --- exports/01-details-platforms.jpg (Details panel with platform columns for exports) ---
    await screenshotFocus(window, {
      outPath: focusOutPath('exports', '01-details-platforms.jpg'),
      focusLocator: detailsPanel,
      padding: 24,
      shape: 'rect',
    });
    copyScreenshot('exports', '01-details-platforms.jpg', 'exports', '02-targets-details.jpg');
    copyScreenshot('exports', '01-details-platforms.jpg', 'exports', '03-open-exports.jpg');

    // --- add-files-jobs/05-edit-title-description.jpg (details panel: title/description fields) ---
    await detailsPanel.scrollIntoViewIfNeeded();
    await settle(window, 300);
    const titleField = window.getByTestId('details-panel-title-field');
    await expect(titleField).toBeVisible({ timeout: 3000 });
    await screenshotFocus(window, {
      outPath: focusOutPath('add-files-jobs', '05-edit-title-description.jpg'),
      focusLocator: titleField,
      padding: 80,
      shape: 'rect',
    });

    // --- add-files-jobs/06-run-pipeline.jpg (pipeline entry: Generate Metadata button) ---
    const secondRow = window.locator('.MuiDataGrid-row').nth(1);
    await secondRow.scrollIntoViewIfNeeded();
    await settle(window, 300);
    await secondRow.click({ position: { x: 250, y: 18 }, force: true });
    await window.waitForTimeout(1500);
    const generateMetaBtn = window.getByTestId('generate-metadata-button');
    await expect(generateMetaBtn).toBeVisible({ timeout: 5000 });
    await screenshotFocus(window, {
      outPath: focusOutPath('add-files-jobs', '06-run-pipeline.jpg'),
      focusLocator: generateMetaBtn,
      padding: 24,
      shape: 'rect',
    });

    // --- pipeline/01-pipeline-log.jpg (row selected; open Pipeline log accordion, crop + highlight) ---
    try {
      const pipelineAccordion = window.getByTestId('pipeline-log-accordion');
      await expect(pipelineAccordion).toBeVisible({ timeout: 8000 });
      await pipelineAccordion.scrollIntoViewIfNeeded();
      const expandBtn = window.getByTestId('pipeline-log-expand');
      await expandBtn.click();
      await settle(window, 600);
      await screenshotFocus(window, {
        outPath: focusOutPath('pipeline', '01-pipeline-log.jpg'),
        focusLocator: pipelineAccordion,
        padding: 24,
        shape: 'rect',
      });
    } catch {
      await settle(window, 500);
      await window.screenshot({
        path: path.join(sectionDir('pipeline'), '01-pipeline-log.jpg'),
        type: 'jpeg',
        quality: 95,
      });
    }
    copyScreenshot('add-files-jobs', '06-run-pipeline.jpg', 'pipeline', '02-generate-button.jpg');
    copyScreenshot('pipeline', '01-pipeline-log.jpg', 'pipeline', '03-watch-log.jpg');
    copyScreenshot('pipeline', '01-pipeline-log.jpg', 'pipeline', '04-find-outputs.jpg');
    copyScreenshot('pipeline', '01-pipeline-log.jpg', 'pipeline', '05-use-logs.jpg');

    // --- troubleshooting/01-pipeline-log.jpg (copy from pipeline for troubleshooting page) ---
    const pipelinePath = path.join(sectionDir('pipeline'), '01-pipeline-log.jpg');
    const troubleshootingPath = path.join(sectionDir('troubleshooting'), '01-pipeline-log.jpg');
    if (fs.existsSync(pipelinePath)) {
      fs.mkdirSync(sectionDir('troubleshooting'), { recursive: true });
      fs.copyFileSync(pipelinePath, troubleshootingPath);
    }
    copyScreenshot('add-files-jobs', '03-jobs-grid.jpg', 'troubleshooting', '03-file-not-found.jpg');

    // --- youtube-connect-upload/01-youtube-status.jpg (Details panel shows YouTube connection status) ---
    await window.locator('.MuiDataGrid-row').first().click({ position: { x: 250, y: 18 }, force: true });
    await window.waitForTimeout(1500);
    await screenshotFocus(window, {
      outPath: focusOutPath('youtube-connect-upload', '01-youtube-status.jpg'),
      focusLocator: window.getByTestId('details-panel'),
      padding: 24,
      shape: 'rect',
    });
    copyScreenshot('youtube-connect-upload', '01-youtube-status.jpg', 'youtube-connect-upload', '02-connect-youtube.jpg');
    copyScreenshot('youtube-connect-upload', '01-youtube-status.jpg', 'youtube-connect-upload', '03-oauth-setup.jpg');
    copyScreenshot('youtube-connect-upload', '01-youtube-status.jpg', 'youtube-connect-upload', '04-upload.jpg');

    // --- settings/01-settings-button.jpg (top toolbar: Settings button) ---
    await window.keyboard.press('Escape').catch(() => {});
    await settle(window, 400);
    const settingsBtn = window.getByTestId('settings-button');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await screenshotFocus(window, {
      outPath: focusOutPath('settings', '01-settings-button.jpg'),
      focusLocator: settingsBtn,
      padding: 24,
      shape: 'rect',
    });
    copyScreenshot('settings', '01-settings-button.jpg', 'settings', '02-interface.jpg');
    copyScreenshot('settings', '01-settings-button.jpg', 'settings', '03-account.jpg');
    copyScreenshot('settings', '01-settings-button.jpg', 'settings', '05-output-paths.jpg');

    // --- guide/02-more-menu.jpg (Settings menu = More options: Interface, Account, Custom AI, etc.) ---
    await settingsBtn.click();
    const settingsMenu = window.getByRole('menu');
    await expect(settingsMenu).toBeVisible({ timeout: 3000 });
    await settle(window, 400);
    await screenshotFocus(window, {
      outPath: focusOutPath('guide', '02-more-menu.jpg'),
      focusLocator: settingsMenu,
      padding: 24,
      shape: 'rect',
    });
    copyScreenshot('guide', '02-more-menu.jpg', 'ui-overview', '06-more-menu.jpg');

    // --- presets/01-presets-screen.jpg (Custom AI presets: crop + highlight dialog) ---
    await window.getByRole('menuitem', { name: /custom ai/i }).click();
    await settle(window, 500);
    const customAIDialog = window.getByTestId('custom-ai-dialog');
    await expect(customAIDialog).toBeVisible({ timeout: 5000 });
    await settle(window, 800);
    await screenshotFocus(window, {
      outPath: focusOutPath('presets', '01-presets-screen.jpg'),
      focusLocator: customAIDialog,
      padding: 24,
      shape: 'rect',
    });
    copyScreenshot('presets', '01-presets-screen.jpg', 'presets', '02-preset-editor.jpg');
    copyScreenshot('presets', '01-presets-screen.jpg', 'presets', '03-preset-select.jpg');
    copyScreenshot('presets', '01-presets-screen.jpg', 'settings', '04-custom-ai.jpg');
    await customAIDialog.getByRole('button', { name: /cancel/i }).click().catch(async () => {
      await window.keyboard.press('Escape');
    });
    await settle(window, 600);

    // --- scheduler/01-scheduler-list.jpg (per-row schedule dialog = scheduler list for that job; capture even if empty) ---
    await window.keyboard.press('Escape').catch(() => {});
    await settle(window, 400);
    const firstRowAgain = window.locator('.MuiDataGrid-row').first();
    const ytBtn = firstRowAgain.locator('[data-field="youtube"] button').first();
    await expect(ytBtn).toBeVisible({ timeout: 10_000 });
    await ytBtn.click({ timeout: 10_000 });
    const scheduleDialog = window.locator('[role="dialog"]').filter({ hasText: /schedule for/i }).first();
    await expect(scheduleDialog).toBeVisible({ timeout: 10_000 });
    await settle(window);
    await screenshotFocus(window, {
      outPath: focusOutPath('scheduler', '01-scheduler-list.jpg'),
      focusLocator: scheduleDialog,
      padding: 24,
      shape: 'rect',
    });
    await screenshotFocus(window, {
      outPath: focusOutPath('guide', '07-schedule-dialog.jpg'),
      focusLocator: scheduleDialog,
      padding: 24,
      shape: 'rect',
    });
    copyScreenshot('scheduler', '01-scheduler-list.jpg', 'scheduler', '02-set-publish-time.jpg');
    copyScreenshot('scheduler', '01-scheduler-list.jpg', 'scheduler', '03-auto-plan.jpg');
    await scheduleDialog.getByRole('button', { name: /cancel/i }).click();
    await settle(window, 600);

    // --- guide/03-advanced.jpg (Publish dialog: Auto Upload, Silent Mode) ---
    const publishBtn = window.getByRole('button', { name: /publish/i });
    await expect(publishBtn).toBeVisible({ timeout: 5000 });
    await publishBtn.click();
    const publishDialog = window.locator('[role="dialog"]').filter({ hasText: /publish selected/i }).first();
    await expect(publishDialog).toBeVisible({ timeout: 5000 });
    await settle(window, 500);
    await screenshotFocus(window, {
      outPath: focusOutPath('guide', '03-advanced.jpg'),
      focusLocator: publishDialog,
      padding: 24,
      shape: 'rect',
    });
    await publishDialog.getByRole('button', { name: /cancel/i }).click();
    await settle(window, 600);

    // --- guide/08-plan-dialog.jpg (Plan dialog: Auto Plan, bulk schedule) ---
    const planBtn = window.getByRole('button', { name: /plan/i });
    await expect(planBtn).toBeVisible({ timeout: 5000 });
    await planBtn.click();
    const planDialog = window.locator('[role="dialog"]').filter({ hasText: /plan/i }).first();
    await expect(planDialog).toBeVisible({ timeout: 5000 });
    await settle(window, 500);
    await screenshotFocus(window, {
      outPath: focusOutPath('guide', '08-plan-dialog.jpg'),
      focusLocator: planDialog,
      padding: 24,
      shape: 'rect',
    });
    copyScreenshot('guide', '08-plan-dialog.jpg', 'scheduler', '04-plan-dialog.jpg');
    copyScreenshot('scheduler', '01-scheduler-list.jpg', 'scheduler', '05-recalculate.jpg');
    await planDialog.getByRole('button', { name: /cancel/i }).click();
    await settle(window, 600);

    // --- manual-assist/01-next-assist-overlay.jpg (Manual Assist Center, crop + highlight) ---
    await window.evaluate(() => {
      window.location.hash = '#/assist-center';
    });
    await window.waitForLoadState('domcontentloaded');
    await settle(window, 1500);
    await expect(window.getByText(/manual assist center/i)).toBeVisible({ timeout: 5000 });
    await screenshotFocus(window, {
      outPath: focusOutPath('manual-assist', '01-next-assist-overlay.jpg'),
      focusLocator: window.getByText(/manual assist center/i),
      padding: 80,
      shape: 'rect',
    });
    copyScreenshot('scheduler', '01-scheduler-list.jpg', 'manual-assist', '02-schedule-dialog.jpg');
    copyScreenshot('manual-assist', '01-next-assist-overlay.jpg', 'manual-assist', '03-at-scheduled-time.jpg');
    copyScreenshot('manual-assist', '01-next-assist-overlay.jpg', 'manual-assist', '04-assist-next.jpg');
    copyScreenshot('manual-assist', '01-next-assist-overlay.jpg', 'manual-assist', '05-paste-publish.jpg');
    copyScreenshot('manual-assist', '01-next-assist-overlay.jpg', 'manual-assist', '06-mark-posted.jpg');
    copyScreenshot('youtube-connect-upload', '01-youtube-status.jpg', 'troubleshooting', '02-youtube-connect.jpg');
    copyScreenshot('youtube-connect-upload', '01-youtube-status.jpg', 'troubleshooting', '04-upload-failed.jpg');
    copyScreenshot('getting-started', '01-home.jpg', 'troubleshooting', '05-app-wont-start.jpg');
  } finally {
    await closeApp(app);
  }
});
