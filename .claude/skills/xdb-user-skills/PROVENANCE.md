# 来源记录（PROVENANCE）

- 上游来源：<https://my.feishu.cn/wiki/Pj2mw3Px0iu9PakXnLLcRRURnAd>（飞书 wiki，登录后可见）
- 作者：vran（SKILL.md frontmatter 亦标注）
- 许可证：**上游未标注**（无 LICENSE 文件，frontmatter 无 license 字段）。按本仓库 docs/imported-skills-guide.md 第 2 节：默认保留所有权利——**仅限个人使用；公开仓库前须取得作者授权**
- 上游版本：`0.0.6`（SKILL.md `version`），更新日期 2026-08-17
- 导入日期：2026-08-22
- 导入方式：手动复制（飞书页面有登录墙，无法程序化核对上游快照）

## 修改记录

| 日期 | 修改内容 | 原因 |
| --- | --- | --- |
| 2026-08-22 | SKILL.md「验证」与 `reference/filter.md`「验证」中的调用路径 `docs/skills/xdb-user-skills/scripts/…` 改为 `<skill-dir>/scripts/…` | 上游路径绑定其源码仓（database2）布局，在本仓库与 agent 安装目录中不存在该路径（规范禁止依赖仓库全局路径，见 docs/skill-format-spec.md） |
| 2026-08-22 | 删除 `.DS_Store` | macOS 系统残留文件，与 skill 无关 |

## 刻意保留的原样

- `scripts/validate-xdb.test.ts` 与 `scripts/compile-xdb-filters.test.ts` 内部的 `docs/skills/…` 路径**未改**：这两个 jest 测试设计为在 database2 源码仓内运行，路径绑定该仓布局；
- 目录名 `reference/`（单数）、`examples/` 等上游内部结构未按本仓库命名规范重命名（搬运件保持上游原样，便于对照更新）。
