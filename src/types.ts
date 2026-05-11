export interface Employee {
  id: string;
  name: string;
  nip: string;
  bidang?: string;
  igUsername?: string;
  igUsername2?: string;
  fbName?: string;
  fbName2?: string;
  tiktokName?: string;
  tiktokName2?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface DailyEngagement {
  id: string; // YYYY-MM-DD
  date: string;
  igRawText: string;
  fbRawText: string;
  tiktokRawText: string;
  igEngagedEmployeeIds: string[];
  fbEngagedEmployeeIds: string[];
  tiktokEngagedEmployeeIds: string[];
  igLinks?: string[];
  fbLinks?: string[];
  tiktokLinks?: string[];
  updatedAt: any;
}
