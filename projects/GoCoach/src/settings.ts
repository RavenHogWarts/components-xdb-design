// ─────────────────────────────────────────────────────────────
// 设置渲染器（声明式控件 + 自定义题库管理区域）。
// 常规偏好用宿主原生控件（props.setting.*）写回 viewDefinition；
// 题库管理需要逐行开关与导入交互，用 setting.custom 挂载：
//   内置题库：一行 + 启用开关（写回 viewDefinition）
//   导入题库：标题分割，一行一个题库（名称 / 题数 / 启用开关 / 删除）
// 变更经 window 事件通知视图刷新（storage 层负责派发）。
// ─────────────────────────────────────────────────────────────

import { validateLesson } from './go/validate';
import type { Lesson } from './go/types';
import {
  loadLibraries,
  libraryDisplayName,
  libraryEntryId,
  loadLlmConfig,
  llmConfigured,
  parseLibraryFile,
  removeLibrary,
  resetProfile,
  saveLlmConfig,
  setLibraryEnabled,
  upsertLibrary,
  type LibraryEntry,
} from './storage';
import { testLlmConnection } from './llm';
import {
  engineStatus,
  inferOnnxProvider,
  localEngineAvailable,
  probeKatago,
  remoteEngine,
  startLocalEngine,
  stopEngine,
} from './engine';
import {
  loadEngineConfig,
  saveEngineConfig,
  loadSgfConfig,
  saveSgfConfig,
  EVENT_ENGINE_STATUS,
  type EngineConfig,
  type EngineMode,
} from './storage';
import { listSgfFiles, dirOfFile, localFsAvailable } from './localfs';
import { CSS_PREFIX, DEFAULT_PREFS, PLUGIN_ID, PLUGIN_NAME, type ViewSettingsProps } from './types';

/** 小型开关（custom 区域内无法使用宿主 switch 控件） */
function createToggle(checked: boolean, onChange: (value: boolean) => void): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = CSS_PREFIX + 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  const track = document.createElement('span');
  track.className = CSS_PREFIX + 'switchTrack';
  track.setAttribute('aria-hidden', 'true');
  input.addEventListener('change', () => onChange(input.checked));
  label.append(input, track);
  label.title = checked ? '已启用（点击停用）' : '已停用（点击启用）';
  return label;
}

export function createSettingsRenderer() {
  // 本轮 update 的生命周期标记：patchLlm 触发重渲染后废弃旧的 update 副作用
  let epoch = 0;

  return {
    update(props: ViewSettingsProps) {
      const { viewDefinition, setViewDefinition, setting, container } = props;
      const thisEpoch = ++epoch;

      // 激活面板级 padding 的标记（见 style.css 的 :has() 规则）
      container.classList.add(`${CSS_PREFIX}settingsRoot`);

      const options =
        (viewDefinition?.options?.[PLUGIN_ID] as Record<string, unknown> | undefined) ?? {};
      const writeOption = (patch: Record<string, unknown>) => {
        void setViewDefinition((current: any) => ({
          ...current,
          options: {
            ...(current.options ?? {}),
            [PLUGIN_ID]: {
              ...(current.options?.[PLUGIN_ID] ?? {}),
              ...patch,
            },
          },
        }));
      };

      setting.title(PLUGIN_NAME);
      setting.description('做题练习与打谱复盘。学习记录、题库全部保存在本机。');

      setting.switch({
        key: 'showCoords',
        label: '显示棋盘坐标',
        description: '棋盘边缘显示列字母（跳过 I）与行号，方便对照讲解',
        value: options.showCoords ?? DEFAULT_PREFS.showCoords,
        onChange(value: boolean) {
          writeOption({ showCoords: value });
        },
      });

      setting.switch({
        key: 'showMoveNumbers',
        label: '打谱显示手数',
        description: '在棋子上标注第几手落子（仅打谱模式）',
        value: options.showMoveNumbers ?? DEFAULT_PREFS.showMoveNumbers,
        onChange(value: boolean) {
          writeOption({ showMoveNumbers: value });
        },
      });

      setting.title('题库管理');
      setting.description(
        '一行一个题库，开关决定是否参与选题。Go Game Guru 题库（417 题，CC BY-NC-SA 4.0）' +
          '体积较大且许可要求与代码分离，不打包进插件；'
      );

      setting.custom({
        key: 'libraryList',
        render(el: HTMLElement) {
          // 宿主复用容器重渲染（如切换开关）时先清空，避免内容重复
          el.replaceChildren();

          const status = document.createElement('div');
          status.className = `${CSS_PREFIX}libImportStatus`;

          const refresh = () => {
            const root = document.createElement('div');
            root.className = `${CSS_PREFIX}libPanel`;

            // ── 内置题库 ──
            const secBuiltin = document.createElement('div');
            secBuiltin.className = `${CSS_PREFIX}libSection`;
            secBuiltin.textContent = '内置题库';

            const builtinRow = document.createElement('div');
            builtinRow.className = `${CSS_PREFIX}libEntry`;
            const bName = document.createElement('span');
            bName.className = `${CSS_PREFIX}libName`;
            bName.textContent = '入门课程与手筋';
            const bCount = document.createElement('span');
            bCount.className = `${CSS_PREFIX}libCount`;
            bCount.textContent = '182 题（入门 64 · 手筋 118）';
            builtinRow.append(
              bName,
              bCount,
              createToggle(options.builtinEnabled !== false, (value) => {
                writeOption({ builtinEnabled: value });
                builtinRow.title = value ? '' : '内置题库已停用，仅练习导入题库';
              })
            );

            // ── 导入题库 ──
            const secImport = document.createElement('div');
            secImport.className = `${CSS_PREFIX}libSection`;
            secImport.textContent = '导入题库';

            const importRow = document.createElement('div');
            importRow.className = `${CSS_PREFIX}libEntry ${CSS_PREFIX}libEntry--header`;

            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.style.display = 'none';

            const importBtn = document.createElement('button');
            importBtn.type = 'button';
            importBtn.className = `${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`;
            importBtn.textContent = '＋ 导入题库文件';
            importBtn.onclick = () => input.click();

            importRow.append(importBtn, input);

            root.append(secBuiltin, builtinRow, secImport, importRow);

            void loadLibraries().then((libs: LibraryEntry[]) => {
              if (!libs.length) {
                const empty = document.createElement('div');
                empty.className = `${CSS_PREFIX}libEmpty`;
                empty.textContent = '尚未导入题库。';
                root.append(empty);
                return;
              }
              for (const entry of libs) {
                const row = document.createElement('div');
                row.className = `${CSS_PREFIX}libEntry`;
                const name = document.createElement('span');
                name.className = `${CSS_PREFIX}libName`;
                name.textContent = libraryDisplayName(entry.meta);
                name.title = name.textContent;
                const count = document.createElement('span');
                count.className = `${CSS_PREFIX}libCount`;
                count.textContent = `${entry.meta.count} 题`;
                const del = document.createElement('button');
                del.type = 'button';
                del.className = `${CSS_PREFIX}libDel`;
                del.textContent = '✕';
                del.title = '删除该题库';
                del.onclick = async () => {
                  del.disabled = true;
                  await removeLibrary(entry.id);
                };
                row.append(
                  name,
                  count,
                  createToggle(entry.enabled, (value) => {
                    void setLibraryEnabled(entry.id, value);
                  }),
                  del
                );
                root.append(row);
              }
            });

            // 导入交互：文件 → 解析 → 逐题校验 → 入库（同题库覆盖）
            input.onchange = async () => {
              const file = input.files?.[0];
              input.value = '';
              if (!file) return;
              importBtn.disabled = true;
              status.textContent = '正在校验题目（逐题回放答案树，稍候）…';
              try {
                const text = await file.text();
                const parsed = parseLibraryFile(text);
                const lessons: Lesson[] = [];
                const failures: string[] = [];
                for (const raw of parsed.raw) {
                  try {
                    lessons.push(validateLesson(raw));
                  } catch (err) {
                    failures.push(
                      `${(raw as { id?: string })?.id ?? '未知题目'}：${(err as Error).message}`
                    );
                  }
                }
                if (!lessons.length) {
                  throw new Error(failures[0] ?? '文件中没有可用题目。');
                }
                const entry: LibraryEntry = {
                  id: libraryEntryId(parsed.meta),
                  meta: { ...parsed.meta, count: lessons.length },
                  lessons,
                  enabled: true,
                  importedAt: new Date().toISOString(),
                };
                const ok = await upsertLibrary(entry);
                if (!ok) throw new Error('题库写入本地存储失败（IndexedDB 不可用）。');
                status.textContent =
                  `已导入「${entry.meta.title ?? entry.meta.format}」${lessons.length} 题` +
                  (failures.length ? `；${failures.length} 题校验未通过被跳过（首个：${failures[0]}）` : '') +
                  '。回到视图即可练习。';
              } catch (err) {
                status.textContent = `导入失败：${(err as Error).message}`;
              } finally {
                importBtn.disabled = false;
              }
            };

            el.append(root, status);
          };

          refresh();

          return () => {
            el.replaceChildren();
          };
        },
      });

      /** 自绘文本输入行（LLM 配置）：输入静默保存，blur/Enter 保存+重渲染刷新显示 */
      const createLlmTextInput = (
        parent: HTMLElement,
        label: string,
        field: 'baseUrl' | 'model',
        placeholder: string
      ) => {
        const row = document.createElement('div');
        row.className = `${CSS_PREFIX}llmKeyRow`;
        const lab = document.createElement('span');
        lab.className = `${CSS_PREFIX}llmKeyLabel`;
        lab.textContent = label;
        const input = document.createElement('input');
        input.type = 'text';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder = placeholder;
        input.className = `${CSS_PREFIX}llmKeyInput`;
        input.value = loadLlmConfig()[field];
        const save = (rerender: boolean) => patchLlm({ [field]: input.value } as Partial<typeof llm>, rerender);
        input.addEventListener('input', () => save(false));
        input.addEventListener('blur', () => save(true));
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            save(true);
            input.blur();
          }
        });
        row.append(lab, input);
        parent.append(row);
        return () => {
          input.removeEventListener('input', input.oninput as EventListener);
        };
      };

      /** 自绘开关（LLM 配置）：点击即时同步视觉，不依赖宿主声明式 switch 的重渲染时序 */
      const createLlmToggle = (parent: HTMLElement, label: string, field: 'deepThinking') => {
        const row = document.createElement('div');
        row.className = `${CSS_PREFIX}llmToggleRow`;
        const lab = document.createElement('span');
        lab.className = `${CSS_PREFIX}llmKeyLabel`;
        lab.textContent = label;
        const wrap = document.createElement('label');
        wrap.className = `${CSS_PREFIX}switch`;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = loadLlmConfig()[field] === true;
        const track = document.createElement('span');
        track.className = `${CSS_PREFIX}switchTrack`;
        track.setAttribute('aria-hidden', 'true');
        input.addEventListener('change', () => {
          patchLlm({ [field]: input.checked } as Partial<typeof llm>, false);
          wrap.title = input.checked ? '已开启（点击关闭）' : '已关闭（点击开启）';
        });
        wrap.title = input.checked ? '已开启（点击关闭）' : '已关闭（点击开启）';
        wrap.append(input, track);
        row.append(lab, wrap);
        parent.append(row);
        return input;
      };

      // ── 打谱：SGF 文件夹（localfs 列目录，打谱模式工具栏一键加载）──
      setting.title('打谱');
      setting.custom({
        key: 'sgfDirPanel',
        render(el: HTMLElement) {
          el.replaceChildren();
          const canFs = localFsAvailable();
          const row = document.createElement('div');
          row.className = `${CSS_PREFIX}llmKeyRow`;
          const lab = document.createElement('span');
          lab.className = `${CSS_PREFIX}llmKeyLabel`;
          lab.textContent = 'SGF 文件夹';
          const input = document.createElement('input');
          input.className = `${CSS_PREFIX}llmKeyInput`;
          input.spellcheck = false;
          input.placeholder = 'D:\\path\\to\\sgf-records';
          input.value = loadSgfConfig().dir;
          const status = document.createElement('span');
          status.className = `${CSS_PREFIX}engineInlineStatus`;
          const commit = () => {
            const dir = input.value.trim();
            saveSgfConfig({ dir });
            status.textContent = canFs
              ? dir
                ? `已保存：${listSgfFiles(dir).length} 个 .sgf`
                : ''
              : '当前环境不支持读取本地目录（需宿主桌面端），路径仅作保存。';
          };
          input.addEventListener('blur', commit);
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              commit();
              input.blur();
            }
          });

          // 📁 选择文件夹：webkitdirectory（accept 与目录模式冲突，不做扩展名过滤）
          const picker = document.createElement('input');
          picker.type = 'file';
          picker.webkitdirectory = true;
          picker.style.display = 'none';
          const browse = document.createElement('button');
          browse.type = 'button';
          browse.className = `${CSS_PREFIX}llmKeyToggle`;
          browse.textContent = '📁';
          browse.title = '选择文件夹…';
          browse.onclick = () => picker.click();
          picker.onchange = () => {
            const file = picker.files?.[0];
            picker.value = '';
            if (!file) return;
            const anyFile = file as File & { path?: string };
            let path = '';
            if (typeof anyFile.path === 'string' && anyFile.path) {
              path = anyFile.path;
            } else {
              const webUtils = (window as unknown as {
                webUtils?: { getPathForFile?: (f: File) => string };
              }).webUtils;
              if (typeof webUtils?.getPathForFile === 'function') {
                try {
                  path = webUtils.getPathForFile(file) || '';
                } catch {
                  path = '';
                }
              }
            }
            const dir = dirOfFile(path);
            if (!dir) {
              status.textContent = '当前环境拿不到所选文件夹的绝对路径（浏览器预览限制），请手动填写。';
              return;
            }
            input.value = dir;
            commit();
          };
          row.append(lab, input, browse, picker, status);
          el.append(row);
          return () => el.replaceChildren();
        },
      });

      setting.title('AI 讲解（OpenAI 兼容）');
      setting.description(
        '接入任意 OpenAI 兼容接口（OpenAI / DeepSeek / Qwen / GLM，或本地 Ollama、LM Studio），' +
          '做题时可一键让 AI 讲解局面。密钥仅明文保存在本机浏览器存储，不会随库同步；' +
          '本地 Ollama 需先设置环境变量 OLLAMA_ORIGINS=* 并重启服务。'
      );

      const llm = loadLlmConfig();
      // 每次都从存储读最新值再合并：若用本轮快照，后填的字段会把先填的字段覆盖回旧值。
      // rerender=true 时保存后重渲染本面板（LLM 配置不写 viewDefinition，宿主不会
      // 自行刷新设置页，自绘控件与声明式开关的显示都需要这里主动刷新）。
      const patchLlm = (patch: Partial<typeof llm>, rerender = false) => {
        const current = loadLlmConfig();
        saveLlmConfig({ ...current, ...patch });
        if (!rerender) return;
        const myEpoch = thisEpoch;
        window.setTimeout(() => {
          if (epoch === myEpoch) this.update(props);
        }, 0);
      };
      /**
       * 文本输入项显示策略：宿主 input 是声明式控件（每次 update 按 value 重置），
       * 输入中若重渲染会打断焦点——因此「输入时只静默保存（读最新值合并防覆盖），
       * blur / Enter 时保存并重渲染」，显示随即与存储同步。
       */
      const bindLlmText = (
        el: HTMLElement,
        field: 'baseUrl' | 'model',
        input: HTMLInputElement
      ) => {
        const commit = () => patchLlm({ [field]: input.value } as Partial<typeof llm>, true);
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            commit();
            input.blur();
          }
        });
        // 清理由 custom 渲染函数的 cleanup 负责（宿主可能不调用，双保险：元素移除即失效）
        el.addEventListener('DOMNodeRemoved', () => {
          input.removeEventListener('blur', commit);
        });
      };

      setting.custom({
        key: 'llmBaseUrl',
        render(el: HTMLElement) {
          el.replaceChildren();
          const cleanup = createLlmTextInput(el, 'Base URL', 'baseUrl', 'https://api.openai.com/v1 或 http://localhost:11434/v1');
          return () => {
            cleanup();
            el.replaceChildren();
          };
        },
      });

      setting.custom({
        key: 'llmApiKey',
        render(el: HTMLElement) {
          // 宿主 input 控件不支持密码类型：自绘密文输入框（👁 可切换明文）
          el.replaceChildren();
          const row = document.createElement('div');
          row.className = `${CSS_PREFIX}llmKeyRow`;
          const label = document.createElement('span');
          label.className = `${CSS_PREFIX}llmKeyLabel`;
          label.textContent = 'API Key';
          const input = document.createElement('input');
          input.type = 'password';
          input.autocomplete = 'off';
          input.spellcheck = false;
          input.placeholder = 'sk-…（部分本地服务可留空）';
          input.className = `${CSS_PREFIX}llmKeyInput`;
          input.value = loadLlmConfig().apiKey;
          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = `${CSS_PREFIX}llmKeyToggle`;
          toggle.textContent = '👁';
          toggle.setAttribute('aria-label', '显示密钥');
          toggle.title = '显示 / 隐藏密钥';
          toggle.onclick = () => {
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            toggle.textContent = show ? '🙈' : '👁';
            toggle.setAttribute('aria-label', show ? '隐藏密钥' : '显示密钥');
          };
          const saveKey = (rerender: boolean) => patchLlm({ apiKey: input.value }, rerender);
          input.addEventListener('input', () => saveKey(false));
          input.addEventListener('blur', () => saveKey(true));
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              saveKey(true);
              input.blur();
            }
          });
          row.append(label, input, toggle);
          el.append(row);
          return () => {
            toggle.onclick = null;
            el.replaceChildren();
          };
        },
      });

      setting.custom({
        key: 'llmModel',
        render(el: HTMLElement) {
          el.replaceChildren();
          const cleanup = createLlmTextInput(el, '模型名', 'model', 'gpt-4o-mini / deepseek-chat / qwen-plus …');
          return () => {
            cleanup();
            el.replaceChildren();
          };
        },
      });

      setting.custom({
        key: 'llmDeepThinking',
        render(el: HTMLElement) {
          el.replaceChildren();
          const lab = document.createElement('div');
          lab.className = `${CSS_PREFIX}libHint`;
          lab.textContent =
            '针对思考型模型（deepseek-reasoner / QwQ / GLM 思考链等）。开启后：不限制输出与时长，' +
            '允许模型长时间推理（做题时显示思考进度，可随时点其他操作取消）；' +
            '关闭时不附加禁思考参数并限制输出长度，速度更快。OpenAI 等对未知参数严格的服务请保持关闭。';
          el.append(lab);
          const input = createLlmToggle(el, '深度思考', 'deepThinking');
          return () => {
            input.removeEventListener('change', input.onchange as EventListener);
            el.replaceChildren();
          };
        },
      });

      setting.custom({
        key: 'llmTest',
        render(el: HTMLElement) {
          el.replaceChildren();
          const row = document.createElement('div');
          row.className = `${CSS_PREFIX}libRow`;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `${CSS_PREFIX}btn`;
          btn.textContent = '测试连接';
          const status = document.createElement('span');
          status.className = `${CSS_PREFIX}libImportStatus`;
          status.style.marginTop = '0';
          btn.onclick = async () => {
            const cfg = loadLlmConfig();
            if (!llmConfigured(cfg)) {
              status.textContent = '请先填写 Base URL 与模型名。';
              return;
            }
            btn.disabled = true;
            status.textContent = '测试中…';
            try {
              status.textContent = await testLlmConnection(cfg);
            } catch (err) {
              status.textContent = `失败：${(err as Error).message}`;
            } finally {
              btn.disabled = false;
            }
          };
          row.append(btn, status);
          el.append(row);
          return () => el.replaceChildren();
        },
      });

      // ── KataGo 引擎（M5.2a）：模式 / 路径 / 启停 / 状态回显 ──
      // 自绘整体（模式切换与启停都要即时刷新局部 DOM），全块一个 custom。
      const canSpawn = localEngineAvailable();
      setting.custom({
        key: 'enginePanel',
        render(el: HTMLElement) {
          el.replaceChildren();
          const panel = document.createElement('div');
          panel.className = `${CSS_PREFIX}enginePanel`;

          const patchEngine = (patch: Partial<EngineConfig>) => {
            saveEngineConfig({ ...loadEngineConfig(), ...patch });
          };

          // 文件选择器的提示行（拿不到绝对路径等场景）
          const pickStatus = document.createElement('div');
          pickStatus.className = `${CSS_PREFIX}libImportStatus`;

          // 本地面板的启停状态行刷新函数（状态事件到来时调用；换模式后置空）
          let statusSync: (() => void) | null = null;

          const renderPanel = () => {
            panel.replaceChildren(pickStatus);
            statusSync = null;
            const cfg = loadEngineConfig();

            // 模式三选一
            const segRow = document.createElement('div');
            segRow.className = `${CSS_PREFIX}engineSegRow`;
            const modes: Array<{ value: EngineMode; label: string; hint: string }> = [
              { value: 'off', label: '关闭', hint: '不使用引擎' },
              { value: 'local', label: '本地引擎', hint: '启动本机 katago analysis 子进程' },
              { value: 'remote', label: '远程端点', hint: 'POST 到自建 HTTP 分析服务' },
            ];
            for (const m of modes) {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = `${CSS_PREFIX}engineSegBtn${cfg.mode === m.value ? ` ${CSS_PREFIX}engineSegBtn--on` : ''}`;
              btn.textContent = m.label;
              btn.title = m.hint;
              btn.setAttribute('aria-pressed', String(cfg.mode === m.value));
              if (m.value === 'local' && !canSpawn) btn.disabled = true;
              btn.onclick = () => {
                if (m.value === 'local' && !canSpawn) return;
                if (cfg.mode !== m.value && cfg.mode === 'local') stopEngine();
                patchEngine({ mode: m.value });
                renderPanel();
              };
              segRow.append(btn);
            }
            panel.append(segRow);

            if (cfg.mode === 'local' && !canSpawn) {
              const warn = document.createElement('div');
              warn.className = `${CSS_PREFIX}libHint`;
              warn.textContent = '当前宿主环境不支持子进程（无 require），本地模式不可用；请选择远程端点。';
              panel.append(warn);
              return;
            }

            const makeField = (
              label: string,
              field: 'katagoPath' | 'modelPath' | 'remoteUrl',
              placeholder: string,
              afterCommit?: () => void,
              fileAccept?: string
            ) => {
              const row = document.createElement('div');
              row.className = `${CSS_PREFIX}llmKeyRow`;
              const lab = document.createElement('span');
              lab.className = `${CSS_PREFIX}llmKeyLabel`;
              lab.textContent = label;
              const input = document.createElement('input');
              input.className = `${CSS_PREFIX}llmKeyInput`;
              input.spellcheck = false;
              input.placeholder = placeholder;
              input.value = loadEngineConfig()[field];
              const commit = () => {
                patchEngine({ [field]: input.value.trim() } as Partial<EngineConfig>);
                afterCommit?.();
              };
              input.addEventListener('blur', commit);
              input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                  commit();
                  input.blur();
                }
              });
              row.append(lab, input);

              // 系统文件选择器（仅本地路径字段）：accept 限定文件类型；
              // Electron 宿主可从 File 拿绝对路径（file.path 或 webUtils.getPathForFile）
              if (fileAccept) {
                const picker = document.createElement('input');
                picker.type = 'file';
                picker.accept = fileAccept;
                picker.style.display = 'none';
                const browse = document.createElement('button');
                browse.type = 'button';
                browse.className = `${CSS_PREFIX}llmKeyToggle`;
                browse.textContent = '📁';
                browse.title = '浏览文件…';
                browse.onclick = () => picker.click();
                picker.onchange = () => {
                  const file = picker.files?.[0];
                  picker.value = '';
                  if (!file) return;
                  // 系统对话框只能按扩展名过滤；katago 可执行文件再按文件名校验
                  // （兼容 katago-trt.exe 等社区构建命名）
                  if (fileAccept === '.exe' && !/^katago/i.test(file.name)) {
                    pickStatus.textContent = `选中的「${file.name}」不是 KataGo 可执行文件（通常名为 katago.exe）。请重新选择。`;
                    return;
                  }
                  const anyFile = file as File & { path?: string };
                  let path = '';
                  if (typeof anyFile.path === 'string' && anyFile.path) {
                    path = anyFile.path;
                  } else {
                    const webUtils = (window as unknown as {
                      webUtils?: { getPathForFile?: (f: File) => string };
                    }).webUtils;
                    if (typeof webUtils?.getPathForFile === 'function') {
                      try {
                        path = webUtils.getPathForFile(file) || '';
                      } catch {
                        path = '';
                      }
                    }
                  }
                  if (!path) {
                    pickStatus.textContent =
                      '当前环境拿不到所选文件的绝对路径（浏览器预览限制），请在宿主中使用浏览按钮或手动填写路径。';
                    return;
                  }
                  input.value = path;
                  commit();
                };
                row.append(browse, picker);
              }
              return { row, input };
            };

            if (cfg.mode === 'local') {
              // katago 路径变化可能切换 ONNX 后端选择行的显隐，提交后局部重建面板
              panel.append(makeField('katago 路径', 'katagoPath', 'C:\\path\\to\\katago.exe', renderPanel, '.exe').row);

              // 探测行：spawn version 秒验（不加载模型）
              const probeRow = document.createElement('div');
              probeRow.className = `${CSS_PREFIX}engineActionRow`;
              const probeBtn = document.createElement('button');
              probeBtn.type = 'button';
              probeBtn.className = `${CSS_PREFIX}btn`;
              probeBtn.textContent = '探测版本';
              const probeStatus = document.createElement('span');
              probeStatus.className = `${CSS_PREFIX}engineInlineStatus`;
              probeBtn.onclick = async () => {
                const path = loadEngineConfig().katagoPath;
                if (!path) {
                  probeStatus.textContent = '请先填写 katago 路径。';
                  return;
                }
                probeBtn.disabled = true;
                probeStatus.textContent = '探测中…';
                try {
                  const ver = await probeKatago(path);
                  probeStatus.textContent = `✓ ${ver}`;
                } catch (err) {
                  probeStatus.textContent = `✕ ${(err as Error).message}`;
                } finally {
                  probeBtn.disabled = false;
                }
              };
              probeRow.append(probeBtn, probeStatus);
              panel.append(probeRow);

              panel.append(makeField('模型路径', 'modelPath', 'C:\\path\\to\\kata1-b18c384nbt.bin.gz', undefined, '.gz,.bin').row);

              const visitsRow = document.createElement('div');
              visitsRow.className = `${CSS_PREFIX}llmKeyRow`;
              const visitsLab = document.createElement('span');
              visitsLab.className = `${CSS_PREFIX}llmKeyLabel`;
              visitsLab.textContent = 'visits';
              visitsLab.title = '每个局面的最大计算量：200 约秒级出结果，越大越准越慢';
              const visitsInput = document.createElement('input');
              visitsInput.type = 'number';
              visitsInput.min = '1';
              visitsInput.max = '10000';
              visitsInput.step = '10';
              visitsInput.className = `${CSS_PREFIX}llmKeyInput ${CSS_PREFIX}engineVisits`;
              visitsInput.value = String(loadEngineConfig().visits);
              const commitVisits = () => {
                const n = Math.round(Number(visitsInput.value));
                patchEngine({ visits: Number.isFinite(n) && n >= 1 ? Math.min(10000, n) : 200 });
              };
              visitsInput.addEventListener('blur', commitVisits);
              visitsInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                  commitVisits();
                  visitsInput.blur();
                }
              });
              visitsRow.append(visitsLab, visitsInput);
              panel.append(visitsRow);

              // ONNX 系后端必填 onnxProvider（v1.18 起发行 cfg 不一定带）；
              // 非 onnx 构建不显示（多余键会被当成未知键报错）
              const curCfg = loadEngineConfig();
              const inferred = inferOnnxProvider(curCfg.katagoPath);
              if (inferred !== null) {
                const provRow = document.createElement('div');
                provRow.className = `${CSS_PREFIX}llmKeyRow`;
                const provLab = document.createElement('span');
                provLab.className = `${CSS_PREFIX}llmKeyLabel`;
                provLab.textContent = 'ONNX 后端';
                const provSel = document.createElement('select');
                provSel.className = `${CSS_PREFIX}llmKeyInput ${CSS_PREFIX}engineVisits`;
                const options: Array<{ value: string; label: string }> = [
                  { value: '', label: `自动（按文件名推断：${inferred}）` },
                  { value: 'openvino', label: 'openvino（Intel GPU/NPU）' },
                  { value: 'directml', label: 'directml（DirectX 12 GPU）' },
                  { value: 'cuda', label: 'cuda（NVIDIA）' },
                  { value: 'tensorrt', label: 'tensorrt（NVIDIA）' },
                  { value: 'migraphx', label: 'migraphx（AMD，Linux）' },
                  { value: 'cpu', label: 'cpu（无加速，慢）' },
                ];
                for (const o of options) {
                  const opt = document.createElement('option');
                  opt.value = o.value;
                  opt.textContent = o.label;
                  provSel.append(opt);
                }
                provSel.value = curCfg.onnxProvider ?? '';
                provSel.addEventListener('change', () => patchEngine({ onnxProvider: provSel.value }));
                provRow.append(provLab, provSel);
                panel.append(provRow);
              }

              const hint = document.createElement('div');
              hint.className = `${CSS_PREFIX}libHint`;
              const hintDefault =
                '引擎在本机运行 katago analysis 子进程（配置由插件自动生成）；首次启动加载模型可能需要几十秒。' +
                '模型可从 katagotraining.org 下载，注意 transformer 架构网络（b11c768 等）需要 CUDA/TRT 后端。';
              hint.textContent = hintDefault;

              // 启停 + 状态（订阅状态事件局部刷新）
              const actionRow = document.createElement('div');
              actionRow.className = `${CSS_PREFIX}engineActionRow`;
              const startBtn = document.createElement('button');
              startBtn.type = 'button';
              startBtn.className = `${CSS_PREFIX}btn ${CSS_PREFIX}btn--primary`;
              startBtn.textContent = '启动引擎';
              const stopBtn = document.createElement('button');
              stopBtn.type = 'button';
              stopBtn.className = `${CSS_PREFIX}btn`;
              stopBtn.textContent = '停止';
              const statusLine = document.createElement('span');
              statusLine.className = `${CSS_PREFIX}engineInlineStatus`;
              const syncStatus = () => {
                const s = engineStatus();
                statusLine.textContent = s.message;
                statusLine.dataset.state = s.state;
                const running = s.state === 'ready' || s.state === 'starting';
                startBtn.disabled = running;
                stopBtn.disabled = !running;
                hint.textContent =
                  s.state === 'error' && s.stderrTail ? s.stderrTail : hintDefault;
                hint.classList.toggle(`${CSS_PREFIX}libHint--error`, s.state === 'error');
              };
              startBtn.onclick = async () => {
                const cur = loadEngineConfig();
                if (!cur.katagoPath || !cur.modelPath) {
                  statusLine.textContent = '请先填写 katago 路径与模型路径。';
                  statusLine.dataset.state = 'error';
                  return;
                }
                startBtn.disabled = true;
                try {
                  await startLocalEngine();
                } catch {
                  /* 状态已通过事件更新到状态行 */
                } finally {
                  syncStatus();
                }
              };
              stopBtn.onclick = () => {
                stopEngine();
                syncStatus();
              };
              actionRow.append(startBtn, stopBtn, statusLine);
              panel.append(actionRow, hint);
              syncStatus();
              statusSync = syncStatus;
              return;
            }

            if (cfg.mode === 'remote') {
              panel.append(makeField('端点 URL', 'remoteUrl', 'http://127.0.0.1:8080/analyze').row);
              const hint = document.createElement('div');
              hint.className = `${CSS_PREFIX}libHint`;
              hint.textContent =
                '端点契约：POST 一个 katago analysis 请求 JSON（含 id/initialStones/moves/maxVisits…），' +
                '响应同一 JSON（moveInfos/rootInfo）。适合把引擎部署在另一台机器或使用自建服务。';
              panel.append(hint);
              const testRow = document.createElement('div');
              testRow.className = `${CSS_PREFIX}engineActionRow`;
              const testBtn = document.createElement('button');
              testBtn.type = 'button';
              testBtn.className = `${CSS_PREFIX}btn`;
              testBtn.textContent = '测试连接';
              const testStatus = document.createElement('span');
              testStatus.className = `${CSS_PREFIX}engineInlineStatus`;
              testBtn.onclick = async () => {
                const url = loadEngineConfig().remoteUrl;
                if (!url) {
                  testStatus.textContent = '请先填写端点 URL。';
                  return;
                }
                testBtn.disabled = true;
                testStatus.textContent = '测试中（空盘 9 路 visits 8）…';
                try {
                  const r = await remoteEngine(url).analyze({
                    size: 9,
                    stones: [],
                    moves: [],
                    toPlay: 1,
                    visits: 8,
                  });
                  testStatus.textContent = `✓ 连接正常（黑方胜率 ${(r.blackWinrate * 100).toFixed(0)}%）`;
                } catch (err) {
                  testStatus.textContent = `✕ ${(err as Error).message}`;
                } finally {
                  testBtn.disabled = false;
                }
              };
              testRow.append(testBtn, testStatus);
              panel.append(testRow);
            }
          };

          // 状态事件 → 局部刷新（面板被宿主移除后自动解绑）
          const onStatus = () => {
            if (!el.isConnected) {
              window.removeEventListener(EVENT_ENGINE_STATUS, onStatus);
              return;
            }
            statusSync?.();
          };
          window.addEventListener(EVENT_ENGINE_STATUS, onStatus);
          renderPanel();
          el.append(panel);
          return () => {
            window.removeEventListener(EVENT_ENGINE_STATUS, onStatus);
            el.replaceChildren();
          };
          },
        });

      setting.title('学习记录');
      setting.description(
        '作答记录（含提示后作答、错题与复习池）保存在浏览器本地存储，重置后不可恢复。'
      );
      setting.action({
        key: 'resetProfile',
        label: '重置学习进度',
        description: '清空全部作答记录、复习池与评估',
        variant: 'danger',
        onClick() {
          resetProfile();
        },
      });
    },
    destroy() {
      // 声明式控件由宿主管理；custom 区域 DOM 由宿主移除
    },
  };
}
