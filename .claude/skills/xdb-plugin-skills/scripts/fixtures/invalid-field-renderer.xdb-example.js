module.exports = {
  id: 'fixture-invalid-field-renderer',
  name: 'Fixture Invalid Field Renderer',
  description: 'Exercises invalid public field extension contracts.',
  install(ctx) {
    ctx.registerFieldRenderer({
      id: 'invalid-renderer',
      name: 'Invalid Renderer',
      match: 'not-a-function',
      isValueEmpty: () => false,
      viewComponent: () => null,
    });

    ctx.registerFieldSettings({
      id: 'invalid-settings',
      match: () => true,
      settingsComponent: () => null,
    });

    return () => undefined;
  },
};
