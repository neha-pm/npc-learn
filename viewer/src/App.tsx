/* App.tsx – viewer */
import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Group, Text, Label, Tag } from "react-konva";

const WIDTH = 800;
const HEIGHT = 500;

/* ───────────── Types ───────────── */
type Npc = {
  id: number;
  x: number;
  y: number;
  emoji: string;
  tooltip?: string;
};

/* ───────── Random position helper ───────── */
const randomPos = () => ({
  x: Math.random() * (WIDTH - 40) + 20,
  y: Math.random() * (HEIGHT - 40) + 20,
});

const ZONE: Record<string, { x: number; y: number }> = {
  ENTRANCE: { x: 100, y: 100 },
  BUFFET:   { x: 150, y: 250 },
  DANCE:    { x: 350, y: 200 },
  STAGE:    { x: 550, y: 150 },
  QUIET:    { x: 300, y: 400 },
};

/* ───────────── Component ───────────── */
export default function App() {
  const [npcs, setNpcs] = useState<Record<number, Npc>>({});
  const wsRef = useRef<WebSocket | null>(null);

  /* -------- Reset World handler -------- */
  const handleReset = async () => {
    try {
      const res = await fetch("http://localhost:8000/reset", { method: "POST" });
      if (!res.ok) throw new Error("Reset failed");
      setNpcs({}); // wipe local view immediately
    } catch (err) {
      console.error(err);
    }
  };

  /* -------- Initial load & WebSocket -------- */
  useEffect(() => {
    /* 1️⃣  load saved positions */
    fetch("http://localhost:8000/state_dump")
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: { npc_id: number; zone: string }[]) => {
      const obj: Record<number, Npc> = {};
      rows.forEach(({ npc_id, zone }) => {
        const { x, y } = ZONE[zone] ?? randomPos();
        obj[npc_id] = { id: npc_id, x, y, emoji: "🙂" };
      });
      setNpcs(obj);
    });

    /* 2️⃣  open WebSocket (uses same hostname as page) */
    const host = window.location.hostname || "127.0.0.1";
    const ws = new WebSocket(`ws://${host}:8000/ws`);
    wsRef.current = ws;

    ws.onopen = () => console.log("✅ WebSocket connected");
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as {
        type?: string;            // "RESET" for global wipes
        npc_id?: number;
        action?: string;
        zone?: string;            // optional — we may add it later
      };
    
      /* 1️⃣  Global reset broadcast */
      if (msg.type === "RESET") {
        setNpcs({});
        return;
      }
    
      /* 2️⃣  Normal NPC update payload */
      if (msg.npc_id === undefined || msg.action === undefined) return;
    
      setNpcs((prev) => {
        const current = prev[msg.npc_id] ?? {
          id: msg.npc_id,
          ...randomPos(),
          emoji: msg.action,
        };
    
        /* ─ Zone override: if server sent a zone, use its fixed coords */
        const zoneCoords = msg.zone ? ZONE[msg.zone] : undefined;
    
        /* ─ Otherwise: nudge position a little so they ‘wobble’ */
        const dx = (Math.random() - 0.5) * 20;
        const dy = (Math.random() - 0.5) * 20;
    
        return {
          ...prev,
          [msg.npc_id]: {
            ...current,
            x:
              zoneCoords?.x ??
              Math.max(10, Math.min(WIDTH - 10, current.x + dx)),
            y:
              zoneCoords?.y ??
              Math.max(10, Math.min(HEIGHT - 10, current.y + dy)),
            emoji: msg.action,
          },
        };
      });
    };

    return () => ws.close();
  }, []);

  /* ----------------------------------------- */
  const npcArray = Object.values(npcs);

  return (
    <div className="flex flex-col items-center gap-2 p-4">
      {/* Header row with Reset button */}
      <div className="w-full max-w-[800px] flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">NPC World</h1>
        <button
          onClick={handleReset}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
        >
          Reset World
        </button>
      </div>

      {/* Canvas */}
      <Stage width={WIDTH} height={HEIGHT} style={{ border: "1px solid #ccc" }}>
        <Layer>
          {npcArray.map((n) => (
            <Group
              key={n.id}
              x={n.x}
              y={n.y}
              draggable
              onDragEnd={(e) => {
                const { x, y } = e.target.position();
                setNpcs((prev) => ({ ...prev, [n.id]: { ...n, x, y } }));
                fetch("http://localhost:8000/state", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ npc_id: n.id, x, y }),
                });
              }}
              onMouseEnter={() => (document.body.style.cursor = "pointer")}
              onMouseLeave={() => (document.body.style.cursor = "default")}
              onMouseOver={() => {
                fetch(`http://localhost:8000/recall?npc_id=${n.id}`)
                  .then((r) => r.json())
                  .then((data: { memories: string[] }) =>
                    setNpcs((prev) => ({
                      ...prev,
                      [n.id]: { ...n, tooltip: data.memories.join("\n") },
                    }))
                  );
              }}
              onMouseOut={() =>
                setNpcs((prev) => ({
                  ...prev,
                  [n.id]: { ...n, tooltip: undefined },
                }))
              }
            >
              <Text text={n.emoji} fontSize={32} offsetX={16} offsetY={16} />

              {n.tooltip && (
                <Label offsetY={40}>
                  <Tag fill="#fffbe6" stroke="#d4d4d4" cornerRadius={4} />
                  <Text
                    text={n.tooltip}
                    fontSize={14}
                    padding={4}
                    fill="black"
                    width={160}
                    wrap="word"
                  />
                </Label>
              )}
            </Group>
          ))}
        </Layer>
      </Stage>

      <p className="text-sm text-gray-500">
        Connected NPCs: {npcArray.length}
      </p>
    </div>
  );
}