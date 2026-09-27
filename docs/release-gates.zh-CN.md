# 企业经营研究工作台：Windows 发布验收

候选版本只有在所有必需本地验收通过、且明确说明 fixture 与真实服务边界后才可接受。本项目仅面向 Windows 桌面；不验收 macOS 构建。

## 必需的离线验收

| 验收 | 命令 | 标准 |
| --- | --- | --- |
| 类型检查 | `bun run typecheck` | workspace 全部包通过 |
| 单元/集成测试 | `bun run test:unit` | 0 失败 |
| 翻译校验 | `bun run i18n:check` | 中英文键与插值参数一致 |
| Windows 构建 | `bun run build` | renderer、main、preload、共享包和 Pi 扩展可打包 |
| Fixture 研究评测 | `bun run --filter @finagent/electron test` / workspace fixture evaluator | 固定语料 24/24；任务目录为 6 类、策略为 3 套 |
| 桌面 E2E | `bun run test:e2e` | 项目→运行→决策/证据→报告→关联追问→重载；监控运行保留项目归属 |
| Windows 安装包 | `bun run release:package` | 生成 NSIS 安装程序和 SHA-256 清单 |
| 打包冒烟 | `bun run test:package-smoke` | 打包应用启动、加载随包 Pi Runtime 并持久化研究项目 |
| 干净安装冒烟 | `bun run test:installer-smoke` | 在隔离临时目录静默安装 NSIS 包，启动 Pi 和界面、创建项目、卸载，并只清理该临时目录 |

如果 Windows 账户无法在解包 electron-builder 签名工具时创建符号链接，可先设置 `FINAGENT_SKIP_WIN_RESOURCE_EDIT=1` 再运行 `bun run release:package`。这个显式回退会跳过 exe 图标和版本元数据编辑，不改变运行时内容；默认构建仍保留正常品牌资源编辑。

24 个 fixture 案例是确定性验收，不代表真实模型准确率。机器可读记录必须给出分子、分母、样本数和耗时统计口径。不得沿用 Folio 投资研究的 17/8/86 目录或评测数字。

## 需凭证的独立验收（可选）

- 真实模型动态决策：两组证据反事实输入都必须导致合法且不同的下一步动作，非法工具调用为 0。
- 公开来源监控：真实检测到变化后，必须创建归属原项目的新运行。
- 这些验收会调用外部服务，可能产生费用。未配置凭证或未执行时必须标注待验收，不得写成通过。

## 数据与迁移核验

- 将旧企业研究记录迁移执行两遍；第二遍不能改变目标内容或覆盖既有目标记录。
- 改变显示品牌后仍使用稳定的 Windows userData 目录。
- 清理 `Market-Intelligence-Agent/live-e2e` 前，逐个清点并检查文件、先留可恢复副本，只移除已确认的投资数据，保留企业研究记录和凭证。不得删除整个档案或未跟踪的 `tmp/`。
- 检查可达导航、IPC、依赖、preload 导出、文档和素材均无投资产品功能或 Longbridge 依赖。
