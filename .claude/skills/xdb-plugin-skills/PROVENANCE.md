# 来源记录（PROVENANCE）

- 上游来源：<https://my.feishu.cn/wiki/Pj2mw3Px0iu9PakXnLLcRRURnAd>（飞书 wiki，登录后可见）
- 作者：vran（SKILL.md frontmatter 亦标注）
- 许可证：**上游未标注**（无 LICENSE 文件，frontmatter 无 license 字段）。按本仓库 docs/imported-skills-guide.md 第 2 节：默认保留所有权利——**仅限个人使用；公开仓库前须取得作者授权**
- 上游版本：`0.0.5`（SKILL.md `version`），更新日期 2026-08-13
- 导入日期：2026-08-22
- 导入方式：手动复制（飞书页面有登录墙，无法程序化核对上游快照）

## 修改记录

| 日期 | 修改内容 | 原因 |
| --- | --- | --- |
| 2026-08-22 | SKILL.md「验证与诊断」与 `references/action.md` 中的调用路径 `docs/skills/xdb-plugin-skills/scripts/…` 改为 `<skill-dir>/scripts/…` | 上游路径绑定其源码仓（database2）布局，在本仓库与 agent 安装目录中不存在该路径（规范禁止依赖仓库全局路径，见 docs/skill-format-spec.md） |

## 刻意保留的原样

- 上游目录结构（`references/`、`scripts/fixtures/`）与 frontmatter 额外字段（`version`、`author`）未做改动。
