module.exports = {
  id: 'invalid-field-type-plugin',
  name: 'Invalid Field Type',
  description: 'Exercises Field Type validation.',
  author: 'XDB',
  version: '1.0.0',
  install(ctx) {
    ctx.registerFieldType({
      type: 'rating',
      label: '',
      icon: 'star',
    });
    return () => undefined;
  },
};
