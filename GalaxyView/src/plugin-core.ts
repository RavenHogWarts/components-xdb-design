import { createGalaxyView } from './view';
import { createSettings } from './settings';
import styleText from './style.css';
import { PLUGIN_ID, VIEW_TYPE } from './types';

// ═════════════════════════════════════════════════════════════
// XDB 插件元信息（宿主加载时会校验 id / name / description / install）
// ═════════════════════════════════════════════════════════════

export const id = PLUGIN_ID;
export const name = '星系';
export const description = '点击行星聚焦, 拖拽探索深空';
export const author = 'Albus';
export const version = '1.1.0';

export function install(ctx: any) {
  // 注册全局样式表
  ctx.registerStyleSheet(styleText);

  // 注册数据库星系视图
  ctx.registerDatabaseView({
    id: VIEW_TYPE,
    name: '星系',
    icon: 'orbit',
    view() {
      return createGalaxyView();
    }
  });

  // 依据环境特性检测：若宿主支持 registerViewSettingsTab 则注册为独立设置 Tab，否则降级使用 registerViewSettings
  if (typeof ctx.registerViewSettingsTab === 'function') {
    ctx.registerViewSettingsTab({
      id: VIEW_TYPE,
      tabId: 'galaxy-view-settings',
      label: '星系视图',
      icon: 'orbit',
      viewTypes: [VIEW_TYPE],
      settings() {
        const settingsRenderer = createSettings();
        return {
          onUpdate(props: any) {
            settingsRenderer.onUpdate(props);
          },
          onDestroy() {
            settingsRenderer.onDestroy();
          }
        };
      }
    });
  } else {
    ctx.registerViewSettings({
      id: VIEW_TYPE,
      viewTypes: [VIEW_TYPE],
      settings() {
        const settingsRenderer = createSettings();
        return {
          onUpdate(props: any) {
            settingsRenderer.onUpdate(props);
          },
          onDestroy() {
            settingsRenderer.onDestroy();
          }
        };
      }
    });
  }

  // 返回卸载钩子
  return () => undefined;
}
