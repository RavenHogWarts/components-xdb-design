import { App, Component } from 'obsidian';

export interface ViewDefinition {
  id: string;
  name: string;
  type: string;
  options?: Record<string, any>;
}

export interface Database {
  updateCell(rowId: string, fieldName: string, value: any): Promise<void>;
  updateRow(id: string, values: Record<string, any>): Promise<void>;
  updateView(view: ViewDefinition): Promise<void>;
}

export interface DatabaseViewProps {
  app: App;
  moment: any;
  PluginComponent: Component;
  obsidian: any;
  container: HTMLElement;
  api: Database;
  viewId: string;
  viewDefinition: ViewDefinition;
  viewData: {
    groups: Array<{
      rows: Array<{
        id: string;
        $item: Record<string, any>;
      }>;
    }>;
  };
}

export interface ViewSettingsProps {
  container: HTMLElement;
  api: Database;
  viewDefinition: ViewDefinition;
  setViewDefinition: (updater: (current: ViewDefinition) => ViewDefinition) => Promise<void>;
}

export interface HabitStat {
  field: string;
  label: string;
  crop: string;
  isDoneToday: boolean;
  streak: number;
  history: Array<{ date: string; status: boolean }>;
}
