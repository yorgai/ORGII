export interface ChangelogDay {
  date: string;
  commitCount: number;
  summary: string;
  frontendChangeBullets: string[];
  backendChangeBullets: string[];
  modelsUsed: string[];
}

export interface ChangelogMonth {
  year: number;
  month: string;
  range: {
    start: string;
    end: string;
  };
  days: ChangelogDay[];
}
