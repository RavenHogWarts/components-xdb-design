import { createFarmRenderer } from './view';
import { createSettingsRenderer } from './settings';
import styleText from './style.css';

// ── XDB 插件元信息（宿主加载时会校验 id / name / description / install）──
export const id = 'stardew-farm-habit';
export const name = '星露谷农场打卡';
export const description = '将打卡数据渲染为星露谷风格的农场视图，作物随连续打卡天数生长。';
export const author = 'XDB Stardew Habit';
export const version = '1.0.0';

export function install(ctx: any) {
  // 注册全局样式表
  ctx.registerStyleSheet(styleText);

  // 注册数据库视图（React 渲染）
  ctx.registerDatabaseView({
    id: 'stardew-farm-habit',
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

  // 注册视图配置面板（React 渲染）
  ctx.registerViewSettings({
    id: 'stardew-farm-habit',
    viewTypes: ['stardew-farm-habit'],
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

  return () => undefined;
}
