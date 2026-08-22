const PLUGIN_ID = 'invalid-view-action-menu';

module.exports = {
  id: PLUGIN_ID,
  name: 'Invalid View Action Menu',
  description: 'settingTabId 与 onClick 必须二选一；此处两者都缺，应被拒绝。',
  version: '1.0.0',

  install(ctx) {
    // 既没有 settingTabId 也没有 onClick → shape 校验失败，返回 false。
    ctx.registerViewActionMenu({
      id: `${PLUGIN_ID}:bad`,
      label: 'Bad',
      icon: 'x',
    });
    return () => undefined;
  },
};
