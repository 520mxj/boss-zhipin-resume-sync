# GitHub duplicate check

Checked on 2026-11-05 before implementation.

## Decision: do not build a separate generic browser-control plugin

The requested generic capability already has several mature implementations:

- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) - browser automation through Playwright's accessibility snapshots and tools.
- [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) - Chrome automation and debugging for coding agents.
- [browser-use/browser-use](https://github.com/browser-use/browser-use) - a widely used browser-agent library.

Codex also ships a first-party Browser plugin. Building another generic browser controller would duplicate existing projects, so this repository keeps only the BOSS Zhipin-specific workflow and a narrow, origin-restricted Edge bridge used by that workflow.

## BOSS Zhipin search

GitHub repository searches for `BOSS直聘 简历 自动化` and `Boss Zhipin resume automation` returned recruiter automation, job scraping, auto-apply, and resume-generation tools. No maintained project was found that takes a local resume document, maps it to a structured schema, and synchronizes it into the existing BOSS Zhipin candidate resume through an agent-neutral skill and Edge CDP.

This project therefore targets that narrower gap:

- user-authorized resume editing rather than job applications or recruiter messaging;
- cross-agent packaging for Codex, Claude Code, and DSH;
- local document ingestion and a reviewable intermediate representation;
- project-experience preservation by default;
- a raw CDP bridge that avoids the observed BOSS page-close behavior caused by a full Playwright attachment.

