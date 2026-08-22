module.exports = {
  id: 'rating-field-plugin',
  name: 'Rating Field',
  description: 'Registers rating type metadata, rendering, and settings independently.',
  author: 'XDB',
  version: '1.0.0',
  install(ctx) {
    const registered = ctx.registerFieldType({
      type: 'rating',
      label: 'Rating',
      icon: 'star',
      order: 50,
      match: ({ api }) => api.getDefinition().source !== 'task',
    });
    if (!registered) throw new Error('Could not register rating field type');

    ctx.registerFieldRenderer({
      id: 'rating-field-plugin:renderer',
      name: 'Rating renderer',
      match: ({ field }) => field.type === 'rating',
      isValueEmpty: (_field, value) => value == null,
      view: () => ({
        onUpdate(props) {
          props.container.textContent = String(props.value ?? '');
        },
        onDestroy() {},
      }),
    });

    ctx.registerFieldSettings({
      id: 'rating-field-plugin:settings',
      match: ({ field }) => field.type === 'rating',
      settings: () => ({
        onUpdate(props) {
          props.setting.numberInput({
            key: 'maximum',
            label: 'Maximum rating',
            value: Number(props.field.options?.['rating-field-plugin']?.maximum ?? 5),
            min: 1,
            max: 10,
            step: 1,
            onChange: () => undefined,
          });
          props.setting.picker({
            key: 'display',
            label: 'Display',
            value: 'stars',
            options: [
              { value: 'stars', label: 'Stars', icon: 'Star' },
              { value: 'number', label: 'Number', icon: 'Hash' },
            ],
            onChange: () => undefined,
          });
          props.setting.autocomplete({
            key: 'source',
            label: 'Existing source',
            value: 'score',
            options: [{ value: 'score', label: 'Score' }],
            onChange: () => undefined,
          });
          props.setting.propertyCombobox({
            key: 'target-property',
            label: 'Target property',
            value: 'rating',
            onChange: () => undefined,
          });
        },
        onDestroy() {},
      }),
    });

    return () => undefined;
  },
};
