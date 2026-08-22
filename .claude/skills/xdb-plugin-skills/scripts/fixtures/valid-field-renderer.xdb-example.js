module.exports = {
  id: 'fixture-field-renderer',
  name: 'Fixture Field Renderer',
  description: 'Validates the public field renderer and settings contracts.',
  install(ctx) {
    ctx.registerFieldRenderer({
      id: 'fixture-field-renderer',
      name: 'Fixture Renderer',
      order: -10,
      match: ({ field }) => field.name === 'Summary',
      isValueEmpty: () => false,
      view: () => ({ onUpdate() {}, onDestroy() {} }),
    });

    ctx.registerFieldSettings({
      id: 'fixture-field-settings',
      order: -10,
      match: ({ field }) => field.name === 'Summary',
      settings: () => ({ onUpdate() {}, onDestroy() {} }),
    });

    return () => undefined;
  },
};
