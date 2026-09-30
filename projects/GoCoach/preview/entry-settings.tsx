/** @jsxImportSource react */
// 设置页测试入口（仅开发用）：模拟宿主 setting builder。
// 复现点：custom(key) 在每次 onUpdate 时对同一容器 cleanup + render；
// 并预置一个模拟导入的题库，验证「一行一库 + 开关 + ℹ」渲染。

import { createSettingsRenderer } from '../src/settings';
import { upsertLibrary } from '../src/storage';

const app = document.getElementById('app')!;
const log = document.getElementById('log')!;

const customs = new Map<string, HTMLElement>();

const settingMock: any = {
  title: () => undefined,
  description: () => undefined,
  switch: (o) => {
    // 模拟宿主 switch：真实 checkbox，change 时回调；重渲染按最新 value 重置
    let el = switchEls.get(o.key);
    if (!el) {
      el = document.createElement('label');
      el.dataset.settingKey = o.key;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.addEventListener('change', () => o.onChange(input.checked));
      el.append(input, document.createTextNode(o.label));
      switchEls.set(o.key, el);
      app.append(el);
    }
    (el.querySelector('input') as HTMLInputElement).checked = o.value;
  },
  action: () => undefined,
  input: (o) => {
    // 模拟宿主 input：真实输入框，change 时回调；重渲染时按最新 value 重置
    let el = inputEls.get(o.key);
    if (!el) {
      el = document.createElement('input');
      el.type = 'text';
      el.placeholder = o.placeholder ?? '';
      el.dataset.settingKey = o.key;
      el.addEventListener('change', () => o.onChange(el.value));
      inputEls.set(o.key, el);
      app.append(el);
    }
    el.value = o.value;
  },
};
const inputEls = new Map();
const switchEls = new Map();

const customRerenders: Array<() => void> = [];

const settingProxy: any = new Proxy(settingMock, {
  get(target, prop) {
    if (prop === 'custom') {
      return (opts: { key: string; render: (el: HTMLElement) => void | (() => void) }) => {
        let el = customs.get(opts.key);
        if (!el) {
          el = document.createElement('div');
          customs.set(opts.key, el);
          app.append(el);
        }
        let cleanup: (() => void) | undefined;
        customRerenders.push(() => {
          cleanup?.();
          cleanup = (opts.render(el) as () => void) ?? undefined;
        });
      };
    }
    return (target as any)[prop];
  },
});

const renderer = createSettingsRenderer();
const update = () =>
  renderer.update({
    container: app,
    viewDefinition: { options: {} },
    setViewDefinition: async () => undefined,
    setting: settingProxy,
  } as any);

const assert = async () => {
  await new Promise((r) => setTimeout(r, 400));
  const lib = customs.get('libraryList')!;
  const entries = lib.querySelectorAll('.goCoach--libEntry').length;
  const toggles = lib.querySelectorAll('.goCoach--switch input').length;
  const delBtns = lib.querySelectorAll('.goCoach--libDel').length;
  const names = [...lib.querySelectorAll('.goCoach--libName')].map((n) => n.textContent);
  log.textContent =
    `条目行=${entries}（期望 2：内置 + 导入） 开关=${toggles}（期望 2） 删除=${delBtns}（期望 1） ℹ残留=${lib.querySelectorAll('.goCoach--libInfoWrap,.goCoach--libInfoIcon,.goCoach--libMeta').length}（期望 0） 名称=[${names.join(' | ')}]`;
};

void upsertLibrary({
  id: 'gocoach-ggg-go-game-guru-weekly-go-problems',
  meta: {
    // 模拟旧版导入数据：无 title，仅 format + attribution
    format: 'gocoach-ggg',
    count: 417,
    attribution: 'Go Game Guru Weekly Go Problems by David Ormerod and An Younggil',
    license: 'CC BY-NC-SA-4.0',
  },
  lessons: [],
  enabled: true,
  importedAt: new Date().toISOString(),
}).then(() => {
  update();
  update();
  customRerenders.forEach((r) => r());
  customRerenders.forEach((r) => r());
  void assert();
});
