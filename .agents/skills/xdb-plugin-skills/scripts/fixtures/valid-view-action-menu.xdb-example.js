const PLUGIN_ID = 'valid-view-action-menu';

module.exports = {
  id: PLUGIN_ID,
  name: 'Valid View Action Menu',
  description: 'Exercises registerViewActionMenu with settingTabId and onClick variants.',
  version: '1.0.0',

  install(ctx) {
    const ok1 = ctx.registerViewActionMenu({
      id: `${PLUGIN_ID}:open-filter`,
      label: 'Filter',
      icon: 'filter',
      viewTypes: ['table'],
      order: 100,
      settingTabId: 'filter',
      isActive: ({ viewDefinition }) => viewDefinition.filter != null,
    });
    if (!ok1) throw new Error('registerViewActionMenu(settingTabId) failed');

    const ok2 = ctx.registerViewActionMenu({
      id: `${PLUGIN_ID}:create`,
      label: 'Create',
      icon: 'plus',
      viewTypes: ['table'],
      order: 200,
      onClick: () => undefined,
    });
    if (!ok2) throw new Error('registerViewActionMenu(onClick) failed');

    return () => undefined;
  },
};
