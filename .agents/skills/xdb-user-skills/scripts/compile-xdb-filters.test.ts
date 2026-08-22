import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as momentFactory from 'moment';
import { createDatabaseFilterLanguage, createDatabaseFilterSchema } from '@/v3/componnet/database2/filter';
import type { DatabaseAvailableField } from '@/v3/componnet/database2/api/types';
import { createMomentDateAdapter } from '@/v3/core/dsl/builtins';
import { FilterEngine } from '@/v3/core/dsl/inline-expression';

type FilterNode = {
  id?: unknown;
  type?: unknown;
  expression?: unknown;
  items?: unknown;
};

type XdbDefinition = {
  fields?: unknown;
  filter?: unknown;
  views?: unknown;
};

const defaultFixture = 'docs/skills/xdb-user-skills/examples/project-dashboard.xdb';
const fixturePath = resolve(process.cwd(), process.env.XDB_VALIDATE_FILE ?? defaultFixture);
const definition = JSON.parse(readFileSync(fixturePath, 'utf8')) as XdbDefinition;

test(`all filter expressions compile with database2 FilterEngine: ${fixturePath}`, () => {
  const dateAdapter = createMomentDateAdapter(momentFactory);
  const language = createDatabaseFilterLanguage(dateAdapter);
  const schema = createDatabaseFilterSchema(availableFields(definition), dateAdapter);
  const engine = new FilterEngine(language, schema);
  const failures = filterExpressions(definition).flatMap(({ where, expression }) => {
    const diagnostics = engine.compile(expression).diagnostics;
    return diagnostics.map((diagnostic) => `${where}: ${diagnostic.message}`);
  });

  expect(failures).toEqual([]);
});

function availableFields(definition: XdbDefinition): DatabaseAvailableField[] {
  const result = new Map<string, DatabaseAvailableField>();
  const builtins: DatabaseAvailableField[] = [
    { name: 'file.path', type: 'text' },
    { name: 'file.basename', type: 'text' },
    { name: 'file.ctime', type: 'datetime' },
    { name: 'file.mtime', type: 'datetime' },
    { name: 'file.tags', type: 'multi-select' },
    { name: 'file.tasks', type: 'any-array' },
  ];
  for (const field of builtins) result.set(field.name, field);
  if (Array.isArray(definition.fields)) {
    for (const value of definition.fields) {
      if (!isRecord(value) || typeof value.name !== 'string') continue;
      result.set(value.name, {
        name: value.name,
        type: typeof value.type === 'string' ? value.type : 'text',
      });
    }
  }
  return [...result.values()];
}

function filterExpressions(definition: XdbDefinition): Array<{ where: string; expression: string }> {
  const result: Array<{ where: string; expression: string }> = [];
  collectFilter(definition.filter, 'global filter', result);
  if (Array.isArray(definition.views)) {
    for (const view of definition.views) {
      if (!isRecord(view)) continue;
      const viewId = typeof view.id === 'string' ? view.id : '(no id)';
      collectFilter(view.filter, `view ${viewId} filter`, result);
    }
  }
  return result;
}

function collectFilter(
  value: unknown,
  where: string,
  result: Array<{ where: string; expression: string }>
): void {
  if (!isRecord(value)) return;
  if (value.type === 'expression' && typeof value.expression === 'string') {
    const id = typeof value.id === 'string' ? value.id : '(no id)';
    result.push({ where: `${where} ${id}`, expression: value.expression });
  }
  if (Array.isArray(value.items)) {
    for (const child of value.items) collectFilter(child, where, result);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
