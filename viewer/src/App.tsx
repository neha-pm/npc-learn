/* App.tsx – viewer */
import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Group, Text, Label, Tag } from "react-konva";

const WIDTH = 800;
const HEIGHT = 500;

type Npc = {
  id: number;
  x: number;
  y: number;
  emoji: string;
  tooltip?: string;      // ← new field
};

// helper to random-place a fresh NPC
const randomPos = () => ({
  x: Math.random() * (WIDTH - 40) + 20,
  y: Math.random() * (HEIGHT - 40) + 20,
});

export default function App() {
  const [npcs, setNpcs] = useState<Record<number, Npc>>({});
  const wsRef = useRef<WebSocket | null>(null);

  /* ─────────────────────────────────────────────────────────────
     On mount → 1) load saved positions, 2) open WebSocket
  ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    /* 1️⃣  fetch saved positions */
    fetch("http://localhost:8000/state_dump")       // <- tiny helper endpoint
      .then(r => r.ok ? r.json() : [])
      .then((rows: { npc_id: number; x: number; y: number }[]) => {
        const pre: Record<number, Npc> = {};
        rows.forEach(({ npc_id, x, y }) => {
          pre[npc_id] = { id: npc_id, x, y, emoji: "🙂" };
        });
        setNpcs(pre);
      });

    /* 2️⃣  open WebSocket */
    const ws = new WebSocket("ws://localhost:8000/ws");
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const { npc_id, action } = JSON.parse(e.data);
      setNpcs((prev) => {
        const current = prev[npc_id] ?? {
          id: npc_id,
          ...randomPos(),
          emoji: action,
        };
        // move slightly for variety
        const dx = (Math.random() - 0.5) * 20;
        const dy = (Math.random() - 0.5) * 20;
        return {
          ...prev,
          [npc_id]: {
            ...current,
            x: Math.max(10, Math.min(WIDTH - 10, current.x + dx)),
            y: Math.max(10, Math.min(HEIGHT - 10, current.y + dy)),
            emoji: action,
          },
        };
      });
    };

    return () => ws.close();
  }, []);

  const npcArray = Object.values(npcs);

  return (
    <div className="flex flex-col items-center gap-2 p-4">
      <h1 className="text-2xl font-bold">NPC World</h1>

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
                // update local state…
                setNpcs((prev) => ({
                  ...prev,
                  [n.id]: { ...n, x, y },
                }));
                // …and persist to backend
                fetch("http://localhost:8000/state", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ npc_id: n.id, x, y }),
                });
              }}
              onMouseEnter={() => (document.body.style.cursor = "pointer")}
              onMouseLeave={() => (document.body.style.cursor = "default")}
              onMouseOver={() => {
                /* fetch last-3 memories once per hover */
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
              {/* the emoji itself */}
              <Text text={n.emoji} fontSize={32} offsetX={16} offsetY={16} />

              {/* tooltip on hover */}
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