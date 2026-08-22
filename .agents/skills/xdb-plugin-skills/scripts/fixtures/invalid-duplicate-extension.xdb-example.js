module.exports = {
  id: 'fixture-duplicate-extension',
  name: 'Fixture Duplicate Extension',
  description: 'Registers duplicate ids in the shared database view registry.',
  install(ctx) {
    const view = {
      id: 'fixture-duplicate-view',
      name: 'Fixture View',
      view: () => ({ onUpdate() {}, onDestroy() {} }),
    };
    ctx.registerView(view);
    ctx.registerDatabaseView(view);
    return () => undefined;
  },
};
