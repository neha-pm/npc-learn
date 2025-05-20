/* App.tsx – viewer */
import { useEffect, useRef, useState, useCallback } from "react";
import React from "react";
import { Stage, Layer, Group, Rect, Text, Label, Tag, Image as KImage } from "react-konva";
import useImage from "use-image"; 
import "./index.css";

function Avatar({ id, size = 40 }: { id: number; size?: number }) {
  const [img] = useImage(AVATAR[id] || "/avatars/default.png");
  return (
    <KImage
      image={img}
      width={size}
      height={size}
      offsetX={size / 2}
      offsetY={size / 2}
    />
  );
}


const WIDTH = 800;
const HEIGHT = 500;

/* ───────────── Types ───────────── */
type Npc = {
  id: number;
  x: number;
  y: number;
  bubble?: string;      // show this in a thought bubble
  tooltip?: string;
};

/* ───────── Random position helper ───────── */
const randomPos = () => ({
  x: Math.random() * (WIDTH - 40) + 20,
  y: Math.random() * (HEIGHT - 40) + 20,
});

/* zone → fixed anchor coordinate */
const ZONE: Record<string, { x: number; y: number }> = {
  ENTRANCE: { x: 100, y: 100 },
  BUFFET:   { x: 150, y: 250 },
  DANCE:    { x: 350, y: 200 },
  STAGE:    { x: 550, y: 150 },
  QUIET:    { x: 300, y: 400 },
};

type ZoneInfo = { x: number; y: number; w: number; h: number; color: string };
const ZONE_INFO: Record<string, ZoneInfo> = {
  ENTRANCE: { x: 150, y: 125, w: 200, h: 150, color: 'rgba(100,150,240,0.9)' },
  BUFFET:   { x: 400, y: 125, w: 200, h: 150, color: 'rgba(240,200,100,0.9)' },
  STAGE:    { x: 650, y: 125, w: 200, h: 150, color: 'rgba(240,100,140,0.9)' },
  DANCE:    { x: 275, y: 350, w: 200, h: 150, color: 'rgba(180,100,240,0.9)' },
  QUIET:    { x: 525, y: 350, w: 200, h: 150, color: 'rgba(100,240,140,0.9)' },
};

// Emoji icons keyed by zone when they act
const ZONE_EMOJI: Record<string,string> = {
  ENTRANCE: '🚪',
  BUFFET:   '🍽',
  DANCE:    '💃',
  STAGE:    '🎤',
  QUIET:    '🤫',
};

const AVATAR: Record<number, string> = {
  1: "/avatars/phoebe.png",
  2: "/avatars/sheldon.png",
  3: "/avatars/dwight.png",
  4: "/avatars/michael.png",
  5: "/avatars/david.png",
  6: "/avatars/moira.png",
};

/* deterministic offset so NPCs don't pile up */
const OFFSET = 18; // px

const NPC_NAMES: Record<number, string> = {
  1: "Phoebe",
  2: "Sheldon",
  3: "Dwight",
  4: "Michael",
  5: "David",
  6: "Moira",
};

/* Add this helper above the App component */
function isZoneKey(zone: string): zone is keyof typeof ZONE_EMOJI {
  return Object.prototype.hasOwnProperty.call(ZONE_EMOJI, zone);
}

/* ───────────── Component ───────────── */
export default function App() {
  const [npcs, setNpcs] = useState<Record<number, Npc>>({});
  // currently selected NPC for detailed view
  const [selectedNpc, setSelectedNpc] = useState<number|null>(null);
  const [selectedNpcRecall, setSelectedNpcRecall] = useState<string[]>([]);
  const [feed, setFeed] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Responsive canvas size
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1000, height: 600 });

  useEffect(() => {
    function handleResize() {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        const height = Math.max(500, window.innerHeight - 120); // header + some margin
        setCanvasSize({ width, height });
      }
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // New grid layout: top row (Entrance, Dance, Stage), bottom row (Buffet, Quiet)
  const ZONE = React.useMemo(() => ({
    ENTRANCE: { x: canvasSize.width * (1/6), y: canvasSize.height * 0.35 },
    DANCE:    { x: canvasSize.width * 0.5,   y: canvasSize.height * 0.35 },
    STAGE:    { x: canvasSize.width * (5/6), y: canvasSize.height * 0.35 },
    BUFFET:   { x: canvasSize.width * 0.25,  y: canvasSize.height * 0.85 },
    QUIET:    { x: canvasSize.width * 0.75,  y: canvasSize.height * 0.85 },
  }), [canvasSize]);

  const ZONE_INFO = React.useMemo(() => ({
    ENTRANCE: { x: canvasSize.width * (1/6), w: canvasSize.width/3, h: canvasSize.height * 0.7, y: canvasSize.height * 0.35, color: 'rgba(100,150,240,0.9)' },
    DANCE:    { x: canvasSize.width * 0.5,   w: canvasSize.width/3, h: canvasSize.height * 0.7, y: canvasSize.height * 0.35, color: 'rgba(180,100,240,0.9)' },
    STAGE:    { x: canvasSize.width * (5/6), w: canvasSize.width/3, h: canvasSize.height * 0.7, y: canvasSize.height * 0.35, color: 'rgba(240,100,140,0.9)' },
    BUFFET:   { x: canvasSize.width * 0.25,  w: canvasSize.width/2, h: canvasSize.height * 0.3, y: canvasSize.height * 0.85, color: 'rgba(240,200,100,0.9)' },
    QUIET:    { x: canvasSize.width * 0.75,  w: canvasSize.width/2, h: canvasSize.height * 0.3, y: canvasSize.height * 0.85, color: 'rgba(100,240,140,0.9)' },
  }), [canvasSize]);

  // Update randomPos to use new canvas size
  const randomPos = useCallback(() => ({
    x: Math.random() * (canvasSize.width - 40) + 20,
    y: Math.random() * (canvasSize.height - 40) + 20,
  }), [canvasSize]);

  /* -------- Reset World handler -------- */
  const handleReset = async () => {
    const res = await fetch("http://localhost:8000/reset", { method: "POST" });
    if (!res.ok) return;
  
    /* wipe local view */
    setNpcs({});
  
    /* re-pull fresh positions */
    loadStateDump();                // ← helper defined below
  };

  const loadStateDump = useCallback(async () => {
    try {
      const res = await fetch("http://localhost:8000/state_dump");
      const rows: { npc_id: number; x: number; y: number; zone: string }[] =
        res.ok ? await res.json() : [];

      const fresh: Record<number, Npc> = {};
      rows.forEach(({ npc_id, x, y, zone }) => {
        const anchor = zone && ZONE[zone as keyof typeof ZONE] ? ZONE[zone as keyof typeof ZONE] : randomPos();
        const offX = (npc_id % 4) * OFFSET;
        const offY = Math.floor(npc_id / 4) * OFFSET;
        fresh[npc_id] = {
          id: npc_id,
          x: anchor.x + offX,
          y: anchor.y + offY,
        };
      });
      setNpcs(fresh);
    } catch (err) {
      console.error("loadStateDump failed:", err);
    }
  }, []);

  /* -------- Initial load & WebSocket -------- */
  useEffect(() => {
    /* 1️⃣  load saved positions */
    loadStateDump();

    /* 2️⃣  open WebSocket (same host as page) */
    const host = window.location.hostname || "127.0.0.1";
    const ws = new WebSocket(`ws://${host}:8000/ws`);
    wsRef.current = ws;

    ws.onopen = () => console.log("✅ WebSocket connected");

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as {
        type?: string;
        npc_id?: number;
        action?: string;
        zone?: string;
      };

      if (msg.type === "RESET") {
        setNpcs({});
        loadStateDump();          // fetch new positions without refreshing page
        return;
      }
      if (msg.npc_id === undefined || msg.action === undefined) return;

      const { npc_id, action, zone } = msg as { npc_id: number; action: string; zone?: string };
      setNpcs((prev) => {
        const anchor = zone && ZONE[zone as keyof typeof ZONE] ? ZONE[zone as keyof typeof ZONE] : randomPos();
        const offsetX = (npc_id % 4) * OFFSET;
        const offsetY = Math.floor(npc_id / 4) * OFFSET;
        return {
          ...prev,
          [npc_id]: {
            id: npc_id,
            x: anchor.x + offsetX,
            y: anchor.y + offsetY,
            bubble: zone && ZONE_EMOJI[zone as keyof typeof ZONE_EMOJI] ? ZONE_EMOJI[zone as keyof typeof ZONE_EMOJI] : action,
          },
        };
      });
      // Activity Feed update
      if (msg.npc_id && msg.action && msg.zone) {
        const zone = msg.zone;
        if (isZoneKey(zone)) {
          setFeed((prev) => [
            // @ts-expect-error: zone is guaranteed to be a valid key by the type guard
            `${zone} → ${NPC_NAMES[msg.npc_id] || "NPC " + msg.npc_id}: ${ZONE_EMOJI[zone as keyof typeof ZONE_EMOJI]}`,
            ...prev,
          ]);
        }
      }
    };

    return () => ws.close();
  }, []);

  /* ----------------------------------------- */
  const npcArray = Object.values(npcs);

  return (
    <div className="flex flex-col min-h-screen w-full bg-gray-900">
      <header className="w-full flex justify-between items-center px-6 py-4 bg-gray-800">
        <h1 className="text-3xl font-bold text-white">Neha World</h1>
        <button
          onClick={handleReset}
          className="flex items-center space-x-2 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 9H9V5h2v6zm0 4H9v-2h2v2z" />
          </svg>
          <span>Reset</span>
        </button>
      </header>
      <div className="flex flex-1 w-full">
        <div className="flex-1 p-4 min-w-0" ref={containerRef}>
          <main>
            <Stage width={canvasSize.width} height={canvasSize.height} style={{ border: "1px solid #ccc" }}>
              <Layer>
                {/* Zone backgrounds */}
                {Object.entries(ZONE_INFO).map(([name, info]) => (
                  <Group key={name}>
                    <Rect
                      x={info.x - info.w / 2}
                      y={info.y - info.h / 2}
                      width={info.w}
                      height={info.h}
                      fill={info.color}
                      stroke="#fff"
                      strokeWidth={4}
                      dash={[5, 5]}
                      cornerRadius={8}
                      shadowColor="#000"
                      shadowBlur={10}
                      shadowOpacity={0.4}
                    />
                    <Text
                      text={name}
                      x={info.x - info.w / 2 + 8}
                      y={info.y - info.h / 2 + 8}
                      fontSize={16}
                      fontStyle="bold"
                      fill="#fff"
                      stroke="#000"
                      strokeWidth={1}
                    />
                  </Group>
                ))}
                {npcArray.map((n) => (
                  <Group
                    key={n.id}
                    x={n.x}
                    y={n.y}
                    draggable
                    onClick={() => {
                      setSelectedNpc(n.id);
                      fetch(`http://localhost:8000/recall?npc_id=${n.id}`)
                        .then((r) => r.json())
                        .then((data: { memories: string[] }) => setSelectedNpcRecall(data.memories || []));
                    }}
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
                  >
                    {/* avatar */}
                    <Avatar id={n.id} size={40} />

                    {/* thought bubble */}
                    {n.bubble && (
                      <Label offsetY={-50}>
                        <Tag fill="#ffffff" stroke="#999" cornerRadius={4} />
                        <Text
                          text={n.bubble}
                          fontSize={18}
                          padding={2}
                          fill="black"
                          wrap="word"
                          width={50}
                          align="center"
                        />
                      </Label>
                    )}
                  </Group>
                ))}
              </Layer>
            </Stage>
            <p className="text-sm text-gray-500 mt-2">
              Connected NPCs: {npcArray.length}
            </p>
            {selectedNpc !== null && (
              <div className="fixed inset-0 z-50 bg-black bg-opacity-60 flex items-center justify-center">
                <div className="bg-white p-6 rounded-lg shadow-lg max-w-md w-full">
                  <h2 className="text-2xl font-bold mb-4">Actions for NPC {selectedNpc}</h2>
                  <ul className="list-disc list-inside space-y-1 max-h-60 overflow-y-auto mb-4">
                    {selectedNpcRecall.map((act, idx) => (
                      <li key={idx}>{act}</li>
                    ))}
                  </ul>
                  <button
                    onClick={() => {
                      setSelectedNpc(null);
                      setSelectedNpcRecall([]);
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
        <div className="flex-shrink-0 basis-80 max-w-xs w-full p-4 overflow-y-auto bg-gray-900 bg-opacity-80 text-white">
          <aside>
            <h2 className="text-lg font-semibold mb-2">Activity Feed</h2>
            {feed.map((line, i) => (
              <div key={i} className="text-sm mb-1">{line}</div>
            ))}
          </aside>
        </div>
      </div>
    </div>
  );
}