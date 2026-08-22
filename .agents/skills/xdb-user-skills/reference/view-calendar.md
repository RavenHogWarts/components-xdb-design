# calendar

## 视图简介

日历视图，按日期把行渲染成事件。

## 适用场景

- 截止日 / 到期日总览。
- 会议、日程安排。
- 发布计划、里程碑日期。

## 专属配置

完整定义以 [View Schema](view-schema.md#calendar) 为准。这里说明 Calendar 的使用语义。

```ts
interface CalendarViewDefinition extends DatabaseViewDefinition {
  type: 'calendar';
  options?: CalendarViewOptions;
}

interface CalendarViewOptions {
  viewType?: 'days' | 'week' | 'month' | 'list'; // 日历形态
  dayCount?: 1 | 2 | 3 | 4 | 5 | 6; // days 视图显示天数
  weekStartsOn?: 'monday' | 'sunday'; // 周首日（week / month）
  startField?: string; // 事件开始日期字段
  endField?: string; // 事件结束日期字段
}
```

| 字段                   | 类型                                    | 必填 | 说明                                                                                       |
| ---------------------- | --------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `options.viewType`     | `'days' \| 'week' \| 'month' \| 'list'` | 否   | 日历形态，默认 `'week'`                                                                    |
| `options.dayCount`     | `1..6`                                  | 否   | 仅 `days` 生效。界面切换到 days 时写入 `3`；直接写 `viewType: "days"` 却省略时运行时按 `1` |
| `options.weekStartsOn` | `'monday' \| 'sunday'`                  | 否   | 仅 `week` / `month`，周首日，默认 `'monday'`                                               |
| `options.startField`   | `string`                                | 否   | 结构上可省略；要显示事件则必须配置。缺省显示空状态                                         |
| `options.endField`     | `string`                                | 否   | 事件结束日期字段名。缺省为单日事件                                                         |

`startField` / `endField` 接受 `date` / `datetime` 字段，或结果能被 moment 解析的 `formula` 字段；也可用内置 `file.ctime` / `file.mtime` / `file.basename`。

单日 vs 范围事件由 `endField` 有无与行数据自动判定（配了且 end 值非空 → 范围事件；否则单日事件）。

事件标题自动取自 `visibleFields` 第一个非空字段。

未配 `endField` 时（单日卡片模式），设置面板解锁卡片封面选项（见 [card-cover.md](card-cover.md)）。

calendar 支持 `filter` / `sort` / `linkOpenMode`，不支持 `group` / `tree` / `limit`。

## 最佳实践

- 用 `due` / `startDate` 等 date 字段做 `startField`。
- 续费 / 到期提醒：配全局或视图 filter 只看未来 N 天。
