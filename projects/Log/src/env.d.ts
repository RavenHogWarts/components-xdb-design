/** esbuild 内联 CSS 插件：.css 文件以压缩后的字符串作为默认导出（见 scripts/build.mjs） */
declare module '*.css' {
  const content: string;
  export default content;
}

/**
 * 以下常量由 scripts/build.mjs 的 define 在构建时注入，
 * 单一来源为项目 package.json 顶层字段（name / version / description /
 * author 及扩展字段 id / icon）。仅在 types.ts 中读取并转发导出，
 * 其余源码一律从 types.ts 导入，不要直接使用这些注入常量。
 */
declare const __PLUGIN_VERSION__: string;
declare const __PLUGIN_ID__: string;
declare const __PLUGIN_NAME__: string;
declare const __PLUGIN_DESCRIPTION__: string;
declare const __PLUGIN_AUTHOR__: string;
declare const __PLUGIN_ICON__: string;
