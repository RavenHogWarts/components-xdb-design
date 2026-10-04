# 图鉴系统设计方案

需求：插件视图为主标签容器，本期实现「图鉴」一个主标签（主农场等后续扩展）；
图鉴内部按 sprites 分出二级分类标签；每张贴图的每个物品都能解析并展示。

前置文档：[assets-and-parsing.md](./assets-and-parsing.md)（资产分层、crops 切图公式、派生链）。

## 1. 已验证的贴图排版事实

全部经 `scripts/analyze-sheets.mjs`（pngjs 热力图扫描）验证或与数据互证：

| 贴图 | 尺寸 | 排版模型 |
| --- | --- | --- |
| `crops.png` | 256×1024 | 两大列布局（`baseRow = ⌊si/2⌋×2`，奇偶分左右半区）；**每阶段取完整 16×32 块**（单高阶段画在底行、双高跨两行，顶部透明），保证任何阶段不裁剪 |
| `fruitTrees.png` | 432×720 | 9 strip × 80px（`TextureSpriteRow` = strip 号）；权威矩形见 3.2 节（阶段格 + 四季树 + 树桩；果实 = 运行时画物品图标） |
| `springobjects.png` | 384×624 | 24 列 16px 网格；图标位 = (idx%24, ⌊idx/24⌋)，idx = Objects.json 的 SpriteIndex；约半满 |
| `Objects_2.png` | 128×320 | 1.6 新物品图标，8 列 16px 网格（`Objects_2` 贴图的物品同公式） |
| `weapons.png` | 128×144 | 源码 `WeaponDataDefinition`：`getSourceRectForStandardTileSheet(16,16)` → **8 列网格**；菜单索引 = `MenuSpriteIndex>−1 ?: SpriteIndex` |
| `Craftables.png` | 128×1472 | 源码 `Object.getSourceRectForBigCraftable`：**x=(idx%8)·16, y=⌊idx/8⌋·32**（16×32 格） |
| `tools.png` | 336×384 | 21 列 16px 网格；`SpriteIndex`/`MenuSpriteIndex` 均为 16×16 图标索引（连通域验证），MenuSpriteIndex = -1 时回退 SpriteIndex |
| `hoeDirt.png` | 192×64 | 源码 HoeDirt.draw 验证：**cols 0-3 = 干土 16 形态（4×4）**，cols 4-7 = 已浇灌（+64px），cols 8-11 = 稻田水（+128px） |
| `grass.png` | 66×240 | 源码 Grass.draw 验证：**15×20 格**，4 变体列（whichWeed×15）× 12 行（grassSourceOffset 每 20px：普通草春/夏/秋/冬、type2/4/5/6、1.6 花草春/夏/秋/冬） |
| `houses.png` | 272×432 | 房屋大块纵向堆叠（x16 起、每级 144×144） |

> 动物贴图（chicken/cow/cat/dog）已按需求移出图鉴与内联资产；如后续恢复，
> 源文件在参考转储 `Animals/`，帧网格：鸡 32×16、牛/猫/狗 32×32。

命名数据链（全部已就位或派生即可得）：

- 作物/果树/物品：`Objects.json.Name → Strings/Objects.zh-CN.json[{Name}_Name | 去空格_Name]`
- 工具：`Tools.json（含 Texture/SpriteIndex）+ Strings/Tools.zh-CN.json`（已复制，`Copper Axe → Axe_Copper_Name` 去空格规则同款）
- 成就：`Achievements.zh-CN.json` 直读（已复制）

## 2. 代码结构

```
src/
├── sprite/                    # 解析层（纯函数，输入内联数据输出条目）
│   ├── types.ts               # SpriteEntry / SheetSpec / SheetId（含 category 大类）
│   ├── registry.ts            # 注册表 + getAlmanacCategories（大类→子类分组）
│   ├── crops.ts               # Crops.json → 50 作物（含阶段 filmstrip）
│   ├── fruitTrees.ts          # FruitTrees.json → 8 树（阶段/四季/树桩/果实）
│   ├── objects.ts             # objects-index → 物品 + 物品 1.6（Objects_2）
│   ├── tools.ts               # Tools.json → 37 工具
│   ├── weapons.ts             # weapons-index → 67 武器
│   ├── craftables.ts          # craftables-index → 182 大型制造物
│   ├── buildings.ts           # 11 栋农场建筑（整图 src）
│   └── static.ts              # hoeDirt / grass / houses 静态条目
├── components/
│   ├── MainTabs.tsx           # 主标签容器（注册表驱动，本期仅「图鉴」）
│   ├── AlmanacView.tsx        # 图鉴页：大类标签 + 子类标签 + 搜索 + 行列表
│   └── SpriteCell.tsx         # 公共切片渲染（background-position + pixelated）
└── view.tsx                   # createViewRenderer → <MainTabs/>
```

核心抽象（`sprite/types.ts`）：

```ts
interface SpriteRect { x: number; y: number; w: number; h: number }
interface SpriteEntry {
  key: string;              // 唯一键
  name: string;             // 中文名
  sub?: string;             // 副文本（季节/分类/描述）
  sheet: SheetId;
  rect: SpriteRect;         // 在贴图上的切片矩形
}
interface SheetSpec {
  id: SheetId;
  label: string;            // 二级标签名：作物/果树/物品/工具/耕地/草丛/建筑
  png: string;              // import 得到的 dataURL
  imgW: number; imgH: number;
  entries(): SpriteEntry[]; // 运行时派生，模块级缓存
}
```

条目在**运行时**派生（所有数据已内联进 bundle，map 一遍即得，零 IO、零构建复杂度）；
构建期脚本只负责"翻译 + 瘦身"两类数据准备（见第 4 节）。

## 3. 各分类页的条目派生

### 3.1 作物（crops.png）
每种作物 **1 行**：卡面 = 最饱满阶段 + 中文名 + 季节/天数副文本；行内 filmstrip 展示
全部状态。切片规则（`derive-catalog.mjs` 像素实测，输出 `crop-faces.json`）：

- **状态数按像素实测**，不从 DaysInPhase 推（葡萄/啤酒花/咖啡为 8 态 = pc+3，
  防风草等为 pc+2）；在作物所属 8 列窗口内取最右非空列。
- **巨型作物排除**：GiantCrops.json 的 TexturePosition 指出巨型花椰菜/甜瓜/南瓜在
  crops.png 的 (112/160/208, 512)（3×3 tile，含阴影溢出至 row 35）→ cols 7-15 ×
  rows 32-35 从列计数中剔除（否则未碾米会多出 2 个假状态）。
- **卡面阶段**：再生作物（RegrowDays>0）取倒数第二格（结果实态）；一次性作物取
  最后一格（完全绽放态）。
- **花类（TintColors 非空：郁金香/蓝爵/虞美人/夏季亮片/玫瑰仙子）**：末列是白色
  花冠，需与倒数第二格（植株）按官方 TintColors 乘法着色合成才是完整的花——
  构建期用 pngjs 逐色合成 PNG dataURL 存入 `crop-faces.json`（卡面取第一色，
  胶片条末尾追全部颜色变体；虞美人 3 色、郁金香 6 色、蓝爵 5 色、夏季亮片 6 色、
  玫瑰仙子 6 色）。

### 3.2 果树（fruitTrees.png）
权威布局来自本地 1.6 反编译源码 `refer/StardewValleyDecompiled/.../FruitTree.cs`
的 `draw()`（wiki 无坐标细节）。每 strip 80px（`TextureSpriteRow` = strip 号）：

- 阶段 0-3：48×80 格 @ x=0/48/96/144
- 成熟树四季：48×80 格 @ x=192(春)/240(夏)/288(秋)/336(冬)，各 = 树冠 48×64 + 树干 48×16
- 落叶粒子：8×8 @ (384+season·16, k·80)（粒子特效，图鉴不展示）
- 树桩：48×32 @ (384, k·80+48)
- **果实不在这张贴图**：游戏运行时把果实**物品图标**（springobjects）画上树冠
  （`FruitTree.draw` 的 fruit 循环用 `ItemRegistry.GetData(fruit).GetSourceRect()`）

图鉴实现：卡面 = 构建期合成的"夏季挂果树"（`tree-faces.json`：夏季树格 + 果实
图标贴树冠中上）；胶片条 = 4 阶段 + 四季树 + 树桩 + 果实图标（独立 src 格）。
树名链同前（DisplayName 占位符 → zh）。

### 3.3 物品（springobjects.png）
全量派生：`objects-index.json` 的每个数字 id → 卡片（位 = SpriteIndex 网格公式），
按 Category 分类码分组显示小标题；`Texture` 非 null（图标在其它表）的条目跳过。
这是"每一个物品都要能解析"的主体，约 600-700 张卡，**必须带搜索框**（按 name 过滤）。

### 3.4 工具（tools.png）
37 条，位 = 21 列网格公式，名 = `Tools.zh-CN.json`（去空格双查 + 英文兜底）。

### 3.5 自然（hoeDirt + grass，静态）
耕地 48 格 = 干土/已浇灌/稻田水浇灌 × 16 形态（列组语义，源码验证）；草丛 48 格 =
12 行 × 4 变体（15×20 格）。

> 源码审查结论（refer/StardewValleyDecompiled，1.6）：
> - 物品：`ObjectDataDefinition.GetSourceRect` → `getSourceRectForStandardTileSheet(16,16)`
>   = 24 列网格 × SpriteIndex，与实现一致；`ColorOverlayFromNextIndex` 仅 15 项
>   （5 种花已处理，其余多为已跳过的 Objects_2 物品；仅鱼籽 2 项图标缺色罩，已知取舍）。
> - 工具：`ToolDataDefinition` 菜单索引 = `MenuSpriteIndex>−1 ?: SpriteIndex`、
>   `getSquareSourceRectForNonStandardTileSheet` = idx·16 % 336 → **21 列网格**，与实现一致。
> - 作物：`Crop.cs` 主公式 = 16×32 块 + 奇偶半区（+128）+ `Math.Min(240,…)` 封顶，
>   与实现一致；花冠 = 植株列 +1；混合种子为普通 crop（si=23 块 8 态）；
>   野葱/姜等 forage 走物品图标，不在本图。
> - 农舍：houses.png 3 级 144×144（x16 起），游戏内由建筑绘制系统使用。

### 3.6 建筑（houses.png / Buildings/*.png）
- 农舍：3 级 3 卡（144×144 纵向堆叠，x16 起；x0-15 为烟囱 DrawLayer）。
- 农场建筑：**24 类全量**（Buildings.json 除 Farmhouse），卡面 ≠ 整图——按源码分离
  （2026-10-03 修正，权威依据 `Building.getSourceRect()` + Buildings.json）：
  - 卡面 = `SourceRect`（空则整图）；畜棚/鸡舍族为 (0,0,112/96,112)，磨坊仅 64×128。
  - 组成区块（胶片条，带悬停说明）：**Barn 族 4 个动物门状态 / Coop 族 2 个**（y112
    底条，来自 DrawLayers）；**磨坊** 风车帆叶 10 帧格 + 传动轴 7 帧（x64 区）；
    **温室** 完好(sr Y=160)/破损(Y=0)/阴影(112,0,128,144)；**联机小屋** 3 升级梯队
    横排（Stone Cabin 240 = 3×80）；**祝尼魔屋** 四季外观（季节×48,0,48,64）；
    **鱼塘** 主塘(0,0,80,80)/后沿/水下基底/波光（FishPond.draw）；**宠物碗**
    本体(32,0,32,32)/盛水态(X+W)/背景层。
  - 未被源码引用的遗留区（Mill 右下、FishPond 右下、Pet Bowl 下三行）不展示。
  - 命名链 Buildings.json[type].Name 占位符 → Strings/Buildings.zh-CN.json；
    条目键 `building-<type>`（里程碑徽章引用同键）。

### 3.7 武器（weapons.png）与大型制造物（Craftables.png）
- 武器 67：8 列网格 16×16，副文本 = 伤害区间（MinDamage-MaxDamage）。
- 大型制造物 182：`getSourceRectForBigCraftable` 8 列网格 **16×32**，副文本 = 售价。

### 3.8 物品 1.6（Objects_2.png）
89 条 1.6 新物品（异界晶石/卡利科三花蛋/混合花卉种子/各色制品等），8 列网格 16×16，
命名/分组与基础物品同链。

### 3.9 动物（Animals/*.png，42 张帧表，Error.png 除外）
帧尺寸来自 **Data/FarmAnimals.json**（`SpriteWidth/SpriteHeight`，源码要求贴图宽
= 4×帧宽）：鸡类/鸭/兔/恐龙 **16×16**（鸭 64×224 = 4×14 帧），牛/山羊/绵羊/猪/鸵鸟
**32×32**；猫/狗/宠物龟为 `Cat.cs`/`Dog.cs` 的 `AnimatedSprite(0, 32, 32)`；马为
`Horse.cs` 同款 32×32（224×128 = 7×4 帧，唯一横向帧表）。幼崽贴图经
`FarmAnimals.json.BabyTexture` 关联、帧尺寸与成年一致；绵羊·剪毛后 =
`HarvestedTexture`。页签按物种归组（同物种的成年/幼年/花色合并为一个子类页，
共 13 页：鸡/鸭/兔子/恐龙/牛/山羊/绵羊/猪/鸵鸟/马/猫/狗/宠物龟）：每个变体一个
条目，卡面 = 第 0 帧，胶片条 = 全部帧；条目经 `SpriteEntry.source` 指向各自的
贴图文件（`src/assets/sprites/`，文件名与游戏 Animals/ 原文件一致）。宠物花色变体（猫/狗/龟）在 Pets.json 无命名，
以"花色 N"展示。

### 3.10 人物创建素材（Characters/Farmer/，src/sprite/farmer.ts）
为后续"捏人"功能做的素材图鉴化，单独大类 `Characters`，7 个子类页：
**性别**（farmer_base / farmer_girl_base，288×672，16×32 帧，下/侧/上 = y+0/+32/+64，
左侧 = 侧向翻转）、**肤色**（skinColors.png 3×24，每行暗/中/亮替换底图标记色
260-262）、**发型**（基础 56 = hairstyles.png 高/96×8 个 16×96 列条 + HairData.json
扩展（仅 id≥0，hairstyles2.png 按 tileX/tileY 定位，usesUniqueLeftSprite 时第 4 行
左侧专用帧））、**配色**（发/眼/裤共用 ColorPicker HSV 三条 24 段滑杆，无贴图——
按源码 HsvToRgb 运行时生成 24 色相 × 8 明度 SVG 色板，饱和 0.9）、**上衣**
（Shirts.json 创建可选 112 件，shirts.png 每款 8×32 列条 = 前+0/侧+8/上+24，
x+128 为染色层；中文名来自 Strings/Shirts.zh-CN.json）、**裤子**（Pants.json 创建
可选 4 条，pants.png 每款 192×688 块 = 男左 96/女右 96，帧位置同底图）、**配件**
（accessories.png 30 个 16×32 前/侧，0-7 画于发下、6-7 胡子按发色染色、8+ 发上）。
数据经 `scripts/derive-farmer.mjs` 输出 `farmer-index.json`。配色/上衣等小格
（≤8px）胶片条自动用 4× 缩放（AlmanacView 按最大格宽选档）。底图调色板换色
（袖 256-258/肤 260-262/鞋 268-271/眼 276-277）是"捏人"渲染期逻辑，本期不涉及。

## 4. 构建期派生脚本 `scripts/derive-catalog.mjs`

输入本机参考转储（gitignored），输出提交进 git 的瘦身数据：

| 输出 | 内容 | 预估 |
| --- | --- | --- |
| `src/assets/data/crop-names.zh-CN.json` | 收获物 id → 中文名 | ~2KB |
| `src/assets/data/tree-names.zh-CN.json` | 果树内部键 → 中文名 | <1KB |
| `src/assets/data/tree-faces.json` | 果树挂果卡面（夏季树+果实图标合成）+ 果实图标 dataURL | ~60KB |
| `src/assets/data/crop-faces.json` | 作物卡面阶段/状态数 + 花冠着色合成 dataURL | ~20KB |
| `src/assets/data/objects-index.json` | 物品 → `{ idx, zh, cat, price, t? }`；t='o2' 为 Objects_2（1.6 新物品，8 列网格），其余 springobjects（24 列） | ~50KB |
| `src/assets/data/craftables-index.json` | 大型制造物 `{ idx, zh, price }` | ~10KB |
| `src/assets/data/weapons-index.json` | 武器 `{ idx, zh, damage }` | ~4KB |
| `src/assets/data/buildings-index.json` | 复制建筑文件 → 官方中文名 | <1KB |

中文名键双查：`{Name}_Name` → 去空格 `_Name` → 兜底英文名。Category 分类码 →
中文类名映射在脚本内枚举校对（-75 蔬菜、-79 水果、-80 花、-4 鱼、-12 矿……以实测为准）。

## 5. UI 与样式

- **MainTabs**：顶部标签栏，注册表驱动（`[{id:'almanac', label:'图鉴', render}]`），
  本期一项；后续「农场」等直接注册。星露谷风纯 CSS（棕木色系 + 圆角描边），
  不切 Cursors.png。tab 选中状态本期存 React state，需要记忆时再持久化进 viewDefinition。
- **图鉴两级分类**：**大类 = Content (unpacked) 文件夹名**（TileSheets / Maps /
  TerrainFeatures / Buildings / Animals，`tab2` 深色胶囊），大类下按资源分子类（`chip`）：
  - TileSheets：作物 / 果树 / 工具 / 武器 / 大型制造物
  - Maps：物品（springobjects）/ 物品 1.6（Objects_2）
  - TerrainFeatures：耕地 / 草丛
  - Buildings：农舍 / 农场建筑
  - Animals：白鸡/棕鸡/蓝鸡/虚空鸡/金鸡/鸭/兔子/恐龙/白牛/棕牛/山羊/绵羊/猪/鸵鸟/猫/狗
- **行列表**：一个物品一行（`itemRow` = 精灵 + 名称/副文本 + 胶片条），内容完整显示
  （名称/副文本换行不截断）；胶片条按总宽预算自动选 2×/1× 缩放并允许换行。
  `image-rendering: pixelated`。
- 所有 class 带 `stardewValleyLog--` 前缀；本期为纯浏览图鉴，"解锁/收集进度"留作后续
  （进度可存 habit yaml 文件，接口上 SpriteEntry.key 已可作持久化键）。

## 6. 实施顺序

1. `derive-catalog.mjs` → 生成并提交两个派生 json
2. `src/sprite/`（types → registry → 各解析模块）
3. `src/components/`（SpriteCell → AlmanacView → MainTabs）+ `view.tsx` 接线
4. `style.css`
5. `pnpm build StardewValleyLog` + validator + 用 `analyze-sheets.mjs` 对拍抽样切片

## 7. 待定与风险

- 鱼籽 2 项（Roe/Aged Roe）图标缺 ColorOverlayFromNextIndex 色罩（已知取舍，见 3.5 审查结论）
- 候选未内联资源：animations.png（浇水动画）、家具表（体积大）、Cursors.png（UI 表）、马匹
- 体积：产物 ~1.9MB（内联 30+ 张贴图 + 合成数据）；行列表按子类分片渲染，无虚拟滚动需求
