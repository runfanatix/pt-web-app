export const TABS = [
  { id: 'zone', label: 'Zones' },
  { id: 'session', label: 'Session' },
  { id: 'run', label: 'Run' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'clients', label: 'Clients' },
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'gyms', label: 'Gyms' },
  { id: 'library', label: 'Library' },
  { id: 'data', label: 'Data' },
] as const;

export type TabId = (typeof TABS)[number]['id'];
export type Mode = 'plan' | 'edit';
