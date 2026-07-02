"use strict";

// src/stardew-habit.ts
var VIEW_TYPE = "stardew-farm-habit";
var WOODEN_BOX_CLASS = "stardewHabit--Box";
module.exports = {
  id: "xdb-stardew-habit-tracker",
  name: "\u661F\u9732\u8C37\u7269\u8BED\u6253\u5361\u63D2\u4EF6",
  description: "\u5C06\u4E60\u60EF\u8FFD\u8E2A\u53D8\u6210\u661F\u9732\u8C37\u7269\u8BED\u50CF\u7D20\u98CE\u7684\u519C\u573A\u6A21\u62DF\u7ECF\u8425\u4F53\u9A8C\u3002",
  author: "Google DeepMind Team",
  version: "1.0.0",
  install(ctx) {
    ctx.registerStyleSheet(getStyleText());
    ctx.registerDatabaseView({
      id: VIEW_TYPE,
      name: "\u661F\u9732\u8C37\u519C\u573A",
      icon: "sprout",
      view() {
        return {
          onUpdate(props) {
            props.container.replaceChildren();
            const allRows = props.viewData.groups.flatMap((g) => g.rows ?? []);
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            const sortedRows = allRows.filter((r) => dateRegex.test(r.$item.file?.basename ?? "")).sort((a, b) => a.$item.file.basename.localeCompare(b.$item.file.basename));
            const todayStr = props.moment().format("YYYY-MM-DD");
            const options = props.viewDefinition.options ?? {};
            const activeHabits = options.habits ?? [
              { field: "\u953B\u70BC", label: "\u6BCF\u65E5\u953B\u70BC", crop: "parsnip" },
              { field: "\u9605\u8BFB", label: "\u9605\u8BFB\u5B66\u4E60", crop: "blueberry" },
              { field: "\u65E5\u8BB0", label: "\u64B0\u5199\u65E5\u8BB0", crop: "pumpkin" }
            ];
            const activeFields = activeHabits.map((h) => h.field);
            const todayRow = sortedRows.find((r) => r.$item.file.basename === todayStr);
            const habitStats = activeHabits.map((habit) => {
              const todayVal = todayRow ? todayRow.$item[habit.field] : null;
              const isDoneToday = todayVal === true || todayVal === "true" || todayVal === 1 || todayVal === "checked";
              let startIndex = sortedRows.length - 1;
              if (sortedRows.length > 0 && sortedRows[sortedRows.length - 1].$item.file.basename === todayStr && !isDoneToday) {
                startIndex = sortedRows.length - 2;
              }
              let streak = 0;
              for (let i = startIndex; i >= 0; i--) {
                const val = sortedRows[i].$item[habit.field];
                const isDone = val === true || val === "true" || val === 1 || val === "checked";
                if (isDone) {
                  streak++;
                } else {
                  break;
                }
              }
              const history = [];
              for (let i = Math.max(0, sortedRows.length - 6); i < sortedRows.length; i++) {
                const row = sortedRows[i];
                const val = row.$item[habit.field];
                history.push({
                  date: row.$item.file.basename.slice(5),
                  // 仅保留 MM-DD
                  status: val === true || val === "true" || val === 1 || val === "checked"
                });
              }
              return {
                ...habit,
                isDoneToday,
                streak,
                history
              };
            });
            const doneCount = habitStats.filter((h) => h.isDoneToday).length;
            const totalCount = habitStats.length;
            const completionRate = totalCount > 0 ? doneCount / totalCount : 0;
            const avgStreak = habitStats.length > 0 ? habitStats.reduce((sum, h) => sum + h.streak, 0) / habitStats.length : 0;
            let houseStage = 0;
            if (avgStreak >= 2 && avgStreak < 5) {
              houseStage = 1;
            } else if (avgStreak >= 5) {
              houseStage = 2;
            }
            const assetsPath = options.assetsPath || "Log/assets/stardew-habit";
            const cropsSprite = new SpriteSheet(props.app, `${assetsPath}/crops.png`, 256, 1024, 16, 16);
            const housesSprite = new SpriteSheet(props.app, `${assetsPath}/houses.png`, 272, 432, 160, 144);
            const hoeDirtSprite = new SpriteSheet(props.app, `${assetsPath}/hoeDirt.png`, 192, 64, 64, 64);
            const root = document.createElement("div");
            root.className = "stardewHabit--Root";
            let skyGradient = "linear-gradient(to bottom, #75b8e7 0%, #a4daf2 40%, #ffde9c 80%, #f7d2aa 100%)";
            if (completionRate === 0) {
              skyGradient = "linear-gradient(to bottom, #2b3a4a 0%, #4a5d6e 40%, #8b6b58 80%, #a87b65 100%)";
            } else if (completionRate > 0 && completionRate < 1) {
              skyGradient = "linear-gradient(to bottom, #609ec8 0%, #85cadf 40%, #fab475 80%, #e2946c 100%)";
            }
            root.style.background = skyGradient;
            const header = document.createElement("div");
            header.className = "stardewHabit--Header";
            const sun = document.createElement("div");
            sun.className = "stardewHabit--Sun";
            const sunLeftOffset = 20 + completionRate * 60;
            sun.style.left = `${sunLeftOffset}%`;
            header.appendChild(sun);
            const houseContainer = document.createElement("div");
            houseContainer.className = "stardewHabit--HouseContainer";
            const houseDiv = document.createElement("div");
            houseDiv.style.cssText = housesSprite.getStyleText(0, houseStage, 0.8);
            houseContainer.appendChild(houseDiv);
            header.appendChild(houseContainer);
            const summaryPanel = document.createElement("div");
            summaryPanel.className = `stardewHabit--SummaryPanel ${WOODEN_BOX_CLASS}`;
            const summaryHeader = document.createElement("div");
            summaryHeader.className = "stardewHabit--SummaryHeader";
            const dateTitle = document.createElement("div");
            dateTitle.className = "stardewHabit--DateTitle";
            dateTitle.textContent = todayStr;
            summaryHeader.appendChild(dateTitle);
            const nextDayBtn = document.createElement("button");
            nextDayBtn.className = "stardewHabit--Button";
            nextDayBtn.textContent = "\u8FC7\u4E00\u5929";
            nextDayBtn.addEventListener("click", async () => {
              new props.obsidian.Notice("\u2600\uFE0F \u65B0\u7684\u4E00\u5929\uFF01\u6B63\u5728\u4FDD\u5B58\u4ECA\u65E5\u6240\u6709\u672A\u6253\u5361\u8BB0\u5F55\u4E3A\u5B8C\u6210\u3002");
              await updateTodayHabits(props, activeFields, sortedRows, todayStr, true);
            });
            summaryHeader.appendChild(nextDayBtn);
            summaryPanel.appendChild(summaryHeader);
            const summaryTasks = document.createElement("div");
            summaryTasks.className = "stardewHabit--SummaryTasks";
            habitStats.forEach((stat) => {
              const taskItem = document.createElement("div");
              taskItem.className = "stardewHabit--SummaryTaskItem";
              const statusDot = document.createElement("span");
              statusDot.className = "stardewHabit--HistoryDot";
              statusDot.setAttribute("data-status", String(stat.isDoneToday));
              statusDot.style.width = "16px";
              statusDot.style.height = "16px";
              const taskLabel = document.createElement("span");
              taskLabel.textContent = `${stat.label} (${stat.isDoneToday ? "\u5DF2\u6253\u5361" : "\u672A\u6253\u5361"})`;
              taskItem.appendChild(statusDot);
              taskItem.appendChild(taskLabel);
              summaryTasks.appendChild(taskItem);
            });
            summaryPanel.appendChild(summaryTasks);
            header.appendChild(summaryPanel);
            root.appendChild(header);
            const farmGrid = document.createElement("div");
            farmGrid.className = "stardewHabit--FarmGrid";
            habitStats.forEach((stat) => {
              const card = document.createElement("div");
              card.className = "stardewHabit--Card";
              const cardHeader = document.createElement("div");
              cardHeader.className = "stardewHabit--CardHeader";
              const cardTitle = document.createElement("div");
              cardTitle.className = "stardewHabit--HabitTitle";
              cardTitle.textContent = stat.label;
              const stageText = document.createElement("div");
              stageText.className = "stardewHabit--StageText";
              const growthStage = Math.min(stat.streak, 5);
              const stageNames = ["\u79CD\u5B50", "\u521D\u82BD", "\u6210\u957F\u4E2D", "\u62BD\u82D7", "\u6210\u719F\u671F", "\u5927\u4E30\u6536"];
              stageText.textContent = `${stageNames[growthStage]} \xB7 ${stat.streak}\u5929`;
              cardHeader.appendChild(cardTitle);
              cardHeader.appendChild(stageText);
              card.appendChild(cardHeader);
              const fieldArea = document.createElement("div");
              fieldArea.className = "stardewHabit--FieldArea";
              const soil = document.createElement("div");
              soil.className = "stardewHabit--Soil";
              const soilCol = stat.isDoneToday ? 1 : 0;
              soil.style.cssText = hoeDirtSprite.getStyleText(soilCol, 0, 1.2);
              const cropConfig = getCropDefinitions().find((c) => c.id === stat.crop) || getCropDefinitions()[0];
              const cropImg = document.createElement("div");
              cropImg.className = "stardewHabit--CropImg";
              cropImg.style.cssText = cropsSprite.getStyleText(growthStage, cropConfig.row, 2.5);
              soil.appendChild(cropImg);
              soil.addEventListener("click", async () => {
                const nextVal = !stat.isDoneToday;
                await updateSingleHabit(props, stat.field, nextVal, sortedRows, todayStr, activeFields);
              });
              fieldArea.appendChild(soil);
              const checkWrap = document.createElement("div");
              checkWrap.className = "stardewHabit--CheckWrap";
              const checkboxLabel = document.createElement("label");
              checkboxLabel.className = "stardewHabit--CheckboxLabel";
              const cbInput = document.createElement("input");
              cbInput.type = "checkbox";
              cbInput.className = "stardewHabit--CheckboxInput";
              cbInput.checked = stat.isDoneToday;
              cbInput.addEventListener("change", async () => {
                await updateSingleHabit(props, stat.field, cbInput.checked, sortedRows, todayStr, activeFields);
              });
              const customCheck = document.createElement("span");
              customCheck.className = "stardewHabit--CustomCheck";
              const textSpan = document.createElement("span");
              textSpan.textContent = "\u5B8C\u6210\u4ECA\u65E5\u6253\u5361";
              checkboxLabel.appendChild(cbInput);
              checkboxLabel.appendChild(customCheck);
              checkboxLabel.appendChild(textSpan);
              checkWrap.appendChild(checkboxLabel);
              fieldArea.appendChild(checkWrap);
              card.appendChild(fieldArea);
              const historyTrack = document.createElement("div");
              historyTrack.className = "stardewHabit--HistoryTrack";
              stat.history.forEach((hist) => {
                const histDay = document.createElement("div");
                histDay.className = "stardewHabit--HistoryDay";
                const dateSpan = document.createElement("span");
                dateSpan.className = "stardewHabit--HistoryDate";
                dateSpan.textContent = hist.date;
                const dot = document.createElement("span");
                dot.className = "stardewHabit--HistoryDot";
                dot.setAttribute("data-status", String(hist.status));
                histDay.appendChild(dateSpan);
                histDay.appendChild(dot);
                historyTrack.appendChild(histDay);
              });
              card.appendChild(historyTrack);
              farmGrid.appendChild(card);
            });
            root.appendChild(farmGrid);
            props.container.appendChild(root);
          },
          onDestroy() {
          }
        };
      }
    });
    ctx.registerViewSettings({
      id: VIEW_TYPE,
      viewTypes: [VIEW_TYPE],
      settings() {
        return {
          onUpdate(props) {
            props.container.replaceChildren();
            const settingsRoot = document.createElement("div");
            settingsRoot.className = WOODEN_BOX_CLASS;
            settingsRoot.style.display = "flex";
            settingsRoot.style.flexDirection = "column";
            settingsRoot.style.gap = "12px";
            const title = document.createElement("h3");
            title.textContent = "\u661F\u9732\u8C37\u519C\u573A\u6253\u5361\u8BBE\u7F6E";
            title.style.margin = "0 0 8px 0";
            title.style.borderBottom = "2px solid #5a3c20";
            title.style.paddingBottom = "4px";
            settingsRoot.appendChild(title);
            const currentOptions = props.viewDefinition.options ?? {};
            const assetsPathVal = currentOptions.assetsPath || "Log/assets/stardew-habit";
            const assetsPathDiv = document.createElement("div");
            assetsPathDiv.style.display = "flex";
            assetsPathDiv.style.gap = "8px";
            assetsPathDiv.style.alignItems = "center";
            assetsPathDiv.style.backgroundColor = "#ecd8b0";
            assetsPathDiv.style.padding = "8px";
            assetsPathDiv.style.borderRadius = "6px";
            assetsPathDiv.style.border = "2px solid #5a3c20";
            const assetsPathLabel = document.createElement("span");
            assetsPathLabel.textContent = "\u7D20\u6750\u5305\u76EE\u5F55\u8DEF\u5F84:";
            assetsPathLabel.style.fontWeight = "bold";
            const assetsPathInput = document.createElement("input");
            assetsPathInput.type = "text";
            assetsPathInput.value = assetsPathVal;
            assetsPathInput.style.flex = "1";
            assetsPathInput.style.border = "2px solid #5a3c20";
            assetsPathInput.style.borderRadius = "4px";
            assetsPathInput.style.padding = "2px 4px";
            assetsPathInput.addEventListener("change", () => {
              const normalized = normalizePath(assetsPathInput.value);
              void props.setViewDefinition((current) => ({
                ...current,
                options: { ...current.options ?? {}, assetsPath: normalized }
              }));
            });
            assetsPathDiv.appendChild(assetsPathLabel);
            assetsPathDiv.appendChild(assetsPathInput);
            settingsRoot.appendChild(assetsPathDiv);
            const habits = currentOptions.habits ?? [
              { field: "\u953B\u70BC", label: "\u6BCF\u65E5\u953B\u70BC", crop: "parsnip" },
              { field: "\u9605\u8BFB", label: "\u9605\u8BFB\u5B66\u4E60", crop: "blueberry" },
              { field: "\u65E5\u8BB0", label: "\u64B0\u5199\u65E5\u8BB0", crop: "pumpkin" }
            ];
            habits.forEach((habit, index) => {
              const itemDiv = document.createElement("div");
              itemDiv.style.display = "flex";
              itemDiv.style.gap = "8px";
              itemDiv.style.alignItems = "center";
              itemDiv.style.backgroundColor = "#ecd8b0";
              itemDiv.style.padding = "8px";
              itemDiv.style.borderRadius = "6px";
              itemDiv.style.border = "2px solid #5a3c20";
              const labelField = document.createElement("span");
              labelField.textContent = "\u6253\u5361\u5B57\u6BB5:";
              const inputField = document.createElement("input");
              inputField.type = "text";
              inputField.value = habit.field;
              inputField.style.width = "70px";
              inputField.style.border = "2px solid #5a3c20";
              inputField.style.borderRadius = "4px";
              inputField.addEventListener("change", () => {
                updateHabitsOption(props, index, "field", inputField.value);
              });
              const labelName = document.createElement("span");
              labelName.textContent = "\u663E\u793A\u540D\u79F0:";
              const inputLabel = document.createElement("input");
              inputLabel.type = "text";
              inputLabel.value = habit.label;
              inputLabel.style.width = "90px";
              inputLabel.style.border = "2px solid #5a3c20";
              inputLabel.style.borderRadius = "4px";
              inputLabel.addEventListener("change", () => {
                updateHabitsOption(props, index, "label", inputLabel.value);
              });
              const labelCrop = document.createElement("span");
              labelCrop.textContent = "\u4F5C\u7269:";
              const selectCrop = document.createElement("select");
              selectCrop.style.border = "2px solid #5a3c20";
              selectCrop.style.borderRadius = "4px";
              getCropDefinitions().forEach((def) => {
                const opt = document.createElement("option");
                opt.value = def.id;
                opt.textContent = def.name.split(" (")[0];
                if (def.id === habit.crop) {
                  opt.selected = true;
                }
                selectCrop.appendChild(opt);
              });
              selectCrop.addEventListener("change", () => {
                updateHabitsOption(props, index, "crop", selectCrop.value);
              });
              const delBtn = document.createElement("button");
              delBtn.className = "stardewHabit--Button";
              delBtn.style.padding = "2px 6px";
              delBtn.textContent = "\u5220\u9664";
              delBtn.addEventListener("click", () => {
                const nextHabits = habits.filter((_, idx) => idx !== index);
                void props.setViewDefinition((current) => ({
                  ...current,
                  options: { ...current.options ?? {}, habits: nextHabits }
                }));
              });
              itemDiv.appendChild(labelField);
              itemDiv.appendChild(inputField);
              itemDiv.appendChild(labelName);
              itemDiv.appendChild(inputLabel);
              itemDiv.appendChild(labelCrop);
              itemDiv.appendChild(selectCrop);
              itemDiv.appendChild(delBtn);
              settingsRoot.appendChild(itemDiv);
            });
            const addBtn = document.createElement("button");
            addBtn.className = "stardewHabit--Button";
            addBtn.textContent = "\u6DFB\u52A0\u65B0\u4E60\u60EF";
            addBtn.style.alignSelf = "flex-start";
            addBtn.addEventListener("click", () => {
              const newHabit = { field: "\u65B0\u4E60\u60EF", label: "\u65B0\u6253\u5361\u4E60\u60EF", crop: "parsnip" };
              void props.setViewDefinition((current) => ({
                ...current,
                options: { ...current.options ?? {}, habits: [...habits, newHabit] }
              }));
            });
            settingsRoot.appendChild(addBtn);
            props.container.appendChild(settingsRoot);
          },
          onDestroy() {
          }
        };
      }
    });
    return () => void 0;
  }
};
var SpriteSheet = class {
  constructor(app, vaultPath, imgWidth, imgHeight, spriteWidth = 16, spriteHeight = 16) {
    this.cachedUrl = null;
    this.app = app;
    this.vaultPath = vaultPath;
    this.imgWidth = imgWidth;
    this.imgHeight = imgHeight;
    this.spriteWidth = spriteWidth;
    this.spriteHeight = spriteHeight;
  }
  getUrl() {
    if (this.cachedUrl) {
      return this.cachedUrl;
    }
    const normalizedPath = normalizePath(this.vaultPath);
    let file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (file) {
      this.cachedUrl = this.app.vault.getResourcePath(file);
      return this.cachedUrl;
    }
    console.warn(`[Stardew Habit] \u7D20\u6750\u6587\u4EF6\u672A\u627E\u5230: ${normalizedPath}`);
    return "";
  }
  getStyleObject(col, row, scale = 3) {
    const url = this.getUrl();
    const width = this.spriteWidth * scale;
    const height = this.spriteHeight * scale;
    const sizeX = this.imgWidth * scale;
    const sizeY = this.imgHeight * scale;
    const posX = -(col * this.spriteWidth * scale);
    const posY = -(row * this.spriteHeight * scale);
    return {
      "display": "inline-block",
      "width": `${width}px`,
      "height": `${height}px`,
      "background-image": `url("${url}")`,
      "background-repeat": "no-repeat",
      "background-size": `${sizeX}px ${sizeY}px`,
      "background-position": `${posX}px ${posY}px`,
      "image-rendering": "pixelated"
    };
  }
  getStyleText(col, row, scale = 3) {
    const obj = this.getStyleObject(col, row, scale);
    return Object.entries(obj).map(([k, v]) => `${k}: ${v};`).join(" ");
  }
};
function normalizePath(path) {
  let cleaned = path.trim();
  cleaned = cleaned.replace(/\\/g, "/");
  if (cleaned.startsWith("./")) {
    cleaned = cleaned.slice(2);
  }
  while (cleaned.startsWith("/")) {
    cleaned = cleaned.slice(1);
  }
  while (cleaned.endsWith("/")) {
    cleaned = cleaned.slice(0, -1);
  }
  cleaned = cleaned.replace(/\/+/g, "/");
  return cleaned;
}
function getCropDefinitions() {
  return [
    { id: "parsnip", name: "\u9632\u98CE\u8349 (Parsnip)", row: 0, maxStage: 5 },
    { id: "greenbean", name: "\u7EFF\u8C46 (Green Bean)", row: 1, maxStage: 5 },
    { id: "cauliflower", name: "\u6930\u83DC (Cauliflower)", row: 2, maxStage: 5 },
    { id: "potato", name: "\u571F\u8C46 (Potato)", row: 3, maxStage: 5 },
    { id: "garlic", name: "\u5927\u849C (Garlic)", row: 4, maxStage: 5 },
    { id: "kale", name: "\u7518\u84DD (Kale)", row: 5, maxStage: 5 },
    { id: "rhubarb", name: "\u5927\u9EC4 (Rhubarb)", row: 6, maxStage: 5 },
    { id: "melon", name: "\u751C\u74DC (Melon)", row: 7, maxStage: 5 },
    { id: "tomato", name: "\u756A\u8304 (Tomato)", row: 8, maxStage: 5 },
    { id: "blueberry", name: "\u84DD\u8393 (Blueberry)", row: 9, maxStage: 5 },
    { id: "hotpepper", name: "\u8FA3\u6912 (Hot Pepper)", row: 10, maxStage: 5 },
    { id: "starfruit", name: "\u6768\u6843 (Starfruit)", row: 11, maxStage: 5 },
    { id: "corn", name: "\u7389\u7C73 (Corn)", row: 12, maxStage: 5 },
    { id: "hops", name: "\u5564\u9152\u82B1 (Hops)", row: 13, maxStage: 5 },
    { id: "eggplant", name: "\u8304\u5B50 (Eggplant)", row: 14, maxStage: 5 },
    { id: "pumpkin", name: "\u5357\u74DC (Pumpkin)", row: 15, maxStage: 5 },
    { id: "bokchoy", name: "\u5C0F\u767D\u83DC (Bok Choy)", row: 16, maxStage: 5 },
    { id: "taro", name: "\u828B\u5934 (Taro)", row: 17, maxStage: 5 },
    { id: "cranberry", name: "\u8513\u8D8A\u8393 (Cranberry)", row: 18, maxStage: 5 },
    { id: "sunflower", name: "\u5411\u65E5\u8475 (Sunflower)", row: 19, maxStage: 5 },
    { id: "cactus", name: "\u4ED9\u4EBA\u638C (Cactus)", row: 20, maxStage: 5 }
  ];
}
function updateHabitsOption(props, index, key, val) {
  void props.setViewDefinition((current) => {
    const habits = [...current.options?.habits ?? []];
    if (habits[index]) {
      habits[index] = { ...habits[index], [key]: val };
    }
    return {
      ...current,
      options: { ...current.options ?? {}, habits }
    };
  });
}
async function updateSingleHabit(props, field, value, sortedRows, todayStr, activeFields) {
  const todayRow = sortedRows.find((r) => r.$item.file.basename === todayStr);
  if (todayRow) {
    await props.api.updateCell(todayRow.id, field, value);
  } else {
    await createTodayFile(props, todayStr, sortedRows, activeFields, field, value);
  }
}
async function updateTodayHabits(props, fields, sortedRows, todayStr, value) {
  const todayRow = sortedRows.find((r) => r.$item.file.basename === todayStr);
  if (todayRow) {
    const updates = {};
    fields.forEach((f) => {
      updates[f] = value;
    });
    await props.api.updateRow(todayRow.id, updates);
  } else {
    await createTodayFile(props, todayStr, sortedRows, fields, "", value, true);
  }
}
async function createTodayFile(props, todayStr, sortedRows, activeFields, targetField, targetValue, allTrue = false) {
  let parentFolder = "";
  if (sortedRows.length > 0) {
    const path = sortedRows[0].$item.file.path;
    const parts = path.split("/");
    if (parts.length > 1) {
      parentFolder = parts.slice(0, -1).join("/") + "/";
    }
  }
  const todayFilePath = `${parentFolder}${todayStr}.md`;
  let content = `---
tags: daily-note
---

# \u4ECA\u65E5\u6253\u5361

`;
  activeFields.forEach((f) => {
    let val = false;
    if (allTrue) {
      val = true;
    } else if (f === targetField) {
      val = targetValue;
    }
    content += `[${f}:: ${val}]
`;
  });
  try {
    await props.app.vault.create(todayFilePath, content);
    new props.obsidian.Notice(`\u{1F4D6} \u5DF2\u4E3A\u60A8\u81EA\u52A8\u521B\u5EFA\u4ECA\u65E5\u65E5\u8BB0: ${todayStr}.md`);
  } catch (err) {
    console.error("[Stardew Habit] \u521B\u5EFA\u4ECA\u65E5\u65E5\u8BB0\u5931\u8D25", err);
    new props.obsidian.Notice(`\u2717 \u521B\u5EFA\u4ECA\u65E5\u65E5\u8BB0\u5931\u8D25: ${err?.message ?? err}`);
  }
}
function getStyleText() {
  return `/* \u661F\u9732\u8C37\u98CE\u683C\u6253\u5361\u63D2\u4EF6\u5168\u5C40\u6837\u5F0F\u8868 */

/* \u6447\u6446\u52A8\u753B - \u6A21\u62DF\u5FAE\u98CE\u62C2\u8FC7\u4F5C\u7269 */
@keyframes stardewHabit--sway {
  0% { transform: rotate(0deg); }
  25% { transform: rotate(-3deg) skewX(-2deg); }
  75% { transform: rotate(3deg) skewX(2deg); }
  100% { transform: rotate(0deg); }
}

/* \u592A\u9633\u5347\u964D/\u547C\u5438\u5FAE\u52A8\u753B */
@keyframes stardewHabit--sunPulse {
  0% { transform: scale(1); filter: drop-shadow(0 0 4px rgba(247, 196, 68, 0.6)); }
  50% { transform: scale(1.05); filter: drop-shadow(0 0 12px rgba(247, 196, 68, 0.9)); }
  100% { transform: scale(1); filter: drop-shadow(0 0 4px rgba(247, 196, 68, 0.6)); }
}

.stardewHabit--Root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 500px;
  background: linear-gradient(to bottom, #75b8e7 0%, #a4daf2 40%, #ffde9c 80%, #f7d2aa 100%);
  font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #3f2214;
  padding: 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  image-rendering: pixelated;
}

/* \u50CF\u7D20\u98CE\u6728\u7EB9\u5BF9\u8BDD\u6846\u6837\u5F0F */
.stardewHabit--Box {
  background-color: #f7e0b5;
  border: 4px solid #5a3c20;
  border-radius: 8px;
  box-shadow: 
    inset -3px -3px 0px 0px #d8a065,
    inset 3px 3px 0px 0px #fff7e6,
    0px 4px 10px rgba(0, 0, 0, 0.15);
  padding: 16px;
  position: relative;
}

/* \u9876\u90E8\u73AF\u5883\u533A */
.stardewHabit--Header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  height: 160px;
  position: relative;
  border-bottom: 4px dashed #5a3c20;
  padding-bottom: 8px;
}

/* \u592A\u9633 */
.stardewHabit--Sun {
  width: 48px;
  height: 48px;
  background-color: #f7c444;
  border-radius: 50%;
  position: absolute;
  top: 20px;
  right: 50px;
  border: 4px solid #5a3c20;
  animation: stardewHabit--sunPulse 4s ease-in-out infinite;
  z-index: 1;
}

/* \u519C\u5C45 */
.stardewHabit--HouseContainer {
  position: relative;
  width: 120px;
  height: 120px;
  margin-right: 120px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

/* \u519C\u7530\u7F51\u683C */
.stardewHabit--FarmGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  padding: 8px 0;
}

/* \u4E60\u60EF\u519C\u7530\u5361\u7247 */
.stardewHabit--Card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background-color: #f7e0b5;
  border: 4px solid #5a3c20;
  border-radius: 8px;
  padding: 12px;
  box-shadow: 
    inset -3px -3px 0px 0px #d8a065,
    inset 3px 3px 0px 0px #fff7e6;
  position: relative;
}

.stardewHabit--CardHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 2px solid #bfa07a;
  padding-bottom: 6px;
}

.stardewHabit--HabitTitle {
  font-weight: 800;
  font-size: 1.1em;
  color: #3f2214;
}

.stardewHabit--StageText {
  font-size: 0.85em;
  color: #8c5a36;
  background-color: #ecd8b0;
  padding: 2px 6px;
  border-radius: 4px;
  border: 2px solid #5a3c20;
}

/* \u4F5C\u7269\u8015\u5730\u533A */
.stardewHabit--FieldArea {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #e5cc9c;
  border: 2px solid #5a3c20;
  border-radius: 6px;
  padding: 8px;
}

/* \u6CE5\u571F */
.stardewHabit--Soil {
  width: 48px;
  height: 48px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.1s ease;
  border: 2px solid #5a3c20;
}

.stardewHabit--Soil:hover {
  transform: scale(1.05);
}

.stardewHabit--CropImg {
  animation: stardewHabit--sway 3s ease-in-out infinite;
  transform-origin: bottom center;
}

/* \u5361\u7247\u91CC\u7684\u6253\u5361\u63A7\u5236\u6846 */
.stardewHabit--CheckWrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.9em;
}

.stardewHabit--CheckboxLabel {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

/* \u661F\u9732\u8C37\u98CE\u683C\u590D\u9009\u6846 */
.stardewHabit--CheckboxInput {
  display: none;
}

.stardewHabit--CustomCheck {
  width: 20px;
  height: 20px;
  border: 3px solid #5a3c20;
  background-color: #ecd8b0;
  border-radius: 4px;
  position: relative;
  box-shadow: inset -2px -2px 0px 0px #bfa07a;
}

.stardewHabit--CheckboxInput:checked + .stardewHabit--CustomCheck {
  background-color: #4ebf3f;
}

.stardewHabit--CheckboxInput:checked + .stardewHabit--CustomCheck::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 1px;
  width: 6px;
  height: 10px;
  border: solid white;
  border-width: 0 3px 3px 0;
  transform: rotate(45deg);
}

/* \u5386\u53F2\u8F68\u8FF9\u8BB0\u5F55 */
.stardewHabit--HistoryTrack {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  justify-content: space-between;
  background: #dfc89f;
  padding: 4px;
  border-radius: 4px;
  border: 2px solid #5a3c20;
}

.stardewHabit--HistoryDay {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex: 1;
}

.stardewHabit--HistoryDate {
  font-size: 0.7em;
  color: #7a5435;
  font-weight: bold;
}

.stardewHabit--HistoryDot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid #5a3c20;
}

.stardewHabit--HistoryDot[data-status="true"] {
  background-color: #4ebf3f;
}

.stardewHabit--HistoryDot[data-status="false"] {
  background-color: #d1563f;
}

/* \u4ECA\u65E5\u770B\u677F */
.stardewHabit--SummaryPanel {
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stardewHabit--SummaryHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stardewHabit--DateTitle {
  font-size: 1.4em;
  font-weight: 900;
  color: #3f2214;
}

.stardewHabit--SummaryTasks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stardewHabit--SummaryTaskItem {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95em;
  color: #3f2214;
}

/* \u4E00\u952E\u6253\u5361/\u8FC7\u4E00\u5929\u6309\u94AE */
.stardewHabit--Button {
  background-color: #f7a244;
  border: 3px solid #5a3c20;
  border-radius: 6px;
  color: white;
  font-weight: bold;
  padding: 4px 12px;
  cursor: pointer;
  box-shadow: 
    inset -2px -2px 0px 0px #b56c22,
    0px 2px 4px rgba(0, 0, 0, 0.1);
  text-shadow: 1px 1px 0px #5a3c20;
  transition: transform 0.1s ease;
}

.stardewHabit--Button:hover {
  transform: translateY(-2px);
  background-color: #fcae58;
}

.stardewHabit--Button:active {
  transform: translateY(1px);
}
`;
}
