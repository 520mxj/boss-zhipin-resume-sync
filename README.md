# BOSS Resume Sync

一个面向 Codex、Claude Code 和 DeepSeek Harness（DSH）的跨 Agent 简历同步插件。用户上传 PDF、DOCX、HTML、Markdown 或纯文本简历后，Agent 解析内容、生成可审查的结构化数据，再通过 Microsoft Edge 将变化同步到已登录的 BOSS 直聘在线简历。

## 它解决什么

- 不再针对某一份固定简历硬编码字段。
- 默认保留项目经历，除非用户明确要求修改或删除。
- 不接管登录、不绕过验证码；遇到安全验证时等待用户手动完成。
- 不保存账号密码，同步结束后删除临时 Edge 用户目录。
- 同一套 Skill 核心同时提供 Codex、Claude Code 和 DSH 适配清单。

通用浏览器控制插件**没有重复实现**。GitHub 上已有 Playwright MCP、Chrome DevTools MCP 和 browser-use；本仓库只保留 BOSS 简历同步所需的窄范围、域名受限 CDP 桥。去重依据见 [docs/duplicate-check.md](docs/duplicate-check.md)。

## 支持的输入

| 格式 | 支持方式 |
| --- | --- |
| PDF | `pdfjs-dist` 提取文本；扫描件由 Agent 的视觉/OCR 能力补足 |
| DOCX | `mammoth` 提取正文 |
| HTML / HTM | 提取可读文本 |
| TXT / Markdown | 直接读取 |
| DOC | 不支持，请先另存为 DOCX 或 PDF |

## 工作流

1. `extract` 读取上传文档。
2. Agent 根据 [Resume schema](skills/boss-zhipin-resume-sync/references/resume.schema.json) 生成 `resume.json`；不臆造缺失信息。
3. `validate` 校验结构化简历。
4. `start` 复制必要的 Edge 登录数据到临时目录，并用仅监听 `127.0.0.1` 的 CDP 打开 BOSS 在线简历。
5. Agent 使用 `read`、`fill`、`click`、`eval` 分区块保存，逐项复核。
6. `stop` 关闭调试浏览器并删除临时登录副本。

## 安装依赖

```bash
npm install
```

## CLI 快速使用

```bash
node skills/boss-zhipin-resume-sync/scripts/boss-resume.mjs extract ./resume.pdf --out ./.boss-resume/source.json
node skills/boss-zhipin-resume-sync/scripts/boss-resume.mjs validate ./.boss-resume/resume.json
node skills/boss-zhipin-resume-sync/scripts/boss-resume.mjs start
node skills/boss-zhipin-resume-sync/scripts/boss-resume.mjs read --max-chars 20000
node skills/boss-zhipin-resume-sync/scripts/boss-resume.mjs stop
```

`start` 前需要退出所有普通 Edge 窗口。脚本不会自动关闭其他浏览器窗口，避免丢失用户数据。

## Agent 安装

### Codex

仓库根目录包含 `.codex-plugin/plugin.json` 和标准 `skills/`。可从 Codex 插件市场安装，或在本地开发时把本目录作为插件加载。

### Claude Code

仓库根目录包含 `.claude-plugin/plugin.json`。插件加载后使用同一个 `skills/boss-zhipin-resume-sync`；也可以只把该 Skill 目录放入 Claude Code 的项目或个人 skills 目录。

### DSH

仓库是标准 npm/Cordis 包，包含 `cordis.patch.yml` 和 `lib/index.js`：

```bash
dsh plugin add github:520mxj/boss-zhipin-resume-sync
```

DSH 通过 `ctx.skills.registerProvider()` 注册同一份 Skill。

## 安全边界

- 只允许对 `www.zhipin.com` 执行 CLI 的 `eval`、`fill` 和 `click`。
- 不处理密码、银行卡、验证码或身份验证弹窗。
- 删除简历区块或联系方式前必须获得用户明确授权。
- 临时浏览器资料目录由脚本创建、使用并清理；不要把它提交到 Git。
- 本工具服务于用户自己的求职简历，不包含自动投递、批量爬取、招聘方操作或规避风控功能。

## 开发验证

```bash
npm test
node skills/boss-zhipin-resume-sync/scripts/boss-resume.mjs --help
```

## License

MIT
