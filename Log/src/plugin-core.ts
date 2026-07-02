import { renderFarmView } from './view';
import { renderSettingsView } from './settings';
import styleText from './style.min.css';

export function install(ctx: any) {
  // 注册全局样式表
  ctx.registerStyleSheet(styleText);

  // 注册数据库视图
  ctx.registerDatabaseView({
    id: 'stardew-farm-habit',
    name: '星露谷农场',
    icon: 'sprout',
    view() {
      return {
        onUpdate(props: any) {
          renderFarmView(props);
        },
        onDestroy() {}
      };
    }
  });

  // 注册视图配置面板
  ctx.registerViewSettings({
    id: 'stardew-farm-habit',
    viewTypes: ['stardew-farm-habit'],
    settings() {
      return {
        onUpdate(props: any) {
          renderSettingsView(props);
        },
        onDestroy() {}
      };
    }
  });

  return () => undefined;
}
