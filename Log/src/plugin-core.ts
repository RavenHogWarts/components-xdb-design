import { createFarmRenderer } from './view';
import { createSettingsRenderer } from './settings';
import styleText from './style.css';
import {
  PLUGIN_ID,
  PLUGIN_NAME,
  PLUGIN_DESCRIPTION,
  PLUGIN_VERSION
} from './types';

// ── XDB 插件元信息（宿主加载时会校验 id / name / description / install）──
export const id = PLUGIN_ID;
export const name = PLUGIN_NAME;
export const description = PLUGIN_DESCRIPTION;
export const author = 'XDB Stardew Habit';
export const version = PLUGIN_VERSION;

export function install(ctx: any) {
  // 注册全局样式表
  ctx.registerStyleSheet(styleText);

  // 注册数据库视图（React 渲染）
  ctx.registerDatabaseView({
    id: PLUGIN_ID,
    name: '星露谷农场',
    icon: 'sprout',
    view() {
      const renderer = createFarmRenderer();
      return {
        onUpdate(props: any) {
          renderer.update(props);
        },
        onDestroy() {
          renderer.destroy();
        }
      };
    }
  });

  // 依据环境特性检测：如果宿主支持 registerViewSettingsTab 则注册为独立设置 Tab，否则降级使用 registerViewSettings
  if (typeof ctx.registerViewSettingsTab === 'function') {
    ctx.registerViewSettingsTab({
      id: PLUGIN_ID,
      tabId: 'stardew-farm',
      label: '星露谷农场',
      icon: 'sprout',
      viewTypes: [PLUGIN_ID],
      settings() {
        const renderer = createSettingsRenderer();
        return {
          onUpdate(props: any) {
            renderer.update(props);
          },
          onDestroy() {
            renderer.destroy();
          }
        };
      }
    });
  } else {
    ctx.registerViewSettings({
      id: PLUGIN_ID,
      viewTypes: [PLUGIN_ID],
      settings() {
        const renderer = createSettingsRenderer();
        return {
          onUpdate(props: any) {
            renderer.update(props);
          },
          onDestroy() {
            renderer.destroy();
          }
        };
      }
    });
  }

  return () => undefined;
}
