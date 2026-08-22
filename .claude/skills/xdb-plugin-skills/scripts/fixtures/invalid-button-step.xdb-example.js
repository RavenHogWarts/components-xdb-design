module.exports = {
  id: 'fixture-removed-button-step',
  name: 'Fixture Removed Button Step',
  description: 'Ensures removed button-step APIs are rejected by the validator.',
  install(ctx) {
    ctx.registerButtonStep({
      id: 'removed-step',
      name: 'Removed Step',
      async run() {},
    });

    return () => undefined;
  },
};
