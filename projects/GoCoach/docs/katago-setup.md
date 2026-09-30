# KataGo 安装指南（跨平台·按 Releases 实测产物编写）

> 基于官方 Releases 实际产物清单分析（2026-09 查证，最新 v1.18.2 / 全后端 v1.18.1）。
> 插件只需要两样：**katago 可执行文件路径** + **模型文件路径**；config 由插件自动生成。

## 一、先看懂产物体系（避坑）

### 版本选择的坑

| 版本 | 发布 | 内容 |
| --- | --- | --- |
| **v1.18.2**（最新 tag） | 2026-08-30 | **只有 CUDA 版**（Turing 显卡提速修复） |
| **v1.18.1** | 2026-08-24 | **全后端**：eigen / opencl / cuda / trt / rocm / onnx 共 66 个产物 |
| v1.18.0 | 2026-08-22 | 全后端（新增 ROCm、ONNX 后端的首版） |

**结论：非 NVIDIA 用户请直接下 v1.18.1**（Releases 页选该 tag 展开 Assets），不要看到 v1.18.2 是 latest 就在里面找 eigen/opencl——没有。

### 文件名解读

`katago-v1.18.1-<后端>-<平台>-<架构>[+bs50].zip`

- **后端**：`eigen` / `eigenavx2` / `opencl` / `cuda<版本>-cudnn<版本>` / `trt<版本>-cuda<版本>` / `rocm<版本>-gfx<家族>` / `onnx-openvino<版本>` / `onnx<版本>-directml`
- **`+bs50`**：支持最大 50×50 棋盘——19 路用不到，**一律下不带 +bs50 的**
- **产物大小规律**：eigen/opencl ≈ 6MB；cuda ≈ 9MB（不含 cuDNN 运行库）；directml ≈ 22MB（自带运行库）；openvino ≈ 83MB（自带）；rocm ≈ 168–531MB（全家桶，按显卡家族分包）

## 二、怎么选（决策树）

```
你的显卡？
├─ 无独显 / 纯 CPU ──────────── eigenavx2（近 10 年 CPU 都支持 AVX2）
│                                └─ 太老的 CPU（无 AVX2）→ eigen
├─ NVIDIA ──────────────────── 想省心 → onnx-directml（22MB 免依赖，任意 DX12 卡）
│                                追求最强 → cuda / trt（见 Windows 节的 DLL 注意事项）
├─ AMD ─────────────────────── RX 9000 系(RDNA4) → rocm-gfx120X
│                                RX 7000 系/新 APU(RDNA3) → rocm-gfx110X
│                                RX 6000 系(RDNA2) → rocm-gfx103X
│                                Ryzen AI 300 APU → rocm-gfx1151
│                                懒得对号 → onnx-directml 兜底
├─ Intel ───────────────────── 核显/NPU → onnx-openvino；独显 → directml
└─ macOS（Apple Silicon/Intel）→ 不下 zip！brew install katago（Metal 后端）
```

**性能排序**（同显卡）：trt ≈ cuda > rocm > Metal > directml ≈ openvino > opencl > eigen。
**省心排序**：eigenavx2 = directml（零依赖）> openvino/rocm（包大但自带）> cuda/trt（可能补运行库）> opencl（老显卡兼容层）。

## 三、Windows 安装

### 通用步骤

1. 到 [Releases](https://github.com/lightvector/KataGo/releases) 选 **v1.18.1**，按上表选 zip，解压到如 `C:\katago\`；
2. 下载模型（见第五节）放同目录；
3. `Win+R` → `cmd`：
   ```
   cd C:\katago
   katago.exe version
   ```
   出版本号即成功。GPU 版首跑会自动探测硬件并 tune（第一次几十秒属正常）。

### 各后端注意事项

| 后端 | 注意 |
| --- | --- |
| **eigen / eigenavx2** | 零依赖。先试 eigenavx2，若报非法指令（CPU 无 AVX2）换 eigen。配 b6/b10 小模型，CPU 每手数秒可用 |
| **onnx-directml** | 零依赖，任意 DirectX 12 显卡（N/A/I 通吃，含多数核显）。性能中等，胜在省心 |
| **onnx-openvino** | Intel 平台优化（CPU/核显/NPU），83MB 自带运行库 |
| **cuda** | zip 仅 9MB **不含 cuDNN**。启动若报缺 `cudnn64_*.dll` / `cublas*.dll`：① 先更新 NVIDIA 驱动（新驱动自带部分运行库）② 仍缺则需装对应 CUDA Toolkit + cuDNN（版本按文件名，如 `cuda12.5-cudnn9.8.0`）。嫌麻烦就改用 directml |
| **trt** | 最快但门槛最高：需另装 TensorRT（NVIDIA 官网下载，按文件名版本对应）。进阶玩家选这个 |
| **rocm** | 按显卡家族下对应包（映射见决策树；不确定家族可用 GPU-Z 查 "Graphics Architecture"）。包很大但运行库全自带 |
| **opencl** | 老显卡兼容层。新卡不建议首选（比 rocm/directml 慢）。报 `0 devices` 说明驱动不支持，换 directml/eigen |

## 四、Linux 安装

```bash
# 以 eigen AVX2 为例（x64，绝大多数发行版可用）
wget https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-eigenavx2-linux-x64.zip
unzip katago-v1.18.1-eigenavx2-linux-x64.zip -d ~/katago && cd ~/katago
chmod +x katago
./katago version
```

- NVIDIA：`cuda…-linux-x64.zip`（同理可能需系统 CUDA/cuDNN）；追求极致用 `trt…`；
- AMD：`rocm7.14.0-linux-x64.zip`（Linux 的 rocm 包是通用的，不按 gfx 分家族；需系统已装 ROCm 驱动栈 `amdgpu-install`）；
- Intel：`onnx-openvino-linux-x64.zip`；
- 也可 `brew install katago`（Linuxbrew，Metal 无效但会编译可用后端）；
- 老设备兜底 `opencl`（需 `ocl-icd` + 显卡 OpenCL 驱动）。

## 五、macOS 安装

官方 Release **没有 macOS zip**——标准方式是 Homebrew（编译版，Metal 后端，Apple Silicon 上 CPU+GPU+ANE 混合推理）：

```bash
# 需先装 Xcode Command Line Tools（没有会自动提示）
brew install katago
katago version          # 验证
which katago            # 记下路径填给插件（如 /opt/homebrew/bin/katago）
```

Apple Silicon（M1–M4）性能很好，b18 模型每手亚秒级，直接上最强模型。

## 六、模型下载与选择（按 katagotraining.org 实测分析）

### 站点结构

- **主表** [katagotraining.org/networks](https://katagotraining.org/networks/)：kata1 自博弈训练的全部网络（2020 至今，倒序大表；首屏只显示近年，更老的 CNN 网络在表格深处）。顶部标出「最新」与「最强可靠评级」（当前为 `kata1-tf3-b11c768-…-7gres`，2026-09）；
- **Extra Nets** [katagotraining.org/extra_networks](https://katagotraining.org/extra_networks/)：非主线网络——人类风格模型、社区小网络、9×9 专用、大棋盘、特殊局面专用；
- 下载文件：**Network File 列的 `.bin.gz`**（普通用户只要这个，不解压直接用）；Raw Checkpoint 是训练原始文件，忽略；
- 下载直链形态：`https://media.katagotraining.org/uploaded/networks/models/kata1/<名称>.bin.gz`（extra 网络在 `models_extra/` 下）。

### 命名规则

`kata1-tf3-b11c768-s11003M-d5973M-7gres`
- `b11c768`：11 个 block × 768 通道（b/c 越大越强越慢）；
- `tf3`：导出版本；`s/d` 数字：训练自博弈/数据量（越大越成熟）；
- **架构看后缀**（2026-09-30 三页实测修正）：`tf2/tf3`（b10c384/512、b11c768）、`nbt`（b18c384nbt、b28c512nbt、zhizi b40c768nbt）、`npt`（b28c512npt）均为 **transformer 架构**（需 KataGo ≥1.15/1.17）；`nbn` 与无后缀老系（b60c320、b40c256、b30c320、b25c256、b20c256、b10c128、b15c192、b6c96）才是 **CNN**；
- **transformer 网络只认 CUDA/TRT（及新版 OpenCL）后端**：directml/eigen 版会报不支持，配这两个后端必须换 CNN 网络（含拟人网 humanv0——它也是 transformer）；
- 站内 Elo 只在 kata1 内部可比，不用跨 bot 比较。

### 按场景选择

| 场景 | 推荐 | 位置 |
| --- | --- | --- |
| GPU（CUDA/TRT）/ Apple Silicon | 主表顶部「最强可靠评级」的 **b11c768**（transformer，最强） | 主表 |
| **DirectML / OpenCL / CPU（首选）** | **Lionffen b6c64**（2025 社区小 CNN，19 路专用，等 visits 抗衡历史 10 层网；弱点：大龙对杀偏弱） | Extra Nets → Strength-Finetuned |
| DirectML / OpenCL（分析升级） | **Lionffen b24c64**（2025-09 社区 CNN，与历史 15 层/较弱 20 层网竞争；站方注明**偏对弈、不适合复盘分析**）或主表历史区官方 CNN **b60c320**（2023，官方最强 CNN，分析更稳） | Extra Nets / 主表深处 |
| CPU（轻量） | 主表历史区 **b10c128 / b15c192**（2021 老 CNN，表格深处） | 主表深处 |
| 拟人棋风/段位评估 | **b18c384nbt-humanv0**（Human SL，2024-07；transformer 架构，**仅 CUDA/TRT 后端**，配 humanSLProfile） | Extra Nets → Human-Trained |
| 9 路做题分析 | 任意 19 路 CNN/transformer（KataGo 自动适配小棋盘）；追求极致用 Extra Nets 的 9x9 Finetuned Net（nbt=transformer，注意后端） | Extra Nets → Small Board |

**DirectML 后端（onnx 版）只能跑 CNN**：官方主表里 2023 及更早的 `nbn`/无后缀系（b60c320 为最强官方 CNN，~13540 站内 Elo）+ Lionffen b6c64/b24c64；主表现役的 tf/nbt/npt 系全部不可用。

### 许可

网络权重有独立许可页（networks 页有链接）：个人对弈/分析使用没有问题；**再分发或商业使用前先读条款**。

## 七、验证与接入插件

1. `katago version` 出版本号（前文各平台命令）；
2. 设置 → 引擎（KataGo）：模式选「本地引擎」，填 katago 路径 + 模型路径，点「探测」；
3. 「启动引擎」→ 状态"就绪" → 打谱模式点「分析当前局面」。

**可选冒烟测试**（手动验证分析模式，插件「探测」已覆盖）：

```
katago analysis -model <模型.bin.gz> -config <任意 gtp/analysis 示例 cfg>
# 加载完成后粘贴这一行并回车：
{"id":"t1","moves":[],"initialStones":[],"initialPlayer":"B","rules":"chinese","komi":7.5,"boardXSize":19,"analyzeTurns":[0],"maxVisits":20}
# 返回含 moveInfos 的 JSON 即正常，Ctrl+C 退出
```

### 远程端点模式（自建 HTTP 包装，M5.2a 实测）

插件设置「模式 → 远程端点」需要一个 HTTP 服务：`POST` 一个 katago analysis 请求 JSON，
响应同一个 JSON（`moveInfos`/`rootInfo`）。适合引擎跑在另一台机器/WSL/服务器上的场景。

**最小契约**（与 katago analysis 行协议同构）：

```
POST /analyze   body: {"id":"...","initialStenes":[],"moves":[],"initialPlayer":"B",
                      "rules":"chinese","komi":7.5,"boardXSize":19,"boardYSize":19,
                      "maxVisits":100,"analyzeTurns":[N],...}
→ 200           body: {"id":"...","turnNumber":N,"moveInfos":[{move,order,winrate,scoreLead,visits,pv}...],
                      "rootInfo":{currentPlayer,winrate,scoreLead,visits}}
```

**CORS 必须显式放开**（实测教训：浏览器插件页面跨端口请求，服务端不回
`Access-Control-Allow-Origin` 时 fetch 直接 `Failed to fetch`，请求其实已到达）。
响应头至少：`Access-Control-Allow-Origin: *`、`Access-Control-Allow-Headers: content-type`，
并处理 `OPTIONS` 预检。

最小 Node 包装示例（同机部署 katago 后即可用）：

```js
// engine-server.mjs —— node engine-server.mjs（依赖本机 katago + 模型）
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
const child = spawn('katago', ['analysis', '-model', 'kata1-b18c384nbt.bin', '-config', 'analysis_example.cfg']);
const pending = new Map();
let buf = '';
child.stdout.on('data', (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf('
')) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line.startsWith('{')) continue;
    const obj = JSON.parse(line);
    pending.get(obj.id)?.(obj); pending.delete(obj.id);
  }
});
createServer((req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const q = JSON.parse(body);
    pending.set(q.id, (ans) => { res.writeHead(200, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(ans)); });
    child.stdin.write(JSON.stringify(q) + '
');
  });
}).listen(8080);
```

插件内：设置 → KataGo 引擎 → 模式「远程端点」→ 填 `http://<host>:8080/analyze` →「测试连接」。

## 八、常见问题

| 症状 | 处理 |
| --- | --- |
| cuda 版缺 `cudnn/cublas` DLL | 更新 NVIDIA 驱动；仍缺则装文件名对应版本的 CUDA+cuDNN，或换 directml |
| **trt 版缺 `nvinfer_10.dll` / `nvonnxparser_10.dll`** | 缺 TensorRT 运行库（实测案例：trt10.16.1-cuda13.2）。推荐补齐（b11c768 等 transformer 网络只有 CUDA/TRT 后端跑，换 directml/eigen 版**必须同时换 CNN 网络**）：① `nvidia-smi` 看右上角 CUDA Version ≥ 13.2（不够先更新 N 卡驱动，或改装 cuda12.x 的 trt 版）；② 取 TensorRT 库——**GitHub Releases 无附件（实测 v10.16 只有源码归档），正确渠道是 NVIDIA 的 PyPI 镜像**（免开发者账号）：`pip download tensorrt-cu13-libs==10.16.1.11 --index-url https://pypi.nvidia.com --only-binary=:all: -d trt-libs`，或浏览器直接下载 `https://pypi.nvidia.com/tensorrt-cu13-libs/tensorrt_cu13_libs-10.16.1.11-py3-none-win_amd64.whl`（约 1.9 GB，实测中央目录含 nvinfer_10 / nvonnxparser_10 / nvinfer_plugin_10 及全架构 builder DLL）；cuda12.x 的 trt 版对应 `tensorrt-cu12-libs` 同版本号；③ `.whl` 就是 zip（可改后缀解压），把里面 `tensorrt_libs\` 下**全部 dll** 复制到 katago.exe 同目录。之后若再缺 `cublas/cudart/cudnn` 等，按文件名继续补（cublas/cudart=CUDA 运行库，cudnn=cuDNN 9）；NVIDIA 开发者官网 zip 需注册账号，亦可选 |
| opencl 报 `0 devices` | 驱动不支持，换 directml / eigen |
| eigenavx2 报非法指令 | CPU 无 AVX2，换 eigen |
| rocm 版启动即崩 | 家族选错（用 GPU-Z 核对架构），或换 directml |
| 分析慢 | 降 visits（插件设置，默认 200 → 100 或 50）；换更小模型（b18 → Lionffen b6c64 / b10c128）；CPU 用户这是常态 |
| **启动报 `Cannot specify both numSearchThreadsPerAnalysisThread and numSearchThreads`** | v1.18 中两个线程键互斥。插件已不干预线程数（交给配套 cfg）；手动改 cfg 时二选一 |
| **onnx 版启动报 `onnxProvider is not set in the config`** | v1.18 起 onnx 系构建必填该键（openvino/directml/cuda/tensorrt/migraphx/cpu），发行 zip 附的 example cfg 不一定带。插件按 katago 文件名自动推断并注入（如 `…onnx1.24.4-directml…` → directml），设置页「ONNX 后端」下拉可手动指定 |
| **启动报 `Could not find key 'xxx' in config file`** | 配置键与发行构建不匹配（实测：`numAnalysisThreads` 在 v1.18.1 官方 cfg 里有，但 onnx-directml 构建不认）。插件已内置防护：优先用 katago 同目录自带的 `analysis_example.cfg`（与二进制配套必然兼容），仅 override 保守旧键（logDir/reportAnalysisWinratesAs/numSearchThreads/maxVisits）。手动冒烟测试同理：用发行 zip 附带的 cfg，别混用其他版本 cfg |
| transformer 模型报不支持 | KataGo < 1.17，更新到 v1.18.1+ 或换 CNN 网络（b18c384nbn 老版） |
| 首次启动卡几十秒 | GPU 后端在自动 tune，正常，仅一次 |
| 路径含空格/中文 | 插件不受影响（不走 shell）；手动命令行测试时给路径加引号 |
