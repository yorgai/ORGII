export interface MilestoneEntry {
  id: string;
  name: string;
  description?: string;
  due_date?: string;
  status: string;
}

export interface MilestonesFile {
  milestones: MilestoneEntry[];
}
