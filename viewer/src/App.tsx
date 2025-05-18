import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Text } from "react-konva";

type Npc = { id: number; x: number; y: number; emoji: string };

const WIDTH = 800;
const HEIGHT = 500;

// put NPCs in random start spots
const randomPos = () => ({
  x: Math.random() * (WIDTH - 40) + 20,
  y: Math.random() * (HEIGHT - 40) + 20,
});

export default function App() {
  const [npcs, setNpcs] = useState<Record<number, Npc>>({});
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8000/ws");
    wsRef.current = ws;

    ws.onmessage = (e) => {
      // backend will send {npc_id:int, action:str}
      const { npc_id, action } = JSON.parse(e.data);
      setNpcs((prev) => {
        const current = prev[npc_id] ?? { id: npc_id, ...randomPos(), emoji: action };
        // move a tiny bit so it feels alive
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
            <Text
              key={n.id}
              text={n.emoji}
              fontSize={32}
              x={n.x}
              y={n.y}
              offsetX={16}
              offsetY={16}
            />
          ))}
        </Layer>
      </Stage>
      <p className="text-sm text-gray-500">
        Connected NPCs: {npcArray.length}
      </p>
    </div>
  );
}