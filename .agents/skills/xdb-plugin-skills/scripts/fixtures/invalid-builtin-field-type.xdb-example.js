module.exports = {
  id: 'invalid-builtin-field-type-plugin',
  name: 'Invalid Built-in Field Type',
  description: 'Exercises built-in Field Type collision validation.',
  author: 'XDB',
  version: '1.0.0',
  install(ctx) {
    ctx.registerFieldType({
      type: 'text',
      label: 'Replacement text',
      icon: 'text',
    });
    return () => undefined;
  },
};
