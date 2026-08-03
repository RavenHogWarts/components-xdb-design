/** @jest-environment jsdom */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';

type ExtensionInstance<T> = {
  onUpdate(props: T): void;
  onDestroy(): void;
};

type FieldTypeExtension = {
  type: string;
  label: string;
  icon: string;
};

type RendererExtension = {
  id: string;
  match(context: { field: { type?: string } }): boolean;
  canEdit?: (field: unknown) => boolean;
  isValueEmpty(field: unknown, value: unknown): boolean;
  view(): ExtensionInstance<any>;
  viewComponent?: unknown;
  editor?: unknown;
};

type SettingsExtension = {
  id: string;
  match(context: { field: { type?: string } }): boolean;
  settings(): ExtensionInstance<any>;
  settingsComponent?: unknown;
};

type LoadedPlugin = {
  install(ctx: {
    registerFieldType(extension: FieldTypeExtension): boolean;
    registerFieldRenderer(extension: RendererExtension): void;
    registerFieldSettings(extension: SettingsExtension): void;
    registerStyleSheet(css: string): void;
  }): () => void;
};

const pluginPath = path.join(__dirname, 'heading-content-field.xdb.js');

function loadPlugin(): LoadedPlugin {
  const source = readFileSync(pluginPath, 'utf8');
  const module = { exports: {} as LoadedPlugin };
  const evaluate = new Function('module', 'exports', source);
  evaluate(module, module.exports);
  return module.exports;
}

function loadExtensions(fieldTypeRegistered = true) {
  const plugin = loadPlugin();
  let fieldType: FieldTypeExtension | null = null;
  let renderer: RendererExtension | null = null;
  let settings: SettingsExtension | null = null;
  let styleSheet = '';

  const install = () =>
    plugin.install({
      registerFieldType(extension) {
        fieldType = extension;
        return fieldTypeRegistered;
      },
      registerFieldRenderer(extension) {
        renderer = extension;
      },
      registerFieldSettings(extension) {
        settings = extension;
      },
      registerStyleSheet(css) {
        styleSheet = css;
      },
    });

  return {
    install,
    get fieldType() {
      return fieldType!;
    },
    get renderer() {
      return renderer!;
    },
    get settings() {
      return settings!;
    },
    get styleSheet() {
      return styleSheet;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('heading-content-field.xdb.js', () => {
  it('registers a namespaced public field type, renderer, settings, and stylesheet', () => {
    const loaded = loadExtensions();
    const cleanup = loaded.install();

    expect(loaded.fieldType).toMatchObject({
      type: 'heading-content',
      label: 'Heading content',
      icon: 'heading',
    });
    expect(loaded.renderer.id).toBe('heading-content-field:renderer');
    expect(loaded.settings.id).toBe('heading-content-field:settings');
    expect(loaded.renderer.match({ field: { type: 'heading-content' } })).toBe(true);
    expect(loaded.renderer.match({ field: { type: 'text' } })).toBe(false);
    expect(loaded.settings.match({ field: { type: 'heading-content' } })).toBe(true);
    expect(loaded.renderer.isValueEmpty({}, undefined)).toBe(false);
    expect(loaded.renderer.canEdit).toBeUndefined();
    expect(loaded.renderer.viewComponent).toBeUndefined();
    expect(loaded.renderer.editor).toBeUndefined();
    expect(loaded.settings.settingsComponent).toBeUndefined();
    expect(loaded.styleSheet).toContain('.headingContentField--Root');
    expect(loaded.styleSheet).not.toContain('components--');
    expect(cleanup).toEqual(expect.any(Function));
  });

  it('fails installation when the field type cannot be registered', () => {
    const loaded = loadExtensions(false);

    expect(loaded.install).toThrow('Could not register field type: heading-content');
  });

  it('renders nothing and does not read a file when heading is not configured', () => {
    const loaded = loadExtensions();
    loaded.install();
    const container = document.createElement('div');
    container.textContent = 'stale';
    const getRowLink = jest.fn();
    const readUnderHeading = jest.fn();
    const instance = loaded.renderer.view();

    instance.onUpdate({
      app: { vault: { on: jest.fn(), offref: jest.fn() } },
      api: { getRowLink },
      row: { id: 'row-1' },
      field: { type: 'heading-content' },
      markdown: { readUnderHeading },
      obsidian: {},
      container,
    });

    expect(container.textContent).toBe('');
    expect(getRowLink).not.toHaveBeenCalled();
    expect(readUnderHeading).not.toHaveBeenCalled();
    instance.onDestroy();
  });

  it('keeps rendered content mounted and skips semantically identical updates', async () => {
    const loaded = loadExtensions();
    loaded.install();
    const content = deferred<string>();
    const readUnderHeading = jest.fn(() => content.promise);
    const markdownRender = jest.fn(async (_app, value: string, target: HTMLElement) => {
      target.textContent = value;
    });
    const container = document.createElement('div');
    container.textContent = 'existing content';

    class Component {
      load() {}
      unload() {}
    }

    const commonProps = {
      app: { vault: { on: jest.fn(() => ({ id: 'modify-listener' })), offref: jest.fn() } },
      api: { getRowLink: () => ({ href: 'Notes/Plan.md', label: 'Plan' }) },
      row: { id: 'row-1' },
      markdown: { readUnderHeading },
      obsidian: { Component, MarkdownRenderer: { render: markdownRender } },
      container,
    };
    const field = {
      type: 'heading-content',
      options: {
        'heading-content-field': { heading: '## Summary', includeSubHeadings: false },
      },
    };
    const instance = loaded.renderer.view();

    instance.onUpdate({ ...commonProps, field });
    instance.onUpdate({
      ...commonProps,
      row: { id: 'row-1' },
      field: {
        ...field,
        options: {
          'heading-content-field': { heading: '  ## Summary  ', includeSubHeadings: false },
        },
      },
    });

    expect(readUnderHeading).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('existing content');

    content.resolve('rendered content');
    await flushPromises();

    expect(markdownRender).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('rendered content');
    instance.onDestroy();
  });

  it('persists heading settings under the plugin-owned options key', () => {
    const loaded = loadExtensions();
    loaded.install();
    const container = document.createElement('div');
    const setFieldDefinition = jest.fn();
    let headingSetting: any;
    let includeSubHeadingsSetting: any;
    const instance = loaded.settings.settings();

    instance.onUpdate({
      container,
      field: { type: 'heading-content' },
      setFieldDefinition,
      setting: {
        input(options: any) {
          headingSetting = options;
        },
        switch(options: any) {
          includeSubHeadingsSetting = options;
        },
      },
    });

    expect(container.childElementCount).toBe(0);
    expect(headingSetting).toMatchObject({
      key: 'heading',
      label: 'Heading',
      placeholder: '## Summary',
      value: '',
    });
    expect(includeSubHeadingsSetting).toMatchObject({
      key: 'includeSubHeadings',
      label: 'Include subheadings',
      value: false,
    });

    headingSetting.onChange('  ## Summary  ');
    includeSubHeadingsSetting.onChange(true);

    const headingUpdater = setFieldDefinition.mock.calls[0][0] as (field: any) => any;
    const includeUpdater = setFieldDefinition.mock.calls[1][0] as (field: any) => any;
    const afterHeading = headingUpdater({
      type: 'heading-content',
      options: { external: { keep: true } },
    });
    const next = includeUpdater(afterHeading);

    expect(next).toEqual({
      type: 'heading-content',
      options: {
        external: { keep: true },
        'heading-content-field': {
          heading: '## Summary',
          includeSubHeadings: true,
        },
      },
    });
    instance.onDestroy();
  });

  it('renders the configured section, forwards the subheading option, and ignores stale reads', async () => {
    const loaded = loadExtensions();
    loaded.install();
    const first = deferred<string>();
    const second = deferred<string>();
    const readUnderHeading = jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce('updated content');
    const markdownRender = jest.fn(async (_app, content: string, target: HTMLElement) => {
      target.textContent = content;
    });
    const unload = jest.fn();

    class Component {
      load() {}
      unload() {
        unload();
      }
    }

    const listeners = new Map<string, (file: { path: string }) => void>();
    const eventRef = { id: 'modify-listener' };
    const offref = jest.fn();
    const commonProps = {
      app: {
        vault: {
          on: (_name: string, callback: (file: { path: string }) => void) => {
            listeners.set('modify', callback);
            return eventRef;
          },
          offref,
        },
      },
      api: { getRowLink: () => ({ href: 'Notes/Plan.md', label: 'Plan' }) },
      row: { id: 'row-1' },
      markdown: { readUnderHeading },
      obsidian: { Component, MarkdownRenderer: { render: markdownRender } },
      container: document.createElement('div'),
    };
    const instance = loaded.renderer.view();

    instance.onUpdate({
      ...commonProps,
      field: {
        type: 'heading-content',
        options: {
          'heading-content-field': { heading: '## Summary', includeSubHeadings: false },
        },
      },
    });
    instance.onUpdate({
      ...commonProps,
      field: {
        type: 'heading-content',
        options: {
          'heading-content-field': { heading: '### Details', includeSubHeadings: true },
        },
      },
    });

    second.resolve('new content');
    await flushPromises();
    first.resolve('stale content');
    await flushPromises();

    expect(readUnderHeading).toHaveBeenNthCalledWith(1, 'Notes/Plan.md', {
      heading: '## Summary',
      includeSubHeadings: false,
    });
    expect(readUnderHeading).toHaveBeenNthCalledWith(2, 'Notes/Plan.md', {
      heading: '### Details',
      includeSubHeadings: true,
    });
    expect(commonProps.container.textContent).toBe('new content');
    expect(commonProps.container.textContent).not.toContain('stale content');

    listeners.get('modify')?.({ path: 'Other.md' });
    expect(readUnderHeading).toHaveBeenCalledTimes(2);

    listeners.get('modify')?.({ path: 'Notes/Plan.md' });
    await flushPromises();
    expect(readUnderHeading).toHaveBeenCalledTimes(3);
    expect(commonProps.container.textContent).toBe('updated content');

    instance.onDestroy();
    expect(offref).toHaveBeenCalledWith(eventRef);
    expect(unload).toHaveBeenCalled();
  });
});
