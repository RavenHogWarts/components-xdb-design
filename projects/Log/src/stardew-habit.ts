// src/stardew-habit.ts
// 这是星露谷打卡插件的 TS 源码入口骨架。实际最终打包产物会由 build.mjs 脚本后处理，将 module.exports 强制提升至文件最顶端以符合 XDB 预扫描规范。

import { install } from './plugin-core';

module.exports = {
  id: 'xdb-stardew-habit-tracker',
  name: '星露谷物语打卡插件',
  description: '将习惯追踪变成星露谷物语像素风的农场模拟经营体验。',
  author: 'RavenHogwarts',
  version: '1.0.0',
  install(ctx: any) {
    return install(ctx);
  }
};
