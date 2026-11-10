# policy-review-workbench（中文）

> English: [README.md](./README.md)

**脱机制度审查工作台**——解析 → 对照比对 → QC → 导出 的分层状态机；默认不连网，CASE-A/B/C/D 等离线验收测试可跑。

[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-8%20suites-orange)](#testing)

## 为什么做这个

制度/合规审查需要**可重复的链路**：收条文 → 对照上位/配套/旧版 → QC 门禁 → 导出报告——且草稿不能被当成「已批准」。本工作台把它编码为：

- **解析层** — 文件 → 结构化条文（异步任务；失败标志阻断链路）。**仅桩实现，不读取文件正文。**
- **流程矩阵** — 纯状态机：下一步哪些操作合法（比对 / QC / 导出 / 暂停）
- **比对与 QC 层** — 契约形状的载荷（Dify 兼容桩；以后可换真实 HTTP 后端）
- **导出层（Node 模块）** — 受控的**纯文本报告 + CSV + JSON + metadata** 草稿（非二进制 `.docx`）；状态未到位则阻断

**安全默认：本地 Mock** —— 不连网、**不解析文件正文**。Webhook/Dify 字段可选（`http://127.0.0.1:...`）。不接 OA、不带生产凭据。

## 快速开始

```bash
# 打开界面 — 需同目录下同时有 HTML 与 policy-review-progress.js
# （不是单文件自包含 HTML）
start workbench.html          # Windows — 中文界面
start workbench.en.html       # Windows — 英文界面
open workbench.html           # macOS — 中文界面
open workbench.en.html        # macOS — 英文界面

# 跑全部离线测试（不联网）
node test-parse-layer.js
node test-flow-matrix.js
node test-dify-export.js
node test-export-source.js     # 结果来源 + CSV 表头 + metadata.json
node test-progress-restore.js  # 旧版「可导出」进度恢复后不得再可导
node test-export-gate-wiring.js # 界面按钮/点击调用 canExport（而非仅 flag+状态）
node test-case-acceptance.js   # 写入 CASE_ACCEPTANCE_RESULT.json
node test-case-b.js            # 合并 CASE-B 到记分文件
```

**完整顺序**（acceptance 再 CASE-B）跑完后：各脚本 exit 0；记分 `CASE-A/B/C/D = pass`、`acceptance: "pass"`、`p1_open: 0`。

若在干净目录**只跑** `test-case-b.js`，记分为 **partial**（仅 CASE-B，`ok: false`）——**不会**谎称四案全过。

## 架构

| 文件 | 职责 |
|---|---|
| `workbench.html` | 中文 UI（样式 + 业务 JS 内联）— **需要**同目录 `policy-review-progress.js` |
| `workbench.en.html` | 英文 UI（同一套逻辑，文案英文化）— 依赖相同 |
| `policy-review-progress.js` | 保存/恢复 + **`canExport`** 门禁 — 界面按钮/点击与测试共用 |
| `policy-review-parse-layer.js` | 解析桩：类型检测、异步任务状态、核心依据失败 |
| `policy-review-flow-matrix.js` | 纯状态机 → 按钮启用/禁用 |
| `policy-review-dify-layer.js` | 比对/QC 输入契约（`dify_io_v0.1`）+ 桩结果 |
| `policy-review-export-layer.js` | 导出门禁、按来源写免责、metadata.json、局部失败 |
| `test-*.js` | Node 单测 + CASE 验收 |
| `CASE_ACCEPTANCE_RESULT.json` | 最近一次验收记分 |

### 已知限制（如实列出）

- **架构原型 / 离线验收架** —— 不是生产合规系统。
- **解析层是桩**（异步任务模拟 + 失败标志），**不**从真实 PDF/DOCX 抽正文。界面有常驻**演示横幅**，声明模拟结果不是对你所选文件的分析。
- **两条导出路径，勿混淆：**
  - **Node `export-layer` 模块** → `.txt` 报告 + `.csv` + `.json` + **`metadata.json`**（来源 + 免责）。CSV 首行是**标准表头**（无 `#` 前缀行）。
  - **界面按钮**（导出报告 `.doc` / 导出对照表 `.xls`）→ **HTML 包装**下载，扩展名为 `.doc`/`.xls`，**不是**原生 OOXML。
- **结果来源在结果产生时记录**（`local_mock` | `n8n` | `unknown`），不是导出时再看模式开关；导出免责跟随已记录来源（n8n 结果不会被标成 Mock）。
- **`metadata.json` 是配套文件**：CSV 或 QC JSON 单独转发时，来源说明**不会**跟着走——请一并保留 `metadata.json`。
- **「保存进度」只持久化表单/元数据**，不保存比对/QC/`result_source`；刷新后须重新「开始审查」才能导出（永不恢复「可导出」）。
- **进度键按语言隔离**（`irw_oneshot_zh_*` / `irw_oneshot_en_*`）。中英文页**不共享**草稿（分类标签因语言而异）；旧的无前缀键会被忽略。
- **默认本地 Mock** —— 不发 HTTP。选 n8n 并填 Webhook 后，浏览器会把载荷 `fetch` 到**你填写的 URL**；留空则保持离线。
- **Dify 层是契约桩**（`dify_io_v0.1`）；接真后端需自行接线。
- 单测 + CASE 测试均为**离线**（无真实 n8n/Dify/OA），不能证明端到端后端行为。恢复规则经 `policy-review-progress.js` 与 UI 共用。
- 导出物在人工复核前只是**草稿**；工具不作出最终法律/审计结论。**界面与模块导出会在文件内嵌入来源/模拟免责**，随下载一起传播。

### 链路门禁（摘要）

1. **解析**必须完成；核心依据失败 → `parse_flagged` → 比对/导出**阻断**，允许重解析。
2. **警告**（低置信、缺历史版本）**不**硬阻断——只打标。
3. **导出**需显式允许 + 状态 `ready_for_export`；产物命名含 case id + 时间戳。
4. 离线验收：**A** 成功主链、**B** 警告路径、**C** 解析核心失败、**D** 导出门禁/重试。

## 可选后端（非必需）

界面默认 **本地 Mock**（不联网）。可选：

- **n8n Webhook** — 选 n8n 模式并填 URL 后，浏览器会 `POST` 案件载荷到**该 URL**；仅在你信任该端点时启用。
- **Dify 兼容契约** — 接真服务时保持 `buildDifyInput()` 的 JSON 形状。

留空即纯离线使用。

## 测试

```bash
node test-parse-layer.js && node test-flow-matrix.js && node test-dify-export.js \
  && node test-export-source.js && node test-progress-restore.js \
  && node test-export-gate-wiring.js \
  && node test-case-acceptance.js && node test-case-b.js
```

纯 Node，**无需 npm install**。验收脚本读写脚本旁的 `CASE_ACCEPTANCE_RESULT.json`。恢复与导出门禁在 `policy-review-progress.js`，并**已接入** `workbench.html` 与 `workbench.en.html`。`test-export-gate-wiring.js` 还会对**两页内联脚本做语法检查**（`vm.Script`），并断言按钮与点击均调用 `canExport`。覆盖：旧 `ready_for_export` 草稿恢复后禁导；**按钮启用与点击使用同一谓词**（flag + 状态 + 实时 rows + qc）。

## 范围与安全

- **会做：** 本地条文**桩**、状态机、受控**模块** text/CSV/JSON 导出、界面 HTML 包装 `.doc`/`.xls`、离线验收。
- **不会做：** 解析真实 PDF/DOCX 二进制；产出原生 `.docx`/`.xlsx`；未配置 Webhook 时连 OA/生产 Dify/n8n；作出最终法律/合规结论；读取密钥。
- 导出草稿在人工复核前只当**草稿**。

## License

[MIT](./LICENSE)
