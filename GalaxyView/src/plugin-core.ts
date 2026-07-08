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
  // 注册全局样式表（由 build.mjs 的 css 插件内联导入）
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

  // 注册星系视图设置面板
  ctx.registerViewSettings({
    id: VIEW_TYPE,
    viewTypes: [VIEW_TYPE],
    settings() {
      return createSettings();
    }
  });

  // 返回卸载钩子
  return () => undefined;
}
