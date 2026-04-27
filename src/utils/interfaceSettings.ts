export interface InterfaceSettings {
  commandBarPosition: 'bottom' | 'top';
  panelsLayout: 'default' | 'swapped';
  detailsPanelWidth: number; // Width in pixels for DetailsPanel
}

const STORAGE_KEY = 'creatorUploader.interfaceSettings.v1';

const DEFAULT_SETTINGS: InterfaceSettings = {
  commandBarPosition: 'top',
  panelsLayout: 'default',
  detailsPanelWidth: 462, // Default width matching current value
};

export function loadInterfaceSettings(): InterfaceSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return DEFAULT_SETTINGS;
    }
    // Merge with defaults to ensure all fields exist
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveInterfaceSettings(settings: InterfaceSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save interface settings:', e);
  }
}

export function updateInterfaceSettings(
  partial: Partial<InterfaceSettings>
): InterfaceSettings {
  const current = loadInterfaceSettings();
  const updated = { ...current, ...partial };
  saveInterfaceSettings(updated);
  return updated;
}
