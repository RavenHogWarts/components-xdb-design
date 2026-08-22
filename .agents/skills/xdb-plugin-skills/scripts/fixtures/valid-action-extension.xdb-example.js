module.exports = {
  id: 'example-action-plugin',
  name: 'Example Action Plugin',
  description: 'Registers a custom action with an editable message.',
  author: 'Example',
  version: '1.0.0',

  install(ctx) {
    const registered = ctx.registerAction({
      type: 'example:notify',
      label: 'Notify',
      icon: 'Bell',
      description: 'Show a notice with a configurable message.',
      create() {
        return { type: 'example:notify', message: '' };
      },
      handler: {
        type: 'example:notify',
        async run(action, context) {
          console.log(action.message, context.sourcePath);
        },
      },
      summary(action, context) {
        return `${context.scope}: ${action.message}`;
      },
      editor() {
        return {
          onUpdate(props) {
            props.setting.input({
              key: 'message',
              label: 'Message',
              value: props.action.message,
              onChange: (message) => {
                props.setAction((current) => ({ ...current, message }));
              },
            });
          },
          onDestroy() {},
        };
      },
    });

    if (!registered) throw new Error('Failed to register example:notify');
    return () => undefined;
  },
};
