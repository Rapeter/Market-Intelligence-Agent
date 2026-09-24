# Market Intelligence Agent

面向企业经营、战略和产品团队的桌面研究工作台。Agent 根据公开信息和每一步获得的证据，动态选择下一项研究动作，生成带来源、冲突与信息缺口的竞品和行业报告，并在应用运行时追踪新信息。

> 当前为 alpha。企业研究工作流及其桌面界面已实现；本页把确定性 fixture 验收与真实模型/公开搜索验证分开报告。桌面与 Agent 基础来自与 helsome 共同开发的 Folio，并保留其历史及贡献记录。

## 研究工作流

- 6 类研究任务：行业格局、竞品产品、价格与渠道、公开反馈、政策与技术风险、证据变化核查。
- 3 套策略：行业概览、竞品深挖、变化与风险追踪。策略调整任务优先级与检索预算；Agent 每一步只可选择公开检索、打开本次运行发现的来源或结束。
- 报告区分搜索摘要与已读取网页正文，保存引用、冲突、未解问题与证据等级。搜索摘要不会被标成已核验的网页正文。
- 订阅在应用运行期间按间隔检查；新来源或已知来源的实质变化可以触发后续研究，并与旧报告比较。应用关闭期间不承诺后台监控；重启后最多补做一次逾期检查。

系统只使用公开可访问的信息。网页中抽取的日期、产品或公开价格会保留来源 URL 和原文片段；公开评论只作为可能有偏的反馈信号，不等同于代表性客户调研。当前版本不接入企业内网、客户调研系统或独立的结构化企业数据服务。

## 验收结果

以下结果来自本地确定性 fixture 验收，不是实时模型准确率，也不代表真实市场结论。

| 指标 | 结果 | 统计口径 |
| --- | --- | --- |
| 研究任务 / 策略 | 6 / 3 | 项目内置目录中的唯一任务与策略 ID |
| 可执行评测案例 | 24/24 通过；0 失败、0 排除 | 固定脚本决策与快照，覆盖研究运行、报告/引用安全、故障恢复和自动触发；不用于推断真实模型泛化能力 |
| 桌面研究流程 | 2 次持久化运行，各含 2 条 fixture 证据 | 从点击开始到终态报告可见：本次样本 1,511 ms、1,491 ms；仅为本机 fixture 耗时，不是 SLA |
| 监控集成 | 3 次检查；新来源与来源更新触发 2 次后续研究；重复信号被抑制 | 使用两个固定快照；0 次网络请求；本次检查耗时 52 ms、38 ms、4 ms，不代表真实网站延迟 |
| 重载与报告差异 | 通过 | 重新加载后 run、report、事件和暂停状态仍可读取；第二次同主题运行显示 2 条新证据 |

任务完成、工具选择、引证有效率/事实覆盖、冲突识别、故障恢复、触发精确率/召回率各自的分子、分母与通过阈值，逐项定义在[评测指标与验收口径](docs/superpowers/specs/2026-09-23-market-intelligence-agent-design.md#评测指标统计口径与通过条件)。比例分母为 0 时记为不适用；不得只报百分比而省略样本数。耗时单位为毫秒；评测 p50 是算术中位数，p95 使用 nearest-rank（排序后第 `ceil(0.95 × N)` 个样本）。本次 UI fixture 的两个运行耗时只报告原始值，不作为性能承诺。

真实模型的同主题反事实决策（不同证据导致不同的下一步工具选择）和真实公开搜索源的变化触发尚未完成验收；fixture 成绩不能替代这两项。它们需要配置真实模型与 Brave Search 凭证后单独执行。

验收截图：

![首次 fixture 报告：来源清楚标注为说明性数据，未解问题保留为未知](docs/demos/business-research/fixture-first-report.png)

![同主题再次研究显示新增证据差异](docs/demos/business-research/fixture-rerun-diff.png)

![应用重载后监控订阅仍保留暂停状态](docs/demos/business-research/fixture-monitor-paused.png)

[查看机器可读 fixture 验收记录](docs/demos/business-research/fixture-verification.json)。

## 技术结构

```text
React 工作台
   │ typed IPC
Electron 主进程 ── 持久化、凭证、调度、公开检索
   │
业务研究 Runtime ── Agent 决策 → 工具调用 → 观察 → 报告
   │
Folio 既有 Pi Agent 运行时与桌面基础
```

## 本地运行

需要 Bun 和 Node.js。安装依赖并启动桌面开发模式：

```bash
bun install
bun run dev
```

运行无需外部网络或 API 凭证的研究工作流验收：

```bash
bun run --filter @finagent/electron test:e2e:business-research
```

实时研究还需要可用的模型提供方和 Brave Search 凭证；凭证由应用主进程安全保存。fixture 示例明确标为说明性数据，不能当作实时结论。

真实模型与公开搜索验收使用独立的本地档案，不要把凭证写进仓库、命令参数或聊天。Windows PowerShell 示例：

```powershell
$liveProfile = Join-Path $env:LOCALAPPDATA 'Market-Intelligence-Agent\live-e2e'
bun run --filter @finagent/electron business-research:live-profile -- prepare "$liveProfile"
bun run --filter @finagent/electron business-research:live-profile -- open "$liveProfile"
```

应用窗口打开后，在设置中配置模型提供方，并在 Market Intelligence 工作区配置 Brave Search。保存后回到终端按 Enter 关闭窗口；此档案会保留在本机供后续验收使用。脚本只会标记空目录或自己已标记的目录，并拒绝仓库内路径和未标记的非空目录。

## 项目历史与贡献

我与 helsome 共同开发了 Folio。本仓库保留 Folio 的提交历史和既有贡献记录；Market Intelligence Agent 的企业研究领域、动态决策、公开信息追踪、评测集与演示材料在此仓库中实现并持续验证。Folio 原有的股票筛选、投资策略和评测案例不计为本项目新增的企业研究成果。

## 状态

当前验收边界：fixture 研究、持久化、报告差异、监控触发/去重和 UI 重载已通过；真实模型反事实决策与真实公开源监控仍待凭证配置后的现场验证。项目内的 6/3/24 是这套企业研究目录和案例数，不沿用 Folio 投资研究中的 17/8/86，也不宣称两组数字等价。
