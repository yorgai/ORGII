export type LearningsBrowserVariant = "settingsPage" | "integrationsPanel";

export type LearningsBrowserToolbarRefreshApi = {
  refresh: () => Promise<void>;
  loading: boolean;
};
