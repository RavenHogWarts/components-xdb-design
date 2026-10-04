# 资源处理与精灵图解析设计

本文记录 StardewValleyLog 如何消费星露谷游戏资源：分层策略、已内联资产、构建管线、
切图公式与数据派生链。旧 Log 项目的方案只作事实参考（尤其是像素扫描结论），实现不复用。

## 1. 资源分层

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 原始参考 | `assets/Content (unpacked)/` | 游戏解包完整转储（约 177MB，含全语言、全地图）。已 gitignore（`/assets` 根锚定），仅本机存在，供查阅与派生脚本读取 |
| 内联精选 | `src/assets/` | 提交进 git 的最小集合，构建时打进产物，是代码引用的唯一来源 |
| 构建产物 | `stardew-valley-log.xdb.js` | 自包含（资源内联），**运行时不依赖 vault**，用户无需拷贝任何素材 |

> 与旧方案的关键差异：旧 Log 要求用户把 PNG 拷进 vault、运行时经
> `app.vault.getResourcePath` 读取。新方案改为构建期内联，零 vault IO。

## 2. 已内联资产（src/assets/，共 ~617KB）

### 精灵图 sprites/（已移除动物 4 张）

| 文件 | 来源（Content (unpacked)） | 大小 / 尺寸 | 用途 |
| --- | --- | --- | --- |
| `crops.png` | `TileSheets/crops.png` | 82KB / 256×1024 | 全部 50 种作物生长阶段（核心） |
| `hoeDirt.png` | `TerrainFeatures/hoeDirt.png` | 10KB / 192×64 | 耕地土壤（核心） |
| `fruitTrees.png` | `TileSheets/fruitTrees.png` | 115KB / 432×720 | 果树成长贴图，配 `FruitTrees.json` 的 `TextureSpriteRow` |
| `springobjects.png` | `Maps/springobjects.png` | 252KB / 384×624 | 物品图标总表（16px 网格 24×39，下标 = 物品 id） |
| `tools.png` | `TileSheets/tools.png` | 34KB / 336×384 | 工具图标（浇水壶 = 打卡动作等） |
| `houses.png` | `Buildings/houses.png` | 41KB / 272×432 | 农舍升级（等级/里程碑隐喻） |
| `grass.png` | `TerrainFeatures/grass.png` | 15KB / 66×240 | 草丛装饰（空状态等） |

> 动物贴图（chicken/cow/cat/dog，共 ~27KB）曾内联用于图鉴动物分类，后按需求移除；
> 如需恢复，源文件在参考转储 `Animals/`（帧网格：鸡 32×16，牛/猫/狗 32×32）。

### 数据 data/

| 文件 | 来源 | 大小 | 用途 |
| --- | --- | --- | --- |
| `Crops.json` | `Data/Crops.json` | 36KB | 50 条作物定义（1.6 数据格式） |
| `FruitTrees.json` | `Data/FruitTrees.json` | 7.5KB | 8 条果树定义（键 = 树苗物品 id） |
| `Achievements.json` | `Data/Achievements.json` | 2KB | 39 条成就定义（里程碑玩法） |
| `Achievements.zh-CN.json` | `Data/Achievements.zh-CN.json` | 2.5KB | 成就官方中文版，与基础版键位逐条对齐 |
| `GiantCrops.json` | `Data/GiantCrops.json` | 5.5KB | 5 种巨型作物（花椰菜/甜瓜/南瓜贴图就在 `crops.png` 内；霜瓜/齐瓜在 `Cursors_1_6`） |

> Data/ 的语言变体只覆盖部分类型（Achievements/Boots/Bundles/Quests 等 11 种）；
> Crops、FruitTrees、Objects **没有** zh 变体，中文名一律走第 6 节的 Strings 派生链。

体积预算提示：`springobjects.png` 占近一半。若产物体积成为问题，优先做
**构建期裁剪子集**（只保留用到的物品 id 图标），而不是整表移除。

## 3. 构建管线如何消费

`scripts/build.mjs` 的 esbuild loader 全局生效，src 内直接 import 即可：

```ts
import CROPS_RAW from './assets/data/Crops.json';      // json loader → 内联 JS 对象
import CROPS_PNG from './assets/sprites/crops.png';    // png loader → dataURL 字符串
```

## 4. crops.png 切图公式（核心解析知识）

以下公式来自 2026-07 对贴图的像素扫描验证，是游戏资产格式事实，与新项目代码无关。

- 图为 256×1024 = 16px 网格 16 列 × 64 行；**两大列布局**：
  - 偶数 `SpriteIndex` → 左半 cols 0–7；奇数 → 右半 cols 8–15
  - `pairIdx = floor(si / 2)`，`baseRow = pairIdx * 2`（每个 SpriteIndex 占 2 行）
- 每种作物阶段数 `= phaseCount + 2`（`phaseCount = DaysInPhase.length`）：
  - `i = 0 .. pc-1` 生长阶段；`i = pc` 成熟可摘；`i = pc+1` 一次性作物为饱满待摘态、循环作物为已摘等待重生态
- 坐标：`col = colOffset + i`（`colOffset = si % 2 === 0 ? 0 : 8`）
  - 16px 单高阶段画在 `baseRow + 1`（底部主行）
  - 32px 双高阶段从 `baseRow` 起跨两行（`height = 32`）
- 双高判定（数据驱动）：
  - `IsRaised = true`（攀爬型）→ 全程双高
  - 成熟态（`i = pc`）与末态（`i = pc+1`）按 SpriteIndex 查附录集合

### 附录：双高 SpriteIndex 集合（像素扫描结论）

成熟态（i = phaseCount）双高：
`1, 5, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 20, 21, 24, 29, 30, 31, 32, 34, 36, 37, 38, 39, 40, 41, 42, 43, 44, 47, 49, 50, 51`

末态（i = phaseCount + 1）双高：
`0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24, 30, 31, 32, 34, 36, 37, 38, 39, 40, 41, 42, 43, 44, 47, 48, 49, 50, 51`

## 5. Crops.json 字段（1.6 格式）

以键 `273`（未碾米）为例，解析关心的字段：

```
Seasons: ["Spring"]          可种植季节
DaysInPhase: [1,2,2,3]       各生长阶段天数（长度 = phaseCount）
RegrowDays: -1               -1 = 一次性收获；>0 = 收获后再生周期
IsRaised: false              攀爬型（带支架、全程双高）
HarvestItemId: "271"         收获物物品 id（1.6 新增字符串 id，如 "Carrot"）
HarvestMethod: "Scythe"      收获方式（Scythe = 镰刀）
Texture: "TileSheets\\crops" 贴图键；当前 50/50 全部为标准作物贴图
SpriteIndex: 34              crops.png 中的索引（切图公式见上节）
```

## 6. 中文名派生链（待办）

三级链（与语言文件解耦，构建期一次性完成）：

```
Crops.json.HarvestItemId
  → Objects.json[id].Name            （内部英文名，Objects.json 694KB 不内联）
  → Strings/Objects.zh-CN.json[{Name}_Name]  （中文名）
```

设计：写 `scripts/derive-crop-names.mjs`（项目内）读取参考转储，生成瘦身的
`src/assets/data/crop-names.zh-CN.json`（仅 `收获物id → 中文名`，约 2KB）并提交。
参考转储只在重新生成派生文件时才需要。

注意：zh-CN 键有两种格式需双查——`{Green Bean}_Name`（带空格）与
`{GreenBean}_Name`（去空格），仍未命中时兜底英文名并打日志。

成就名不走派生链：`Achievements.zh-CN.json` 与基础版逐键对齐，格式为
`名称^描述^...` 的 `^` 分隔字符串，直接按下标/键取中文即可。

## 7. 参考层备查表（不内联，按需再升级）

| 资源 | 位置 | 大小 | 不内联原因 / 升级方式 |
| --- | --- | --- | --- |
| `Cursors.png` | `LooseSprites/` | 690KB / 704×2256 | 游戏主 UI 表（对话框、按钮、金币、图标）。太大；UI 优先用纯 CSS 还原星露谷风，确需原版部件时裁剪子集 |
| `Billboard.*.png` | `LooseSprites/` | 24KB / 338×512 | 日历整页图（含 zh-CN 版）。是整页非切片；做日历视图时仅作视觉参考 |
| `animations.png` | `TileSheets/` | 130KB | 浇水飞溅等动画帧，边缘需求 |
| `Craftables.png` | `TileSheets/` | 135KB | 大型打造物图标，暂无此玩法 |
| `Objects.json` | `Data/` | 694KB | 物品主表，**只作派生源**（见第 6 节），绝不内联 |
| `Bundles.json` + `Bundles.zh-CN.json` | `Data/` | 各 ~3KB | 社区中心收集包（含官方中文），若做"收集挑战"玩法时成对取用 |
| `WildTrees.json` | `Data/` | 36KB | 野生树数据，若做农场装饰树时取用 |
| `Fish.json` | `Data/` | 6.7KB | 钓鱼数据，无此功能 |
| `Portraits/`、`Characters/` | — | 数 MB | NPC 内容，与打卡无关 |
| `Fonts/`、`Maps/`、`Minigames/`、`Effects/`、`VolcanoLayouts/` | — | 大 | 与本插件无关 |

## 8. 运行时展示方案

标准 CSS sprite 切片（实现阶段按新项目结构重写，不复用旧类）：

```css
.sel {
  background-image: url(<dataURL>);
  background-size: calc(imgW * scale) calc(imgH * scale);        /* 整图缩放 */
  background-position: calc(-1 * col * 16 * scale) calc(-1 * row * 16 * scale);
  width: calc(16 * scale); height: calc(16 * scale);             /* 32px 双高改高度 */
  image-rendering: pixelated;                                     /* 整数倍缩放防糊 */
}
```
