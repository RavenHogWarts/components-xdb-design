# gantt

## 视图简介

甘特图视图，按起止时间把行渲染成时间线条。

## 适用场景

- 项目排期、里程碑。
- 多任务并行的时间线总览。
- 资源 / 人员占用时段。

## Schema

```ts
interface GanttViewDefinition extends DatabaseViewDefinition {
  type: 'gantt';
  options?: GanttViewOptions;
}

interface GanttViewOptions {
  startField?: string;             // 开始时间字段名
  endField?: string;               // 结束时间字段名
  zoom?: 'year' | 'month' | 'week' | 'day';   // 时间轴粒度
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `options.startField` | `string` | 是 | 开始时间字段名。缺省显示空状态 |
| `options.endField` | `string` | 否 | 结束时间字段名。缺省渲染为单日点条 |
| `options.zoom` | `'year' \| 'month' \| 'week' \| 'day'` | 否 | 时间轴粒度，默认 `'month'` |

`startField` / `endField` 必须是 `date` / `datetime` 字段，或结果能被 moment 解析的 formula 字段（建议给公式字段写 `type: "date"` / `"datetime"`），也可用内置 `file.ctime` / `file.mtime` / `file.basename`。

- `date` 类型按天对齐（开始=当天 0 点，结束=当天结束）。
- `datetime` 保留精确时间。
- `end < start` 时退化为点条（落在 start）。

条的标签自动取自 `visibleFields` 第一个非空字段，无 `labelField` 配置。

gantt 支持 `filter` / `sort` / `group`（分组渲染分段）/ `limit` / `linkOpenMode`。不支持 `tree`，无颜色 / 进度字段。

## 最佳实践

- 想让某字段当条标签，放 `visibleFields` 第一位。
- 配 `group` 按 project 分组分段显示。
