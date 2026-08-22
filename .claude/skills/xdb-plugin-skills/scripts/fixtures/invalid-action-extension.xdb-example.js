module.exports = {
  id: 'invalid-action-plugin',
  name: 'Invalid Action Plugin',
  description: 'Contains invalid action registrations for validator coverage.',

  install(ctx) {
    ctx.registerAction({
      type: 'example:invalid-match',
      label: 'Invalid Match',
      icon: 'CircleX',
      match: 'not-a-function',
      create: () => ({ type: 'example:invalid-match' }),
      handler: { type: 'example:invalid-match', run: async () => undefined },
      summary: () => '',
    });

    ctx.registerAction({
      type: 'example:mismatch',
      label: 'Mismatched Handler',
      icon: 'CircleX',
      create: () => ({ type: 'example:mismatch' }),
      handler: { type: 'example:other', run: async () => undefined },
      summary: () => '',
    });

    ctx.registerAction({
      type: 'example:invalid-description',
      label: 'Invalid Description',
      icon: 'CircleX',
      description: 42,
      create: () => ({ type: 'example:invalid-description' }),
      handler: { type: 'example:invalid-description', run: async () => undefined },
      summary: () => '',
    });

    return () => undefined;
  },
};
