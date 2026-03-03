/**
 * Screenshot config for guide documentation.
 * Each set defines: source state, focus element (for crop + highlight), output path.
 * Used by guide-screenshots.spec.ts when GENERATE_GUIDE=1.
 *
 * Crop = viewport area around focus element + padding.
 * Highlight = red rectangle (or circle) around the focus element.
 */
export type ScreenshotDef = {
  section: string;
  filename: string;
  /** Human-readable description of what state the app should be in */
  sourceState: string;
  /** Playwright locator key - actual locator built in spec */
  focusTarget: "add-button" | "add-dialog-files" | "jobs-grid" | "details-panel" | "title-field" | "generate-button" | "pipeline-accordion" | "youtube-details" | "custom-ai-dialog" | "schedule-dialog" | "assist-center-heading" | "main-layout-grid" | "toolbar";
  padding?: number;
  shape?: "rect" | "circle";
};

export const SCREENSHOT_DEFS: ScreenshotDef[] = [
  { section: "getting-started", filename: "01-home.jpg", sourceState: "Main window, jobs table visible", focusTarget: "add-button", padding: 120 },
  { section: "ui-overview", filename: "01-main-layout.jpg", sourceState: "Main window with jobs table", focusTarget: "main-layout-grid", padding: 60 },
  { section: "add-files-jobs", filename: "01-add-files-button.jpg", sourceState: "Main window", focusTarget: "add-button", padding: 24 },
  { section: "add-files-jobs", filename: "02-choose-mp4-files.jpg", sourceState: "Add Videos dialog open", focusTarget: "add-dialog-files", padding: 24 },
  { section: "add-files-jobs", filename: "03-jobs-grid.jpg", sourceState: "Jobs table populated", focusTarget: "jobs-grid", padding: 24 },
  { section: "add-files-jobs", filename: "04-select-row-details.jpg", sourceState: "Row selected, Details panel visible", focusTarget: "details-panel", padding: 24 },
  { section: "add-files-jobs", filename: "05-edit-title-description.jpg", sourceState: "Details panel, title field visible", focusTarget: "title-field", padding: 80 },
  { section: "add-files-jobs", filename: "06-run-pipeline.jpg", sourceState: "Row with no metadata selected", focusTarget: "generate-button", padding: 24 },
  { section: "pipeline", filename: "01-pipeline-log.jpg", sourceState: "Pipeline Log accordion expanded", focusTarget: "pipeline-accordion", padding: 24 },
  { section: "youtube-connect-upload", filename: "01-youtube-status.jpg", sourceState: "Row selected, Details panel", focusTarget: "youtube-details", padding: 24 },
  { section: "presets", filename: "01-presets-screen.jpg", sourceState: "Settings → Custom AI dialog open", focusTarget: "custom-ai-dialog", padding: 24 },
  { section: "scheduler", filename: "01-scheduler-list.jpg", sourceState: "Schedule for [platform] dialog open", focusTarget: "schedule-dialog", padding: 24 },
  { section: "manual-assist", filename: "01-next-assist-overlay.jpg", sourceState: "Manual Assist Center page (#/assist-center)", focusTarget: "assist-center-heading", padding: 80 },
];
