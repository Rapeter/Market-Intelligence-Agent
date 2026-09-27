# 企业经营研究工作台：系统架构

## 范围

本 Windows 桌面产品保留与 helsome 共同开发 Folio 时形成的 Electron / React 桌面框架、Pi Agent 运行基础、项目/会话体验和三栏 UI。当前业务域仅为基于公开信息的企业经营研究；不宣称引入或使用 Craft Agents 源码。

## 运行时与数据流

```
React renderer
  ├─ 左侧：研究项目选择与创建
  ├─ 中间：项目范围、运行、决策轨迹、证据、报告、监控、fixture 指标
  └─ 右侧：关联项目的 Agent 提问和追问
        │ 类型化、白名单 IPC
Electron 主进程
  ├─ 项目/研究仓库（原子 JSON 文件）
  ├─ CredentialStore（主进程加密保存模型凭据）
  ├─ BusinessResearchService 与监控调度器
  └─ Pi 运行时宿主
        │ 按运行隔离的工具适配器
Pi Agent 扩展
  ├─ business_research_search
  └─ business_research_open
```

项目是持久化根节点。Agent 的问题会创建企业研究运行，并作为研究任务传入 Pi 运行时。决策事件、工具调用、证据、报告和追问关系复用同一运行 ID。监控触发的新运行继承订阅所属的项目和主题。

## 持久化与迁移

- 仓库通过共享的原子 JSON 存储写入，并对 Windows 上短暂的文件重命名失败进行有限重试。
- 旧企业研究数据迁移可重复执行；目标记录已存在时不覆盖。
- Windows 版改名后继续使用 `%APPDATA%\Market Intelligence Agent` 作为 userData 目录，以保留旧版本项目与加密凭据。
- 真实模型 E2E 使用显式指定的 `FINAGENT_USER_DATA_DIR` 专用档案，与默认用户档案分开。
- Windows 安装包将 Pi CLI 作为应用依赖一同交付，并通过 Electron 的 Node Runtime 启动；终端用户无需另装 Bun。

## 安全边界

- Renderer 只能经类型化 IPC 访问能力，不能直接触及文件系统、凭据或 Pi 进程。
- 真实搜索密钥保留在主进程凭据库，只注入可信工具适配器，不放入工具参数。
- Agent 只能检索公开网页，并打开本次运行发现的来源。
- 诊断输出对凭据脱敏，仅报告环境与运行状态。
- 仍支持用户提供的模型提供方覆盖和自定义模型端点。

## Windows 验收
