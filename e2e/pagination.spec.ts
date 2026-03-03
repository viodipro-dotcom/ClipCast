import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './_helpers';
import { addFiles, waitForRows } from './_test-helpers';

test('Pagination: Can navigate to page 1 when rows per page is set', async () => {
  test.setTimeout(120000); // 2 minutes timeout
  
  const { app, window } = await launchApp();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(3000);

  // In E2E_TEST mode, addFiles() now returns 30 fake files (video1.mp4 to video30.mp4)
  // This is enough to trigger pagination with 25 rows per page
  console.log('Adding files...');
  
  // Verify that dialog:openFiles returns 30 files in E2E_TEST mode
  const filesReturned = await window.evaluate(async () => {
    try {
      const files = await (window as any).api?.openFiles?.();
      return Array.isArray(files) ? files.length : 0;
    } catch {
      return 0;
    }
  });
  console.log(`Files returned by dialog:openFiles: ${filesReturned}`);
  expect(filesReturned).toBe(30);
  
  await addFiles(window);
  
  // IMPORTANT:
  // MUI DataGrid virtualizes rows, so DOM row count is NOT the total row count.
  // Wait until the pagination label reports 30 total rows ("… of 30").
  const displayedRows = window.locator('.MuiTablePagination-displayedRows');
  await expect(displayedRows).toBeVisible({ timeout: 10000 });

  let total = 0;
  for (let i = 0; i < 30; i++) {
    await window.waitForTimeout(500);
    const text = (await displayedRows.textContent()) || '';
    const m = text.match(/of\s+(\d+)/i);
    total = m ? Number(m[1]) : 0;
    console.log(`Pagination label: "${text}" (total=${total})`);
    if (total >= 30) break;
  }
  expect(total).toBe(30);
  
  // Wait for DataGrid to be ready
  const dataGridContainer = window.locator('.MuiDataGrid-root');
  await expect(dataGridContainer).toBeVisible({ timeout: 10000 });
  
  // Verify rows per page (should be 25 by default)
  const rowsPerPage = await window.evaluate(() => {
    const select = document.querySelector('.MuiTablePagination-select') as HTMLSelectElement;
    if (select) {
      return parseInt(select.value || '25', 10);
    }
    return null;
  });
  
  console.log('Rows per page:', rowsPerPage);
  expect(rowsPerPage).toBe(25);
  
  // Note: totalRows is already declared above in the loop, so we don't redeclare it here
  // The loop above should have populated totalRows with the final count

  // Helper function to get current page from DataGrid
  const getCurrentPage = async () => {
    return await window.evaluate(() => {
      // Try to find pagination info in the footer
      const pagination = document.querySelector('.MuiTablePagination-root');
      if (!pagination) return null;
      
      // Get page number from pagination
      const pageInput = pagination.querySelector('input[type="number"]') as HTMLInputElement;
      if (pageInput) {
        return parseInt(pageInput.value || '0', 10);
      }
      
      // Alternative: try to get from MUI DataGrid API if accessible
      const gridElement = document.querySelector('.MuiDataGrid-root');
      if (gridElement) {
        // Check if we can access React state
        const reactKey = Object.keys(gridElement).find(key => key.startsWith('__react'));
        if (reactKey) {
          const reactInstance = (gridElement as any)[reactKey];
          // Try to find pagination state
          if (reactInstance?.memoizedProps?.paginationModel) {
            return reactInstance.memoizedProps.paginationModel.page;
          }
        }
      }
      
      return null;
    });
  };

  // Helper function to click next page button
  const clickNextPage = async () => {
    const nextButton = window.locator('.MuiTablePagination-actions button[aria-label*="next" i], .MuiTablePagination-actions button[aria-label*="Next" i]').last();
    if (await nextButton.isVisible({ timeout: 2000 })) {
      // Check if button is enabled
      const isEnabled = await nextButton.isEnabled();
      if (!isEnabled) {
        console.log('Next page button is disabled');
        return false;
      }
      await nextButton.click();
      await window.waitForTimeout(1000);
      return true;
    }
    return false;
  };

  // Helper function to click previous page button
  const clickPreviousPage = async () => {
    const prevButton = window.locator('.MuiTablePagination-actions button[aria-label*="previous" i], .MuiTablePagination-actions button[aria-label*="Previous" i]').first();
    if (await prevButton.isVisible({ timeout: 2000 })) {
      await prevButton.click();
      await window.waitForTimeout(1000);
      return true;
    }
    return false;
  };

  // Helper function to click page number button (for page 1, it's usually the first page button)
  const clickPageNumber = async (pageNumber: number) => {
    // Try to find and click the page number button
    // MUI DataGrid pagination might show page numbers as buttons
    const pageButtons = window.locator('.MuiTablePagination-root button');
    const count = await pageButtons.count();
    
    // Look for button with text matching page number (0-indexed, so page 1 is index 0)
    // Or try to find input field and set it
    const pageInput = window.locator('.MuiTablePagination-root input[type="number"]');
    if (await pageInput.isVisible({ timeout: 2000 })) {
      await pageInput.fill((pageNumber).toString());
      await pageInput.press('Enter');
      await window.waitForTimeout(1000);
      return true;
    }
    
    return false;
  };

  // Get initial page 1 row IDs for comparison
  const initialVisibleRows = window.locator('.MuiDataGrid-row');
  await expect(initialVisibleRows.first()).toBeVisible({ timeout: 5000 });
  const initialFirstRowId = await initialVisibleRows.first().getAttribute('data-id');
  
  const initialLabel = (await displayedRows.textContent()) || '';
  console.log(`Initial page label: "${initialLabel}", first ID: ${initialFirstRowId}`);
  expect(initialLabel).toMatch(/1\s*[–-]\s*25\s+of\s+30/i);

  // Navigate to page 2 by clicking next
  console.log('Navigating to page 2...');
  const hasNextPage = await clickNextPage();
  
  if (!hasNextPage) {
    console.log('ERROR: Next page button should be available with 30 files and 25 rows per page!');
    throw new Error('Pagination should be available but next button is not enabled');
  }
  
  await window.waitForTimeout(1000);
  
  // Verify we're on page 2 (label should change, and first row id should differ)
  const page2VisibleRows = window.locator('.MuiDataGrid-row');
  await expect(page2VisibleRows.first()).toBeVisible({ timeout: 5000 });
  const page2FirstRowId = await page2VisibleRows.first().getAttribute('data-id');
  
  const page2Label = (await displayedRows.textContent()) || '';
  console.log(`Page 2 label: "${page2Label}", first ID: ${page2FirstRowId}`);
  
  // Verify we're actually on a different page
  expect(page2FirstRowId).not.toBe(initialFirstRowId);
  expect(page2Label).toMatch(/26\s*[–-]\s*30\s+of\s+30/i);

  // Regression guard: ensure we don't auto-jump back to page 1 after a moment.
  await window.waitForTimeout(1200);
  const page2LabelAfter = (await displayedRows.textContent()) || '';
  expect(page2LabelAfter).toMatch(/26\s*[–-]\s*30\s+of\s+30/i);
  
  // Now try to go back to page 1 using previous button
  console.log('Navigating back to page 1 using previous button...');
  const hasPrevPage = await clickPreviousPage();
  expect(hasPrevPage).toBe(true);
  
  await window.waitForTimeout(1000);
  
  // Verify we're back on page 1 (same label + first row)
  const backToPage1Rows = window.locator('.MuiDataGrid-row');
  const backToPage1FirstRowId = await backToPage1Rows.first().getAttribute('data-id');
  const backToPage1Label = (await displayedRows.textContent()) || '';
  console.log(`Back to page 1 label: "${backToPage1Label}", first ID: ${backToPage1FirstRowId}`);
  expect(backToPage1Label).toMatch(/1\s*[–-]\s*25\s+of\s+30/i);
  expect(backToPage1FirstRowId).toBe(initialFirstRowId);
  
  // Now test going to page 2 again and then using page input to go to page 1
  console.log('Navigating to page 2 again...');
  await clickNextPage();
  await window.waitForTimeout(1000);
  
  // Verify we're on page 2 again
  const page2AgainRows = window.locator('.MuiDataGrid-row');
  await expect(page2AgainRows.first()).toBeVisible({ timeout: 5000 });
  const page2AgainFirstRowId = await page2AgainRows.first().getAttribute('data-id');
  expect(page2AgainFirstRowId).toBe(page2FirstRowId);
  
  // Now try to go to page 1 using page input (this is the problematic scenario)
  console.log('Navigating to page 1 using page input (this was the bug)...');
  const wentToPage1 = await clickPageNumber(0); // 0-indexed, so 0 = page 1
  
  if (wentToPage1) {
    await window.waitForTimeout(1000);
    
    // CRITICAL TEST: Verify we're on page 1 (this was failing before the fix)
    const finalPage1Rows = window.locator('.MuiDataGrid-row');
    const finalPage1FirstRowId = await finalPage1Rows.first().getAttribute('data-id');
    const finalLabel = (await displayedRows.textContent()) || '';
    
    console.log(`Final page 1 label (via input): "${finalLabel}", first ID: ${finalPage1FirstRowId}`);
    
    // This is the main assertion - we should be able to navigate to page 1
    expect(finalPage1FirstRowId).toBe(initialFirstRowId);
    expect(finalLabel).toMatch(/1\s*[–-]\s*25\s+of\s+30/i);
  } else {
    console.log('Could not use page input - trying alternative method');
    // Fallback: use previous button again
    await clickPreviousPage();
    await window.waitForTimeout(1000);
    
    const fallbackPage1Rows = window.locator('.MuiDataGrid-row');
    await expect(fallbackPage1Rows.first()).toBeVisible({ timeout: 5000 });
    const fallbackPage1FirstRowId = await fallbackPage1Rows.first().getAttribute('data-id');
    expect(fallbackPage1FirstRowId).toBe(initialFirstRowId);
  }

  await closeApp(app);
});
