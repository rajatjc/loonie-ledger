import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

export interface TerminalHandle {
  run(command: string): void;
}

type State = "connecting" | "open" | "closed";

/** xterm.js wired to the gateway's terminal WebSocket. */
export default function Terminal({ ref, mode }: { ref: Ref<TerminalHandle>; mode: "kubernetes" | "demo" | undefined }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const [state, setState] = useState<State>("connecting");

  const send = (msg: object) => socket.current?.readyState === WebSocket.OPEN && socket.current.send(JSON.stringify(msg));

  const connect = useCallback(() => {
    setState("connecting");
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ops/terminal`);
    socket.current = ws;
    ws.onopen = () => {
      setState("open");
      const t = term.current;
      if (t) ws.send(JSON.stringify({ type: "resize", cols: t.cols, rows: t.rows }));
    };
    ws.onmessage = (e) => term.current?.write(typeof e.data === "string" ? e.data : "");
    ws.onclose = () => {
      setState("closed");
      term.current?.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
    };
  }, []);

  useEffect(() => {
    const t = new XTerm({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      theme: {
        background: "#050a06",
        foreground: "#4ade80",
        cursor: "#86efac",
        selectionBackground: "#14532d",
        green: "#4ade80",
        brightGreen: "#86efac",
        blue: "#60a5fa",
        yellow: "#facc15",
        red: "#f87171",
      },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host.current!);
    f.fit();
    term.current = t;
    fit.current = f;
    const input = t.onData((data) => send({ type: "input", data }));
    const observer = new ResizeObserver(() => {
      f.fit();
      send({ type: "resize", cols: t.cols, rows: t.rows });
    });
    observer.observe(host.current!);
    connect();
    return () => {
      observer.disconnect();
      input.dispose();
      socket.current?.close();
      t.dispose();
    };
  }, [connect]);

  useImperativeHandle(ref, () => ({
    run(command: string) {
      if (socket.current?.readyState !== WebSocket.OPEN) return;
      send({ type: "run", command });
      term.current?.focus();
    },
  }));

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-emerald-900/40 bg-[#050a06] shadow-xl shadow-emerald-950/20">
      <div className="flex items-center gap-2 border-b border-emerald-900/40 px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-3 font-mono text-xs text-emerald-400/80">ops@loonie-ledger</span>
        <span className="ml-auto rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
          {mode === "kubernetes" ? "live cluster shell" : "demo terminal"}
        </span>
        {state === "closed" && (
          <button onClick={() => { term.current?.clear(); connect(); }} className="flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px] text-emerald-300 hover:bg-emerald-500/10">
            <RotateCw className="h-3 w-3" /> reconnect
          </button>
        )}
      </div>
      <div ref={host} className="min-h-0 flex-1 px-3 py-2" />
    </div>
  );
}
