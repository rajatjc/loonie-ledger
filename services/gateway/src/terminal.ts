/**
 * Browser terminal over a WebSocket. Messages from the browser are JSON:
 * {type: "input", data} for keystrokes, {type: "run", command} for sidebar
 * commands, and {type: "resize", cols, rows}. Output goes back as raw text.
 *
 * On Kubernetes each session gets a real bash shell (kubectl, redis-cli, psql),
 * limited by the gateway's RBAC Role. Elsewhere it gets the safe emulator.
 */
import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { TERMINAL_MODE } from "./config.js";
import { run, toTerminal } from "./emulator.js";

const PROMPT = "\x1b[32mops@loonie-ledger\x1b[0m:\x1b[34m~\x1b[0m$ ";
const MAX_SESSIONS = 10;
const IDLE_MS = 15 * 60 * 1000;

export const wss = new WebSocketServer({ noServer: true });
let sessions = 0;

wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
  if (sessions >= MAX_SESSIONS) {
    ws.send("\r\nToo many terminal sessions right now; try again in a minute.\r\n");
    ws.close();
    return;
  }
  sessions++;
  let idle = setTimeout(() => ws.close(), IDLE_MS);
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => ws.close(), IDLE_MS);
  };
  ws.on("close", () => {
    sessions--;
    clearTimeout(idle);
  });
  if (TERMINAL_MODE === "kubernetes") void realShell(ws, touch);
  else emulatedShell(ws, touch);
});

async function realShell(ws: WebSocket, touch: () => void): Promise<void> {
  let pty: typeof import("node-pty");
  try {
    pty = await import("node-pty");
  } catch {
    ws.send("\r\nnode-pty isn't installed, so a real shell isn't available.\r\n");
    ws.close();
    return;
  }
  const shell = pty.spawn("bash", ["--login"], {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd: process.env.HOME ?? "/",
    env: { ...process.env, PS1: "\\[\\e[32m\\]ops@loonie-ledger\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]$ " } as Record<string, string>,
  });
  shell.onData((d) => ws.readyState === ws.OPEN && ws.send(d));
  shell.onExit(() => ws.close());
  ws.on("message", (raw) => {
    touch();
    const msg = parse(raw.toString());
    if (msg?.type === "input") shell.write(msg.data);
    else if (msg?.type === "run") shell.write(msg.command + "\r");
    else if (msg?.type === "resize") shell.resize(Math.max(20, msg.cols), Math.max(5, msg.rows));
  });
  ws.on("close", () => shell.kill());
}

function emulatedShell(ws: WebSocket, touch: () => void): void {
  let line = "";
  let busy = false;
  const send = (s: string) => ws.readyState === ws.OPEN && ws.send(s);
  send(toTerminal("Loonie Ledger ops terminal (demo mode). Type \x1b[32mhelp\x1b[0m, or pick a command on the left.\n\n") + PROMPT);

  const execute = async (command: string) => {
    busy = true;
    try {
      const out = await run(command);
      if (out) send(toTerminal(out) + (out.startsWith("\x1b[2J") ? "" : "\r\n"));
    } catch (err) {
      send(toTerminal(`\x1b[31merror: ${(err as Error).message}\x1b[0m\n`));
    }
    busy = false;
    send(PROMPT);
  };

  ws.on("message", (raw) => {
    touch();
    const msg = parse(raw.toString());
    if (!msg || busy) return;
    if (msg.type === "run") {
      send("\r\x1b[2K" + PROMPT + msg.command + "\r\n"); // clear any half-typed line first
      line = "";
      void execute(msg.command);
      return;
    }
    if (msg.type !== "input" || typeof msg.data !== "string") return;
    if (msg.data.startsWith("\x1b")) return; // arrow keys and other escape sequences
    for (const ch of msg.data) {
      if (ch === "\r") {
        send("\r\n");
        const command = line;
        line = "";
        void execute(command);
        return;
      } else if (ch === "\x7f") {
        if (line.length) {
          line = line.slice(0, -1);
          send("\b \b");
        }
      } else if (ch === "\x03") {
        line = "";
        send("^C\r\n" + PROMPT);
      } else if (ch >= " " && line.length < 500) {
        line += ch;
        send(ch);
      }
    }
  });
}

function parse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
