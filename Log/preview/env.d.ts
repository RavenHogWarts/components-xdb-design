/// <reference types="vite/client" />

// Vite 已内置 *.png / *.css / *.json 模块声明，这里仅显式声明 ?url 后缀形式，
// 让 mock-props.ts 里的 `import x from '../stardew-habit/xxx.png?url'` 类型完整。
declare module '*.png?url' {
  const src: string;
  export default src;
}
