# 星露谷风格打卡XDB方案

**Date**: July 2, 2026 at 01:01 PM
**Turns**: 3
**Source**: [Gemini Chat](https://gemini.google.com/app/7dbb3b248aa2b618)

---

## Turn 1

### 👤 User

*[This turn includes uploaded images]*

![MD 图标](assets/img-001.png)

![所上传图片的预览图](assets/img-002.jpg)

![所上传图片的预览图](assets/img-003.png)

xdb-plugin-skills，目前我想制作一个星露谷风格的打卡xdb，从星露谷游戏解包的素材是Spritesheets，后缀是png，帮助我来分析给出方案，且需要帮助在ts中如何使用这些素材，

### 🤖 Assistant

这套星露谷风格的打卡 UI 设计非常精美，将枯燥的习惯追踪变成了直观的“种田”体验。这种重度自定义排版、强视觉交互的场景，正是 XDB 插件系统的绝佳用武之地。
从你的线框图和最终 UI 来看，我们需要一个全局的看板容器，结合独立的数据卡片。以下是为你梳理的 XDB 插件架构方案以及在 TypeScript 中处理 Spritesheet 的具体技术实现。

### 一、 XDB 插件架构设计方案
为了实现这个界面，我们需要读取底层行数据（打卡项目）并渲染为一个完整的面板，因此最适合使用的是 **registerDatabaseView** 扩展点。

#### 1. 数据模型映射 (Data Mapping)

- **行 (Row)**：每一行代表一个“打卡项目”（如：锻炼、阅读、日记）。
- **属性 (Fields)**：
  - `HabitName` (Text): 习惯名称。
  - `Icon/SeedType` (Select/Text): 对应的作物类型（决定加载哪组 Sprite）。
  - `Status_YYYY_MM_DD` (Checkbox): 每日的打卡状态（或者用一个 JSON 字段统一存储历史记录，便于计算连续打卡天数来决定作物生长阶段）。

#### 2. 生命周期与渲染逻辑

- **install(ctx)**：只负责注册视图，不做任何 DOM 操作。
- **onUpdate(props)**：这是核心渲染函数。由于它会被反复调用，且每次调用都代表数据或配置发生了变化，你需要在这里实现**幂等渲染**。
  - **清空重绘**：最简单的做法是每次触发 `onUpdate` 时，使用 `props.container.replaceChildren()` 清空容器，然后重新生成整个“农场” DOM。
  - **模块化构建**：将 UI 拆分为 `renderSummaryBoard()`（左上角今日记录）、`renderEnvironment()`（背景、房子、太阳）和 `renderCropGrid(props.viewData)`（中间的田地卡片）。
- **交互 (Update)**：当用户点击田地块右上角的复选框时，调用 XDB 提供的 API（如 `props.api.updateRow(...)`）更新对应行的数据。这会自动触发新的 `onUpdate` 使得作物“生长”。

### 二、 TypeScript 中解析和使用 Spritesheet
星露谷解包的素材通常是将几十上百个小图标（如不同阶段的农作物、工具）拼合在一张巨大的透明 PNG 图片上。在 DOM 渲染（非 Canvas）的环境下，最优雅且性能最好的方式是使用 **CSS 背景定位 (CSS Sprite)** 技术。
你需要知道每个 Sprite 在大图中的**网格尺寸**（比如 16x16 或 32x32 像素）。

#### 1. 封装 Spritesheet 助手类 (TypeScript)
我们可以编写一个工具类，输入 Spritesheet 的 Base64 或本地路径，通过指定行列坐标来切出特定的图像。

```typescript
// sprite-helper.ts
export class SpriteSheet {
  private imageUrl: string;
  private spriteWidth: number;
  private spriteHeight: number;

  /**
   * @param imageUrl 图片的 URL 或 Base64 编码
   * @param spriteWidth 单个切图的宽度 (px)
   * @param spriteHeight 单个切图的高度 (px)
   */
  constructor(imageUrl: string, spriteWidth: number = 16, spriteHeight: number = 16) {
    this.imageUrl = imageUrl;
    this.spriteWidth = spriteWidth;
    this.spriteHeight = spriteHeight;
  }

  /**
   * 生成对应坐标图标的内联 CSS 样式
   * @param col 列索引 (从 0 开始)
   * @param row 行索引 (从 0 开始)
   * @param scale 缩放倍数 (星露谷原生像素较小，通常需要放大)
   */
  public getStyle(col: number, row: number, scale: number = 2): string {
    const offsetX = -(col * this.spriteWidth);
    const offsetY = -(row * this.spriteHeight);
    
    // 返回直接可用于 DOM element.style.cssText 的字符串
    return `
      display: inline-block;
      width: ${this.spriteWidth * scale}px;
      height: ${this.spriteHeight * scale}px;
      background-image: url('${this.imageUrl}');
      background-position: ${offsetX * scale}px ${offsetY * scale}px;
      background-size: auto; /* 如果需要整体缩放背景图，可以在这里结合百分比计算，但通常配合 image-rendering 更好 */
      image-rendering: pixelated; /* 保持像素风不模糊 */
    `;
  }
}

```

#### 2. 在 XDB 视图中的实际应用
在你的 XDB 插件文件（`*.xdb.js` 的编译前 TS 源码）中，你可以这样渲染一个特定阶段的作物：

```typescript
// 假设星露谷农作物大图已转为 Base64 或在 vault 某处
const CROPS_SPRITESHEET_URL = 'data:image/png;base64,iVBORw0KGgo...'; 
const cropsSprite = new SpriteSheet(CROPS_SPRITESHEET_URL, 16, 16);

// ... 在 onUpdate(props) 中渲染单个打卡田地时 ...

function renderCropIcon(habitStreak: number, cropTypeRow: number): HTMLElement {
  const iconDiv = document.createElement('div');
  
  // 假设连续打卡天数决定生长阶段 (0 到 5)
  // cropTypeRow 决定是哪种植物 (比如 0是防风草, 1是土豆)
  const growthStage = Math.min(habitStreak, 5); 
  
  // 获取对应的 CSS Sprite 样式并应用 (放大 3 倍)
  iconDiv.style.cssText = cropsSprite.getStyle(growthStage, cropTypeRow, 3);
  
  return iconDiv;
}

```

#### 3. 关于图片素材的加载策略
因为你需要编写的是 `*.xdb.js` 插件：

- **方案 A (推荐，单文件闭环)**：写一个简单的 Node 脚本，在构建 (build) 你的 TS 代码时，将这些 PNG 图片转换为 Base64 字符串，直接 hardcode 注入到你的代码中。这样你的插件只有一个 `.js` 文件，极度便携。
- **方案 B (适合海量素材)**：如果解包素材太大（几 MB），Base64 会导致插件加载变慢。你可以将素材放在 Vault 的特定文件夹（如 `/.obsidian/plugins/xdb-stardew-assets/`），然后利用 Obsidian 的内部协议 `app.vault.adapter.getResourcePath(file)` 获取本地渲染路径传入 `SpriteSheet`。
整个 UI 的状态驱动完全可以依靠 XDB 强大的 `onUpdate` 机制来完成，你的核心精力只需要放在从打卡数据到“生长阶段”的计算映射上。
在数据结构层面，你目前打算如何存储每个习惯的历史打卡记录？是每天都在数据库中新增一列 Checkbox，还是打算用一个单独的 Text 字段保存类似 JSON 的历史数组？

## Turn 2

### 👤 User

方案B，数据层面，打卡记录可以放在obsidian的日记文件中，YYYY-MM-DD.md中。以一个约定的格式来行内存储

### 🤖 Assistant

采用方案 B 配合日记文件（Daily Notes）存储，是一个非常典型的本地化、去中心化架构。这种方式不仅保证了数据的长期可读性，也完美契合了双链笔记的生态。
在 XDB 插件体系下，这个方案的实现需要将底层的文件解析与视图层的状态渲染结合起来。以下是具体的实施路径和 TypeScript 代码参考：

### 一、 方案 B：加载本地素材 (Vault Asset Loading)
为了避免 Base64 造成插件文件过大，我们可以将 Spritesheet 统一存放在 Vault 的特定目录下（例如 `Assets/stardew-ui/crops.png`）。
在 Obsidian 环境中，DOM 无法直接读取本地磁盘路径，必须将其转换为 `app://local/...` 或 `app://obsidian/...` 形式的虚拟 URL。你可以通过 Obsidian API 获取：

```typescript
// 在插件外部或 install 的闭包中封装一个工具函数
function getVaultAssetUrl(app: any, vaultPath: string): string | null {
  const file = app.vault.getAbstractFileByPath(vaultPath);
  if (file) {
    return app.vault.adapter.getResourcePath(file);
  }
  console.warn(`未找到素材文件: ${vaultPath}`);
  return null;
}

// 使用示例：
const cropsSpriteUrl = getVaultAssetUrl(app, 'Assets/stardew-ui/crops.png');
// 然后将这个 URL 传入我们之前设计的 SpriteSheet 类中

```

### 二、 数据源定义：日记行内存储约定
为了让 XDB 能高效解析，建议使用 **Dataview 行内字段格式**（Inline Fields）或 **标准任务列表**。考虑到打卡通常是布尔值，行内字段在语义上最清晰：
**约定格式示例 (2026-06-01.md):**

```markdown
# 今日打卡
[锻炼:: true]
[阅读:: true]
[日记:: false]

```

### 三、 XDB 数据流与渲染架构
当你使用 `registerDatabaseView()` 注册视图时，宿主会将查询到的数据通过 `props.viewData` 传递给 `onUpdate`。
假设你的 XDB 数据库视图已经配置为**查询你的日记文件夹**，那么在 `onUpdate(props)` 中，你将收到按日记文件排列的行数据。

#### 核心逻辑：从 FileIndex 提取连续打卡记录
在 `onUpdate` 中，你需要遍历这些文件数据（`$item` 对应 `FileIndex`），提取对应的习惯状态，并计算“作物生长阶段”（即连续打卡天数）：

```typescript
// 伪代码演示 onUpdate 中的数据处理逻辑
onUpdate(props) {
  props.container.replaceChildren(); // 清空旧视图，保证幂等性

  // 1. 获取所有日记行数据 (假设没有分组，都在第一个 group 里)
  const rows = props.viewData?.groups?.[0]?.rows ?? [];

  // 2. 按日期对文件进行排序 (假设日记文件名为 YYYY-MM-DD.md)
  const sortedRows = rows.sort((a, b) => {
     // $item 代表 FileIndex
     return a.$item.basename.localeCompare(b.$item.basename); 
  });

  // 3. 计算特定习惯的连续打卡天数 (Streak)
  const calculateStreak = (habitKey: string) => {
    let streak = 0;
    // 从最近的一天往前倒推
    for (let i = sortedRows.length - 1; i >= 0; i--) {
      const fileData = sortedRows[i].$item;
      // 假设 XDB/Dataview 已将行内字段解析到 frontmatter 或 fields 中
      const isCompleted = fileData.fields?.[habitKey]; 
      
      if (isCompleted) {
        streak++;
      } else {
        break; // 一旦中断，停止计算
      }
    }
    return streak;
  };

  // 4. 渲染具体的作物田地
  const exerciseStreak = calculateStreak('锻炼');
  const cropElement = renderCropIcon(exerciseStreak, 0); // 0 代表比如防风草的行号
  
  // ... 将 cropElement 挂载到 props.container ...
}

```

### 四、 状态更新机制
当用户在 XDB 视图中点击田地块（完成今日打卡）时，你需要修改当天的日记文件。
你可以通过 `props.api` 提供的接口更新当前行[cite: 1]，或者直接调用 Obsidian 的 `app.vault.process(file, callback)` 来替换文本。修改文件后，XDB 会监听到文件变化，并自动重新触发 `onUpdate`，完成作物的“生长”动画[cite: 1]。
在具体解析日记内容时，你是倾向于直接利用 XDB 底层（通常依赖 Dataview）解析好的对象（如 `$item.fields`），还是打算自己在 `onUpdate` 中用正则或 JsQuery 去读取和过滤原始文本？

## Turn 3

### 👤 User

Spritesheet的处理有没有什么npm包

### 🤖 Assistant

在 npm 生态中，处理 Spritesheet 的包非常多，但我们需要根据你的具体使用场景（**在 Obsidian 的 XDB 插件中，基于 DOM 进行渲染，且素材已经是拼合好的大图**）来进行筛选。
大多数 Spritesheet 相关的 npm 包分为两大类，以下是为你梳理的适用方案及利弊分析：

### 一、 运行时渲染辅助包（Runtime Rendering）
这类包用于在代码运行时解析和控制 Sprite。但需要注意的是，很多专门的 Sprite 库是基于 Canvas 或 WebGL 的（比如 `pixi.js`），这对于一个 XDB 视图插件来说**过于沉重（Overkill）**。
如果你一定要在 DOM 层面使用 npm 包来管理，可以考虑以下轻量级选择：

- **sprite-animator / simple-sprite-animator**
  - **用途**：主要用于通过 JavaScript 控制 DOM 元素的 `background-position` 来实现帧动画。
  - **适用场景**：如果你不仅想静态展示农作物，还想让它们有“随风摇摆”的动态效果。
  - **缺点**：对于纯静态的阶段展示来说，引入第三方库的性价比不高。
- **texturepacker-core (配合 JSON 框架)**
  - **用途**：很多星露谷解包素材如果经过 TexturePacker 重组，会附带一个 `.json` 或 `.xml` 描述文件（记录每个小图的 `x, y, width, height`）。相关的解析包可以帮你直接通过名字（如 `crop_potato_stage_1`）来获取坐标，而不是手动算格子。

### 二、 构建时工具包（Build-time Tools）
如果你手里的星露谷素材是**散碎的小图**，或者你想把不同目录下的素材（农作物、建筑、UI 边框）重新拼合成一张专门针对你插件优化的 Spritesheet，这类包是必备的：

- **spritesmith**
  - **用途**：最经典的 Node.js 精灵图生成工具。
  - **怎么用**：在你的插件开发环境中写一个构建脚本，它会将指定文件夹下的所有 `.png` 合并成一张大图，并自动生成包含坐标信息的 JSON 或 CSS 文件。
- **svg-sprite** (如果是矢量图重绘)
  - 如果你后期打算将像素风转换为 SVG 矢量图，这个包可以帮你把所有 SVG 打包成一个 `<symbol>` 集合，非常适合现代 Web 和 Obsidian 渲染。

### 三、 为什么在 XDB 插件中更推荐“手搓”类？
针对你目前的架构，**强烈建议不使用任何运行时的 npm 依赖来处理静态坐标映射**，原因如下：

1. **插件体积与性能**：Obsidian 插件（包括 XDB 扩展）应当尽可能保持轻量。引入 npm 包会增加打包后的 `*.xdb.js` 体积，每次 `onUpdate` 触发时也会增加宿主的执行开销。
2. **网格规律极强**：星露谷的素材绝大多数是极其标准的 16x16 或 32x32 网格（Grid-based）。这种高度规律的图片，根本不需要复杂的解析逻辑，纯数学计算 `(列数 * 宽度, 行数 * 高度)` 是最高效的。

#### 进阶技巧：如何用纯 CSS 实现 Sprite 动画
如果你想不用 npm 包，又想让 UI 里的元素（比如村口走动的小人）动起来，可以直接利用 CSS 的 `steps()` 函数注入到你的 XDB 视图中：

```typescript
// 在你的 TS 工具类中生成带有动画的 CSS 字符串
public getAnimatedStyle(row: number, frames: number, speedMs: number = 800): string {
    const offsetY = -(row * this.spriteHeight);
    const animationName = `play-row-${row}`;

    return `
      display: inline-block;
      width: ${this.spriteWidth * 2}px;
      height: ${this.spriteHeight * 2}px;
      background-image: url('${this.imageUrl}');
      background-position: 0px ${offsetY * 2}px;
      background-size: auto;
      image-rendering: pixelated;
      animation: ${animationName} ${speedMs}ms steps(${frames}) infinite;
    `;
}

// 注意：需要将对应的 @keyframes 注入到页面的 <style> 标签中，
// 或者通过 XDB 的 registerStyleSheet 扩展点统一注册。

```
总结来说，如果是在**开发构建阶段**整合图片，用 `spritesmith`；如果在**运行阶段**切图渲染，依靠原生的 TypeScript 工具类（配合 CSS 的 `background-position`）是目前 Obsidian XDB 插件开发中最稳妥、性能最优的方案。

---

*Exported from [Voyager](https://github.com/Nagi-ovo/gemini-voyager)*  
*Generated on July 2, 2026 at 01:01 PM*