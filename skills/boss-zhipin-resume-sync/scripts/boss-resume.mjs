#!/usr/bin/env node

import { spawn as spawnChild } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import WebSocket from "ws";

const RESUME_URL = "https://www.zhipin.com/web/geek/resume";
const ALLOWED_HOST = "www.zhipin.com";
const STATE_FILE =
  process.env.BOSS_RESUME_STATE ||
  path.join(os.tmpdir(), "boss-resume-sync-session.json");
const SCHEMA_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "references",
  "resume.schema.json",
);

const HELP = `
BOSS Resume Sync

Usage:
  boss-resume extract <file> [--out <json>]
  boss-resume validate <resume.json>
  boss-resume doctor [--browser edge|chrome] [--profile Default]
  boss-resume start [--url <url>] [--browser edge|chrome] [--profile Default]
  boss-resume status
  boss-resume read [--max-chars <n>] [--include-sensitive]
  boss-resume fill --selector <css> (--value <text> | --value-file <path>)
  boss-resume click --selector <css>
  boss-resume wait --selector <css> [--timeout-ms <n>]
  boss-resume eval --file <js>
  boss-resume reload
  boss-resume screenshot [--out <png>]
  boss-resume stop [--keep-profile]

Supported input formats: .pdf, .docx, .html, .htm, .md, .markdown, .txt
The browser bridge only accepts pages on ${ALLOWED_HOST}.
`;

function fail(message) {
  const error = new Error(message);
  error.userFacing = true;
  throw error;
}

function expandHome(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function firstExisting(paths) {
  for (const candidate of paths) {
    if (candidate && (await exists(candidate))) return candidate;
  }
  return null;
}

function browserConfig(browserName = "edge") {
  const localAppData = process.env.LOCALAPPDATA;
  const roamingAppData = process.env.APPDATA;
  if (process.platform === "win32" && browserName === "edge") {
    return {
      processName: "msedge.exe",
      executableCandidates: [
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        localAppData &&
          path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
      ].filter(Boolean),
      userDataCandidates: [
        localAppData &&
          path.join(localAppData, "Microsoft", "Edge", "User Data"),
        roamingAppData &&
          path.join(roamingAppData, "Microsoft", "Edge", "User Data"),
      ].filter(Boolean),
    };
  }
  if (process.platform === "win32" && browserName === "chrome") {
    return {
      processName: "chrome.exe",
      executableCandidates: [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        localAppData &&
          path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      ].filter(Boolean),
      userDataCandidates: [
        localAppData && path.join(localAppData, "Google", "Chrome", "User Data"),
      ].filter(Boolean),
    };
  }
  if (process.platform === "darwin" && browserName === "edge") {
    return {
      processName: "Microsoft Edge",
      executableCandidates: [
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      ],
      userDataCandidates: [
        path.join(os.homedir(), "Library", "Application Support", "Microsoft Edge"),
      ],
    };
  }
  if (process.platform === "darwin" && browserName === "chrome") {
    return {
      processName: "Google Chrome",
      executableCandidates: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      ],
      userDataCandidates: [
        path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome"),
      ],
    };
  }
  if (process.platform === "linux" && browserName === "edge") {
    return {
      processName: "msedge",
      executableCandidates: ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"],
      userDataCandidates: [
        path.join(os.homedir(), ".config", "microsoft-edge"),
      ],
    };
  }
  if (process.platform === "linux" && browserName === "chrome") {
    return {
      processName: "chrome",
      executableCandidates: [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ],
      userDataCandidates: [
        path.join(os.homedir(), ".config", "google-chrome"),
        path.join(os.homedir(), ".config", "chromium"),
      ],
    };
  }
  fail(`Unsupported browser/platform combination: ${browserName}/${process.platform}`);
}

async function isBrowserRunning(config) {
  return await new Promise((resolve) => {
    const command =
      process.platform === "win32" ? "tasklist.exe" : "ps";
    const args =
      process.platform === "win32"
        ? ["/FI", `IMAGENAME eq ${config.processName}`, "/FO", "CSV", "/NH"]
        : ["-A", "-o", "comm="];
    const child = spawnChild(command, args, { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", () => resolve(false));
    child.on("close", () => {
      if (process.platform === "win32") {
        resolve(output.toLowerCase().includes(config.processName.toLowerCase()));
      } else {
        resolve(
          output
            .split(/\r?\n/)
            .map((line) => path.basename(line.trim()).toLowerCase())
            .some((name) => name === config.processName.toLowerCase()),
        );
      }
    });
  });
}

async function copyIfPresent(source, destination) {
  if (!(await exists(source))) return false;
  const info = await stat(source);
  await mkdir(path.dirname(destination), { recursive: true });
  if (info.isDirectory()) {
    await cp(source, destination, { recursive: true, force: true });
  } else {
    await copyFile(source, destination);
  }
  return true;
}

async function readState() {
  if (!(await exists(STATE_FILE))) {
    fail("No active browser session. Run `start` first.");
  }
  return JSON.parse(await readFile(STATE_FILE, "utf8"));
}

async function writeState(state) {
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function removeState() {
  await rm(STATE_FILE, { force: true });
}

async function waitForFile(filePath, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await exists(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail(`Timed out waiting for browser debugging endpoint: ${filePath}`);
}

async function devtoolsPort(profileDir) {
  const filePath = path.join(profileDir, "DevToolsActivePort");
  await waitForFile(filePath);
  const [port] = (await readFile(filePath, "utf8")).trim().split(/\r?\n/);
  if (!/^\d+$/.test(port)) fail("The browser did not write a valid DevTools port.");
  return Number(port);
}

async function jsonFetch(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    fail(`Browser HTTP endpoint returned ${response.status}: ${url}`);
  }
  return await response.json();
}

async function createBossPage(port, targetUrl = RESUME_URL) {
  if (!isBossUrl(targetUrl)) fail(`Refusing to open a non-BOSS URL: ${targetUrl}`);
  return await jsonFetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`,
    { method: "PUT" },
  );
}

async function ensureDummyPage(port) {
  const pages = await browserPages(port).catch(() => []);
  if (
    pages.some(
      (item) =>
        item.type === "page" &&
        (item.url === "about:blank" || item.url?.startsWith("edge://newtab")),
    )
  ) {
    return;
  }
  await jsonFetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" },
  ).catch(() => null);
}

async function browserPages(port) {
  return await jsonFetch(`http://127.0.0.1:${port}/json/list`);
}

function isBossUrl(value) {
  try {
    return new URL(value).hostname === ALLOWED_HOST;
  } catch {
    return false;
  }
}

async function findBossPage(port) {
  const pages = await browserPages(port);
  let target = pages.find(
    (item) => item.type === "page" && isBossUrl(item.url || ""),
  );
  if (!target) target = await createBossPage(port);
  return target;
}

class CdpConnection {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    this.socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(JSON.stringify(message.error)));
        } else {
          pending.resolve(message.result);
        }
        return;
      }
      this.events.push(message);
      if (this.events.length > 300) this.events.shift();
    });
  }

  send(method, params = {}, timeoutMs = 20000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      this.socket.close();
    }
  }
}

async function connectSession(state) {
  let page;
  try {
    const pages = await browserPages(state.port);
    page = pages.find(
      (item) => item.type === "page" && isBossUrl(item.url || ""),
    );
  } catch {
    fail("The debug browser is not reachable. Run `start` again.");
  }
  if (!page) page = await findBossPage(state.port);
  const cdp = new CdpConnection(page.webSocketDebuggerUrl);
  await cdp.open();
  return { cdp, page };
}

async function evaluate(cdp, expression, awaitPromise = true) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    const detail =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      "Page evaluation failed.";
    fail(detail);
  }
  return result.result?.value;
}

async function assertBossOrigin(cdp) {
  const location = await evaluate(
    cdp,
    "({hostname: location.hostname, href: location.href})",
  );
  if (location.hostname !== ALLOWED_HOST) {
    fail(
      `Refusing browser mutation on ${location.hostname}. Expected ${ALLOWED_HOST}.`,
    );
  }
  return location;
}

function pageReadSnapshot() {
  const maxChars = Number(globalThis.__BOSS_RESUME_MAX_CHARS__ || 20000);
  const includeSensitive = Boolean(globalThis.__BOSS_RESUME_INCLUDE_SENSITIVE__);
  const text = (element) => (element?.innerText || element?.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  const mask = (value) => {
    if (!value) return "";
    if (includeSensitive) return value;
    if (value.includes("@")) {
      const [local, domain] = value.split("@");
      return `${local.slice(0, 3)}***@${domain}`;
    }
    return value.length <= 4
      ? "***"
      : `${value.slice(0, 2)}***${value.slice(-2)}`;
  };
  const maskText = (value) => {
    if (includeSensitive) return value;
    return value
      .replace(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        (email) => mask(email),
      )
      .replace(/(?<!\d)(1\d{2})\d{4}(\d{4})(?!\d)/g, "$1****$2");
  };
  const selectorFor = (element) => {
    if (element.id) return `#${CSS.escape(element.id)}`;
    for (const attr of ["ka", "data-scroll", "name", "placeholder"]) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const candidate = `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(value)}"]`;
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    }
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter(
          (child) => child.tagName === current.tagName,
        );
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      if (document.querySelectorAll(parts.join(" > ")).length === 1) break;
      current = parent;
    }
    return parts.join(" > ");
  };
  const sensitiveField = /password|passwd|credit|card|cvv|cvc|secret|token|手机号|电话|身份证|微信|邮箱/i;
  const controls = [...document.querySelectorAll(
    'input,textarea,select,button,a[href],[ka],[role="button"],[role="link"],[contenteditable="true"]'
  )]
    .filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0;
    })
    .slice(0, 500)
    .map((element) => {
      const kind = element.tagName.toLowerCase();
      const rawValue =
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
          ? element.value
          : "";
      const shouldMask =
        element instanceof HTMLInputElement &&
        element.type === "password" ||
        sensitiveField.test(
          [
            element.getAttribute("name"),
            element.id,
            element.getAttribute("placeholder"),
            element.getAttribute("aria-label"),
          ].filter(Boolean).join(" "),
        );
      return {
        kind,
        type: element.getAttribute("type") || "",
        text: text(element).slice(0, 160),
        placeholder: element.getAttribute("placeholder") || "",
        name: element.getAttribute("name") || "",
        value: shouldMask ? mask(rawValue) : rawValue.slice(0, 300),
        disabled: Boolean(element.disabled),
        checked:
          element instanceof HTMLInputElement &&
          (element.type === "checkbox" || element.type === "radio")
            ? element.checked
            : undefined,
        selector: selectorFor(element),
      };
    });
  return {
    url: location.href,
    hostname: location.hostname,
    title: document.title,
    ready: document.readyState,
    text: maskText(document.body?.innerText || "").slice(0, maxChars),
    controls,
  };
}

const PAGE_READ_EXPRESSION = `(${pageReadSnapshot.toString()})()`;

async function commandStart(options) {
  if (await exists(STATE_FILE)) {
    try {
      const existing = await readState();
      const pages = await browserPages(existing.port);
      const boss = pages.find(
        (item) => item.type === "page" && isBossUrl(item.url || ""),
      );
      if (boss) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              reused: true,
              title: boss.title,
              url: boss.url,
              stateFile: STATE_FILE,
            },
            null,
            2,
          ),
        );
        return;
      }
    } catch {
      await removeState();
    }
  }

  const browserName = options.browser || "edge";
  const config = browserConfig(browserName);
  if (await isBrowserRunning(config)) {
    fail(
      `${browserName} is running. Close all ${browserName} windows, then run \`start\` again. The bridge never force-closes a browser.`,
    );
  }
  const executable = await firstExisting(config.executableCandidates);
  const sourceUserData = await firstExisting(config.userDataCandidates);
  if (!executable) fail(`Could not find ${browserName}.`);
  if (!sourceUserData) fail(`Could not find the ${browserName} user-data directory.`);

  const profileName = options.profile || "Default";
  const profileDir = await mkdtemp(
    path.join(os.tmpdir(), "boss-resume-sync-"),
  );
  const targetProfile = path.join(profileDir, profileName);
  await mkdir(targetProfile, { recursive: true });

  const files = [
    "Local State",
    path.join(profileName, "Preferences"),
    path.join(profileName, "Secure Preferences"),
    path.join(profileName, "Web Data"),
    path.join(profileName, "Network"),
    path.join(profileName, "Local Storage"),
    path.join(profileName, "Session Storage"),
    path.join(profileName, "IndexedDB"),
    path.join(profileName, "Storage"),
    path.join(profileName, "Sessions"),
  ];
  for (const relative of files) {
    const source = path.join(sourceUserData, relative);
    const destination = path.join(profileDir, relative);
    await copyIfPresent(source, destination);
  }

  const args = [
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDir}`,
    `--profile-directory=${profileName}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--start-maximized",
  ];
  const browser = spawnChild(executable, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  browser.unref();

  let port;
  try {
    port = await devtoolsPort(profileDir);
    await ensureDummyPage(port);
    const targetUrl = options.url || RESUME_URL;
    if (!isBossUrl(targetUrl)) fail(`Only ${ALLOWED_HOST} URLs are allowed.`);
    const created = await createBossPage(port, targetUrl);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const pages = await browserPages(port);
    const boss =
      pages.find(
        (item) => item.type === "page" && isBossUrl(item.url || ""),
      ) || created;
    const probe = new CdpConnection(boss.webSocketDebuggerUrl);
    await probe.open();
    let pageStatus;
    try {
      pageStatus = await evaluate(
        probe,
        "({title:document.title,url:location.href,ready:document.readyState})",
      );
    } finally {
      probe.close();
    }
    await writeState({
      version: 1,
      browser: browserName,
      pid: browser.pid,
      port,
      profileDir,
      profile: profileName,
      createdAt: new Date().toISOString(),
      lastUrl: pageStatus?.url || boss.url,
      lastTitle: pageStatus?.title || boss.title,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          reused: false,
          title: pageStatus?.title || boss.title,
          url: pageStatus?.url || boss.url,
          ready: pageStatus?.ready || "unknown",
          stateFile: STATE_FILE,
          next:
            "If BOSS shows login or verification, complete it manually. Then run `read`.",
        },
        null,
        2,
      ),
    );
  } catch (error) {
    try {
      process.kill(browser.pid);
    } catch {}
    await rm(profileDir, { recursive: true, force: true });
    throw error;
  }
}

async function commandDoctor(options) {
  const browserName = options.browser || "edge";
  const config = browserConfig(browserName);
  const executable = await firstExisting(config.executableCandidates);
  const userData = await firstExisting(config.userDataCandidates);
  const running = await isBrowserRunning(config);
  let session = { active: false };
  if (await exists(STATE_FILE)) {
    try {
      const state = await readState();
      const pages = await browserPages(state.port);
      const boss = pages.find(
        (item) => item.type === "page" && isBossUrl(item.url || ""),
      );
      session = {
        active: Boolean(boss),
        browser: state.browser,
        url: boss?.url || null,
      };
    } catch {
      session = { active: false, staleStateFile: true };
    }
  }
  console.log(
    JSON.stringify(
      {
        ok: Boolean(executable && userData),
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        browser: browserName,
        executable,
        userData,
        browserRunning: running,
        readyToStart: Boolean(executable && userData && !running),
        session,
        note: running
          ? "Close all browser windows before start. The bridge never force-closes a browser."
          : null,
      },
      null,
      2,
    ),
  );
}

async function commandStatus() {
  if (!(await exists(STATE_FILE))) {
    console.log(JSON.stringify({ active: false }, null, 2));
    return;
  }
  const state = await readState();
  try {
    const pages = await browserPages(state.port);
    const boss = pages.find(
      (item) => item.type === "page" && isBossUrl(item.url || ""),
    );
    console.log(
      JSON.stringify(
        {
          active: Boolean(boss),
          browser: state.browser,
          port: state.port,
          title: boss?.title || null,
          url: boss?.url || null,
          profileExists: await exists(state.profileDir),
        },
        null,
        2,
      ),
    );
  } catch {
    console.log(
      JSON.stringify(
        {
          active: false,
          stale: true,
          stateFile: STATE_FILE,
        },
        null,
        2,
      ),
    );
  }
}

async function commandRead(options) {
  const state = await readState();
  const { cdp } = await connectSession(state);
  try {
    await assertBossOrigin(cdp);
    const maxChars = Number(options.maxChars || 20000);
    const includeSensitive = Boolean(options.includeSensitive);
    await evaluate(
      cdp,
      `globalThis.__BOSS_RESUME_MAX_CHARS__=${Math.max(500, maxChars)};
       globalThis.__BOSS_RESUME_INCLUDE_SENSITIVE__=${includeSensitive ? "true" : "false"};`,
    );
    const value = await evaluate(cdp, PAGE_READ_EXPRESSION);
    console.log(JSON.stringify(value, null, 2));
  } finally {
    cdp.close();
  }
}

async function commandFill(options) {
  if (!options.selector) fail("fill requires --selector.");
  let value = options.value;
  if (options.valueFile) value = await readFile(expandHome(options.valueFile), "utf8");
  if (typeof value !== "string") fail("fill requires --value or --value-file.");

  const state = await readState();
  const { cdp } = await connectSession(state);
  try {
    await assertBossOrigin(cdp);
    const result = await evaluate(
      cdp,
      `(() => {
        const selector = ${JSON.stringify(options.selector)};
        const value = ${JSON.stringify(value)};
        const element = document.querySelector(selector);
        if (!element) return {ok:false,error:"selector-not-found"};
        if (element instanceof HTMLInputElement && element.type === "password") {
          return {ok:false,error:"password-fields-are-not-supported"};
        }
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
        ) {
          const proto =
            element instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
          setter.call(element, value);
        } else if (
          element instanceof HTMLElement &&
          element.isContentEditable
        ) {
          element.focus();
          const selection = document.getSelection();
          const range = document.createRange();
          range.selectNodeContents(element);
          selection.removeAllRanges();
          selection.addRange(range);
          if (!document.execCommand("insertText", false, value)) {
            element.textContent = value;
          }
        } else {
          return {ok:false,error:"element-not-editable"};
        }
        element.dispatchEvent(new Event("input", {bubbles:true}));
        element.dispatchEvent(new Event("change", {bubbles:true}));
        return {ok:true,selector,length:value.length};
      })()`,
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    cdp.close();
  }
}

async function commandClick(options) {
  if (!options.selector) fail("click requires --selector.");
  const state = await readState();
  const { cdp } = await connectSession(state);
  try {
    await assertBossOrigin(cdp);
    const result = await evaluate(
      cdp,
      `(() => {
        const element = document.querySelector(${JSON.stringify(options.selector)});
        if (!element) return {ok:false,error:"selector-not-found"};
        if (element.disabled) return {ok:false,error:"element-disabled"};
        element.click();
        return {ok:true,selector:${JSON.stringify(options.selector)}};
      })()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    cdp.close();
  }
}

async function commandWait(options) {
  if (!options.selector) fail("wait requires --selector.");
  const timeoutMs = Number(options.timeoutMs || 15000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readState();
    const { cdp } = await connectSession(state);
    try {
      const found = await evaluate(
        cdp,
        `Boolean(document.querySelector(${JSON.stringify(options.selector)}))`,
      );
      if (found) {
        console.log(
          JSON.stringify(
            { ok: true, selector: options.selector, waitedMs: timeoutMs - (deadline - Date.now()) },
            null,
            2,
          ),
        );
        return;
      }
    } finally {
      cdp.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  fail(`Timed out waiting for selector: ${options.selector}`);
}

async function commandEval(options) {
  if (!options.file) fail("eval requires --file.");
  const expression = await readFile(expandHome(options.file), "utf8");
  if (expression.length > 200000) fail("eval file is too large.");
  const state = await readState();
  const { cdp } = await connectSession(state);
  try {
    await assertBossOrigin(cdp);
    const value = await evaluate(cdp, expression);
    console.log(JSON.stringify({ ok: true, result: value }, null, 2));
  } finally {
    cdp.close();
  }
}

async function commandReload() {
  const state = await readState();
  const { cdp } = await connectSession(state);
  try {
    await assertBossOrigin(cdp);
    await evaluate(cdp, "location.reload(); true", false);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log(JSON.stringify({ ok: true, url: RESUME_URL }, null, 2));
  } finally {
    cdp.close();
  }
}

async function commandScreenshot(options) {
  const out = path.resolve(
    expandHome(options.out || "./artifacts/boss-resume.png"),
  );
  const state = await readState();
  const { cdp } = await connectSession(state);
  try {
    await assertBossOrigin(cdp);
    const capture = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      fromSurface: true,
    });
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, Buffer.from(capture.data, "base64"));
    console.log(JSON.stringify({ ok: true, output: out }, null, 2));
  } finally {
    cdp.close();
  }
}

async function commandStop(options) {
  if (!(await exists(STATE_FILE))) {
    console.log(JSON.stringify({ ok: true, active: false }, null, 2));
    return;
  }
  const state = await readState();
  try {
    const page = (await browserPages(state.port)).find(
      (item) => item.type === "page",
    );
    if (page) {
      const cdp = new CdpConnection(page.webSocketDebuggerUrl);
      await cdp.open();
      try {
        await cdp.send("Browser.close");
      } catch {
        // The browser may close the socket before replying.
      } finally {
        cdp.close();
      }
    }
  } catch {
    try {
      process.kill(state.pid);
    } catch {}
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (!options.keepProfile && state.profileDir) {
    const resolved = path.resolve(state.profileDir);
    const expectedParent = path.resolve(os.tmpdir());
    if (
      path.dirname(resolved) === expectedParent &&
      path.basename(resolved).startsWith("boss-resume-sync-")
    ) {
      await rm(resolved, { recursive: true, force: true });
    }
  }
  await removeState();
  console.log(JSON.stringify({ ok: true, stopped: true }, null, 2));
}

function decodeHtml(text) {
  const entities = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return entities[entity.toLowerCase()] ?? match;
  });
}

function htmlToText(html) {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeExtractedText(text, { collapseGlyphSpacing = false } = {}) {
  let normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  if (collapseGlyphSpacing) {
    normalized = normalized
      .replace(/\bI\s+T\b/g, "IT")
      .replace(/\b(\d{3})\s+(\d{4})\s+(\d{4})\b/g, "$1$2$3");
    let previous;
    do {
      previous = normalized;
      normalized = normalized.replace(
        /([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,
        "$1",
      );
    } while (normalized !== previous);
  }
  return normalized.trim();
}

async function extractPdf(filePath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(filePath));
  const document = await pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => item.str || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(pageText);
  }
  return normalizeExtractedText(pages.join("\n\n"), {
    collapseGlyphSpacing: true,
  });
}

async function extractDocx(filePath) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: await readFile(filePath) });
  return normalizeExtractedText(result.value);
}

async function commandExtract(file, options) {
  if (!file) fail("extract requires an input file.");
  const source = path.resolve(expandHome(file));
  if (!(await exists(source))) fail(`Input file does not exist: ${source}`);
  const extension = path.extname(source).toLowerCase();
  let text;
  if (extension === ".pdf") text = await extractPdf(source);
  else if (extension === ".docx") text = await extractDocx(source);
  else if (extension === ".html" || extension === ".htm") {
    text = normalizeExtractedText(htmlToText(await readFile(source, "utf8")));
  } else if (
    extension === ".txt" ||
    extension === ".md" ||
    extension === ".markdown"
  ) {
    text = normalizeExtractedText(await readFile(source, "utf8"));
  } else {
    fail(
      `Unsupported input format: ${extension || "(none)"}. Convert legacy .doc files to .docx or PDF first.`,
    );
  }

  const warnings = [];
  if (text.length < 200) {
    warnings.push(
      "Extracted text is very short. The document may be scanned/image-only; use the Agent's vision or OCR before mapping.",
    );
  }
  const output = {
    schemaVersion: 1,
    source: {
      file: path.basename(source),
      format: extension.replace(/^\./, ""),
      extractedAt: new Date().toISOString(),
    },
    text,
    warnings,
  };
  if (options.out) {
    const destination = path.resolve(expandHome(options.out));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ ok: true, output: destination, chars: text.length, warnings }, null, 2));
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
}

async function commandValidate(file) {
  if (!file) fail("validate requires a resume JSON file.");
  const input = path.resolve(expandHome(file));
  const schema = JSON.parse(await readFile(SCHEMA_FILE, "utf8"));
  const resume = JSON.parse(await readFile(input, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(resume)) {
    console.error(JSON.stringify({ ok: false, errors: validate.errors }, null, 2));
    process.exitCode = 2;
    return;
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        profile: resume.profile.displayName,
        workExperiences: resume.workExperiences.length,
        projects: resume.projects.length,
        preserveProjects: resume.sync.preserveProjects,
      },
      null,
      2,
    ),
  );
}

function parseCli(argv) {
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return null;
  }
  const rest = argv.slice(1);
  if (command === "extract") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { out: { type: "string" } },
    });
    return { command, file: positionals[0], options: values };
  }
  if (command === "validate") {
    const { positionals } = parseArgs({ args: rest, allowPositionals: true });
    return { command, file: positionals[0], options: {} };
  }
  if (command === "start") {
    const { values } = parseArgs({
      args: rest,
      options: {
        url: { type: "string" },
        browser: { type: "string" },
        profile: { type: "string" },
      },
    });
    return { command, options: values };
  }
  if (command === "doctor") {
    const { values } = parseArgs({
      args: rest,
      options: {
        browser: { type: "string" },
        profile: { type: "string" },
      },
    });
    return { command, options: values };
  }
  if (command === "read") {
    const { values } = parseArgs({
      args: rest,
      options: {
        "max-chars": { type: "string" },
        "include-sensitive": { type: "boolean" },
      },
    });
    return {
      command,
      options: {
        maxChars: values["max-chars"],
        includeSensitive: values["include-sensitive"],
      },
    };
  }
  if (command === "fill") {
    const { values } = parseArgs({
      args: rest,
      options: {
        selector: { type: "string" },
        value: { type: "string" },
        "value-file": { type: "string" },
      },
    });
    return {
      command,
      options: {
        selector: values.selector,
        value: values.value,
        valueFile: values["value-file"],
      },
    };
  }
  if (command === "click") {
    const { values } = parseArgs({
      args: rest,
      options: { selector: { type: "string" } },
    });
    return { command, options: values };
  }
  if (command === "wait") {
    const { values } = parseArgs({
      args: rest,
      options: {
        selector: { type: "string" },
        "timeout-ms": { type: "string" },
      },
    });
    return {
      command,
      options: {
        selector: values.selector,
        timeoutMs: values["timeout-ms"],
      },
    };
  }
  if (command === "eval") {
    const { values } = parseArgs({
      args: rest,
      options: { file: { type: "string" } },
    });
    return { command, options: values };
  }
  if (command === "screenshot") {
    const { values } = parseArgs({
      args: rest,
      options: { out: { type: "string" } },
    });
    return { command, options: values };
  }
  if (command === "stop") {
    const { values } = parseArgs({
      args: rest,
      options: { "keep-profile": { type: "boolean" } },
    });
    return {
      command,
      options: { keepProfile: values["keep-profile"] },
    };
  }
  if (command === "status" || command === "reload") {
    return { command, options: {} };
  }
  fail(`Unknown command: ${command}\n${HELP}`);
}

async function main() {
  const parsed = parseCli(process.argv.slice(2));
  if (!parsed) return;
  switch (parsed.command) {
    case "extract":
      await commandExtract(parsed.file, parsed.options);
      break;
    case "validate":
      await commandValidate(parsed.file);
      break;
    case "start":
      await commandStart(parsed.options);
      break;
    case "doctor":
      await commandDoctor(parsed.options);
      break;
    case "status":
      await commandStatus();
      break;
    case "read":
      await commandRead(parsed.options);
      break;
    case "fill":
      await commandFill(parsed.options);
      break;
    case "click":
      await commandClick(parsed.options);
      break;
    case "wait":
      await commandWait(parsed.options);
      break;
    case "eval":
      await commandEval(parsed.options);
      break;
    case "reload":
      await commandReload();
      break;
    case "screenshot":
      await commandScreenshot(parsed.options);
      break;
    case "stop":
      await commandStop(parsed.options);
      break;
    default:
      fail(`Unhandled command: ${parsed.command}`);
  }
}

main().catch((error) => {
  console.error(error.userFacing ? error.message : error.stack || String(error));
  process.exitCode = 1;
});
