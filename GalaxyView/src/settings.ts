import type {
  ViewDefinition,
  ViewSettingsProps,
  GalaxyOptions,
  XdbContextProps
} from './types';

// ═════════════════════════════════════════════════════════════
// 核心工具函数 (复刻原 JS 逻辑并赋予强类型)
// ═════════════════════════════════════════════════════════════

export function mOpts(
  c: Record<string, any> | undefined,
  chg: Record<string, any> | undefined
): Record<string, any> {
  const n: Record<string, any> = {};
  if (c) {
    for (const k of Object.keys(c)) {
      n[k] = c[k];
    }
  }
  if (chg) {
    for (const k of Object.keys(chg)) {
      if (chg[k] == null || chg[k] === '') {
        delete n[k];
      } else {
        n[k] = chg[k];
      }
    }
  }
  return n;
}

export function bDef(c: ViewDefinition, chg: Record<string, any>): ViewDefinition {
  const o = mOpts(c.options, chg);
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    icon: c.icon,
    visibleFields: c.visibleFields,
    filter: c.filter,
    sort: c.sort,
    group: c.group,
    options: Object.keys(o).length > 0 ? o : undefined
  };
}

export function svOpts(
  fn: (updater: (current: ViewDefinition) => ViewDefinition) => Promise<void>,
  chg: Record<string, any>
): Promise<void> {
  return fn((c) => bDef(c, chg));
}

export function rOpts(vd: ViewDefinition): GalaxyOptions {
  const o = vd.options || {};
  return {
    titleField: typeof o.titleField === 'string' ? o.titleField.trim() : '',
    tagField: typeof o.tagField === 'string' ? o.tagField.trim() : '',
    folderDepth: typeof o.folderDepth === 'number' ? o.folderDepth : 2,
    ringThreshold: typeof o.ringThreshold === 'number' ? o.ringThreshold : 5,
    assetsPath: typeof o.assetsPath === 'string' ? o.assetsPath.trim() : ''
  };
}

// ═════════════════════════════════════════════════════════════
// DOM 创建辅助函数
// ═════════════════════════════════════════════════════════════

function sAct(l: string, c: HTMLElement): HTMLDivElement {
  const a = document.createElement('div');
  a.className = 'components--SettingAction';
  
  const lb = document.createElement('div');
  lb.className = 'components--SettingActionLabel';
  lb.textContent = l;
  
  const cr = document.createElement('div');
  cr.className = 'components--SettingActionControl';
  cr.appendChild(c);
  
  a.append(lb, cr);
  return a;
}

function input(
  l: string,
  v: string,
  fn: (val: string) => void,
  ph?: string
): HTMLDivElement {
  const i = document.createElement('input');
  i.type = 'text';
  i.value = v;
  if (ph) i.placeholder = ph;
  if (ph) i.style.width = '200px';
  
  i.addEventListener('change', () => {
    fn(i.value.trim());
  });
  
  return sAct(l, i);
}

// ═════════════════════════════════════════════════════════════
// 设置项主接口
// ═════════════════════════════════════════════════════════════

export function createSettings() {
  return {
    onUpdate(p: ViewSettingsProps) {
      p.container.replaceChildren();
      const o = rOpts(p.viewDefinition);
      const f = document.createElement('div');
      
      // 外部资源路径（已内置，非必填）
      f.append(
        input(
          '外部依赖资源路径',
          o.assetsPath,
          (v) => {
            void svOpts(p.setViewDefinition, { assetsPath: v || undefined });
          },
          '（可选）资源已自动内置，此项无需填写'
        )
      );
      
      // 标题字段
      f.append(
        input(
          '标题字段',
          o.titleField,
          (v) => {
            void svOpts(p.setViewDefinition, { titleField: v || undefined });
          },
          '如 title, 留空则默认使用文件名'
        )
      );
      
      // 星球分类字段
      f.append(
        input(
          '星球分类字段',
          o.tagField,
          (v) => {
            void svOpts(p.setViewDefinition, { tagField: v || undefined });
            p.container.dispatchEvent(
              new CustomEvent('settings-refresh', { bubbles: true })
            );
          },
          '如 tags, 留空默认依据文件夹层级分类'
        )
      );
      
      // 如果没有配置 tagField，才显示文件夹深度选项
      if (!o.tagField) {
        const sel = document.createElement('select');
        [1, 2].forEach((d) => {
          sel.add(new Option(String(d), String(d), false, d === o.folderDepth));
        });
        sel.value = String(o.folderDepth);
        sel.addEventListener('change', () => {
          void svOpts(p.setViewDefinition, { folderDepth: Number(sel.value) });
        });
        f.append(sAct('分类文件夹层级', sel));
      }
      
      // 卫星环生成阈值
      const ri = document.createElement('input');
      ri.type = 'number';
      ri.min = '0';
      ri.step = '1';
      ri.value = String(o.ringThreshold);
      ri.placeholder = '如 10';
      ri.style.width = '64px';
      ri.addEventListener('change', () => {
        const v = Math.max(0, parseInt(ri.value, 10) || 0);
        ri.value = String(v);
        void svOpts(p.setViewDefinition, { ringThreshold: v });
      });
      f.append(sAct('卫星环生成阈值', ri));
      
      p.container.appendChild(f);
    },
    onDestroy() {}
  };
}
