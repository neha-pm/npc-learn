import os
import asyncio
import json
import random
import re
from typing import List, Set, Dict, Optional
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request
from dotenv import load_dotenv
from supabase import create_client, Client
from openai import OpenAI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from jinja2 import Environment, FileSystemLoader

# Global constants  
NPC_IDS = [1, 2, 3, 4, 5, 6]
EMOJIS = ["😀", "🚶", "💬", "🍞"]

# WebSocket connections store
active_connections: List[WebSocket] = []

# In-memory state store
npc_positions: Dict[int, dict] = {}

# Load environment variables
load_dotenv(dotenv_path=".env", override=True)

# Initialize OpenAI client
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Initialize Supabase client
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_ANON_KEY")
if not supabase_url or not supabase_key:
    raise ValueError("Missing Supabase credentials in environment variables")
supabase: Client = create_client(supabase_url, supabase_key)

# character definitions with nightly "daily_goal"
CHAR: dict[int, dict[str, str]] = {
    1: {
        "name": "Phoebe Buffay",
        "traits": "Free-spirited, mystical, abrupt honesty; writes odd folk songs",
        "daily_goal": "Compose a brand-new song using sounds stolen from the party and perform it on the karaoke stage",
    },
    2: {
        "name": "Sheldon Cooper",
        "traits": "Genius, rigid routines, germ-averse, trivia enthusiast",
        "daily_goal": "Claim the optimal seat, launch an uninvited 'Fun With Flags – Canada Edition', and correct three scientific inaccuracies",
    },
    3: {
        "name": "Dwight Schrute",
        "traits": "Beet farmer, volunteer sheriff, survivalist, territorial",
        "daily_goal": "Secure the barn's perimeter, sell at least five jars of 'Schrute Family Beet Relish', and log potential threats in his notebook",
    },
    4: {
        "name": "Michael Scott",
        "traits": "Attention-seeking, misreads tone, improvisational chaos",
        "daily_goal": "Host an impromptu Dundie-style award ceremony and end the night believing everyone thinks he's a 'World's Best Guest'",
    },
    5: {
        "name": "David Rose",
        "traits": "Sardonic, fashion-conscious, anxious yet empathetic",
        "daily_goal": "Stay sweat-free, curate the three most aesthetically pleasing appetisers for his Instagram, and receive at least one genuine compliment",
    },
    6: {
        "name": "Moira Rose",
        "traits": "Dramatic vocabulary, loves applause, secretly fragile ego",
        "daily_goal": "Deliver a flawless dramatic monologue, secure a single donation larger than Jocelyn's entire bake sale, and execute a mid-party wig reveal",
    },
}

ZONE_COORDS = {
    "ENTRANCE": (100, 100),
    "BUFFET":   (150, 250),
    "DANCE":    (350, 200),
    "STAGE":    (550, 150),
    "QUIET":    (300, 400),
}

# Initialize FastAPI app
app = FastAPI(
    title="NPC Learn API",
    description="API for NPC Learning Platform",
    version="1.0.0"
)

# Configure CORS - more permissive for development
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "*"
]

# Jinja environment
tmpl_env = Environment(loader=FileSystemLoader("prompts"))
def render_tmpl(template_name: str, **kw) -> str:
    """Render prompts/*.j2 with keyword args."""
    return tmpl_env.get_template(template_name).render(**kw)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize some test positions
npc_positions = {
    1: {"x": 100, "y": 100},
    2: {"x": 200, "y": 200},
    3: {"x": 300, "y": 300}
}

ZONE_WORDS = "|".join(ZONE_COORDS.keys())
ZONE_RE = re.compile(r"\b(" + ZONE_WORDS + r")\b", re.I)

def extract_zone(thought: str) -> Optional[str]:
    """Return zone name mentioned in text, else None."""
    m = ZONE_RE.search(thought)
    if m:
        return m.group(1).upper()
    return None

# ---------- WebSocket plumbing ----------  #
clients: Set[WebSocket] = set()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)   # or .add()

    try:
        while True:
            await asyncio.sleep(60)        # just keep it alive
    except asyncio.CancelledError:
        pass
    finally:
        if websocket in active_connections:
            active_connections.remove(websocket)

async def broadcast_npc_action(
    npc_id: int,
    emoji: str,
    zone: Optional[str] = None,
) -> None:
    payload = {"npc_id": npc_id, "action": emoji}
    if zone:
        payload["zone"] = zone

    stale: list[WebSocket] = []

    for ws in active_connections:
        try:
            await ws.send_json(payload)      # <- await = no overlap
        except Exception:
            stale.append(ws)                 # collect dead sockets

    for ws in stale:                         # prune once per tick
        active_connections.remove(ws)
# ----------------------------------------  #


# Pydantic model for tick input
class TickIn(BaseModel):
    npc_id: int
    text: str

class RecallOut(BaseModel):
    memories: list[str]

class StateUpdate(BaseModel):
    npc_id: int
    x: float
    y: float

# helper to fetch the N most-recent memories for an npc
def get_recent_memories(npc_id: int, limit: int = 3) -> list[str]:
    res = (supabase
           .table("memories")
           .select("content")
           .eq("npc_id", npc_id)
           .order("created_at", desc=True)
           .limit(limit)
           .execute())
    return [row["content"] for row in (res.data or [])]

@app.get("/recall", response_model=RecallOut)
async def recall(npc_id: int):
    return {"memories": get_recent_memories(npc_id)}

@app.get("/state_dump")
async def get_state():
    """Return all saved NPC positions from the database."""
    print("[DEBUG] /state_dump called")
    try:
        res = supabase.table("npc_state").select("*").execute()
        positions = [
            {"npc_id": row["npc_id"], "x": row["x"], "y": row["y"]}
            for row in (res.data or [])
        ]
        print(f"[DEBUG] Returning positions: {positions}")
        return positions
    except Exception as e:
        print(f"[ERROR] Error in state_dump: {e}")
        return []

# ---------------- save position -----------------------
@app.post("/state")
async def update_state(state: StateUpdate):
    """Update an NPC's position."""
    try:
        npc_positions[state.npc_id] = {"x": state.x, "y": state.y}
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def embed(text: str) -> list[float]:
    """Return the embedding vector for `text`."""
    try:
        resp = openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=text,
        )
        return resp.data[0].embedding
    except Exception as e:
        print(f"Error generating embedding: {e}")
        return []



# (If this table already exists in your file, keep only one copy)

# ─── helper to pick a random external event once per loop ─────────────
EVENTS = ["", "POWER_FLICKER", "BEET_EMERGENCY", "MUSIC_SWAP"]
def random_event() -> str:
    """Return an event name or empty string (no event)."""
    return random.choice(EVENTS)

# ─── parse [emoji] Thought lines coming back from the LLM ─────────────
EMOJI_RE = re.compile(r"^\s*\[([^\]]+)]\s*(.+)$")
def parse_observation(raw: str) -> tuple[str, str]:
    m = EMOJI_RE.match(raw.strip())
    if not m:
        return "🤔", raw.strip()
    return m.group(1), m.group(2)

# ─────────────────────────────────────────────────────────────
# ticker() — with plan seeding, zone-aware prompts, movement
# ─────────────────────────────────────────────────────────────
async def ticker():
    """Background loop: every 5 s each NPC observes, acts, and may change zone."""
    # --- one-time init  -------------------------------------------------
    tick_count = 0
    planned: set[int] = set()              # npc_ids that already have a plan

    # cache current zone per NPC from DB (defaults to ENTRANCE)
    npc_zone: dict[int, str] = {
        row["npc_id"]: row["zone"]
        for row in (
            supabase.table("npc_state").select("npc_id", "zone").execute().data or []
        )
    }

    while True:
        tick_count += 1
        time_label = f"{tick_count * 5} sec"
        current_event = random_event()            # ""  or e.g. "POWER_FLICKER"

        for npc in NPC_IDS:
            try:
                char = CHAR[npc]

                # ── 1. nightly plan (runs once) ───────────────────────────
                if npc not in planned:
                    plan_prompt = render_tmpl(
                        "plan.j2",
                        name=char["name"],
                        traits=char["traits"],
                        daily_goal=char["daily_goal"],
                    )
                    plan_txt = (
                        openai_client.chat.completions.create(
                            model="gpt-4o-mini",
                            messages=[{"role": "user", "content": plan_prompt}],
                            temperature=0.6,
                            max_tokens=80,
                        )
                        .choices[0]
                        .message.content
                    )
                    supabase.table("memories").insert(
                        {
                            "npc_id": npc,
                            "kind": "plan",
                            "content": plan_txt,
                            "embedding": None,
                        }
                    ).execute()
                    planned.add(npc)

                # ── 2. observation prompt ────────────────────────────────
                zone_now = npc_zone.get(npc, "ENTRANCE")
                prompt = render_tmpl(
                    "observe.j2",
                    name=char["name"],
                    traits=char["traits"],
                    time_label=time_label,
                    zone=zone_now,
                    event=current_event or "none",
                    memories=get_recent_memories(npc, 3),
                )

                reply = (
                    openai_client.chat.completions.create(
                        model="gpt-4o-mini",
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0.7,
                        max_tokens=60,
                    )
                    .choices[0]
                    .message.content
                )

                emoji, thought = parse_observation(reply)
                embedding = embed(thought)

                # store observation
                supabase.table("memories").insert(
                    {
                        "npc_id": npc,
                        "kind": "observation",
                        "content": f"{emoji} {thought}",
                        "embedding": embedding,
                    }
                ).execute()

                # ── 3. detect movement intent & update npc_state ─────────
                new_zone = extract_zone(thought)
                if new_zone and new_zone in ZONE_COORDS and new_zone != zone_now:
                    x, y = ZONE_COORDS[new_zone]
                    # Directly upsert into npc_state table
                    supabase.table("npc_state").upsert(
                        {"npc_id": npc, "x": x, "y": y, "zone": new_zone}
                    ).execute()
                    npc_zone[npc] = new_zone          # update cache

                # ── 4. broadcast emoji to viewers ───────────────────────
                await broadcast_npc_action(npc, emoji, npc_zone.get(npc))
                print(f"[TICK] {char['name']} → {emoji} {thought}")
            except Exception as e:
                print(f"[TICK ERROR] NPC {npc}: {e}")

        print("TICK LOOP STILL RUNNING: tick", tick_count)
        await asyncio.sleep(5)

@app.on_event("startup")
async def start_ticker():
    """Start the background ticker task when the application starts."""
    asyncio.create_task(ticker())

@app.get("/")
async def root():
    return {"message": "Welcome to NPC Learn API"}

@app.post("/tick", response_model=List[str])
async def create_tick(tick: TickIn):
    try:
        # Generate embedding for the observation
        embedding = embed(tick.text)
        if not embedding:
            raise HTTPException(status_code=500, detail="Failed to generate embedding")
        
        # Insert the new memory
        supabase.table("memories").insert({
            "npc_id": tick.npc_id,
            "kind": "observation",
            "content": tick.text,
            "embedding": embedding
        }).execute()
        
        # Query for similar memories
        result = supabase.rpc(
            'match_memories',
            {
                'query_embedding': embedding,
                'match_count': 5,
                'npc_identifier': tick.npc_id
            }
        ).execute()
        
        # Extract and return the contents
        memories = result.data if result.data else []
        return [memory['content'] for memory in memories]
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/reset")
# ------------------------------------------------------------------
# /reset  — wipe and reseed DB, then notify all viewers
# ------------------------------------------------------------------
async def reset_world(request: Request):
    try:
        # 1️⃣  clear tables
        supabase.rpc("wipe_memories").execute()
        supabase.rpc("wipe_npc_state").execute()

        # 2️⃣  seed fresh PLAN memories
        plan_seeds = [
            (1, 'Moira promised I could debut "Barnyard Cat" tonight'),
            (2, "I mapped optimal escape routes from barn to motel room 3B"),
            (3, "Beet sales pitch must reach at least three party-goers"),
            (4, 'Moira said "Just mingle, don\'t hijack". Must hijack.'),
            (5, "Stevie bet I wouldn't last 30 min without complaining"),
            (6, "Tonight's donations must exceed Jocelyn's bake-sale total"),
        ]
        for npc_id, txt in plan_seeds:
            supabase.table("memories").insert(
                {"npc_id": npc_id, "kind": "plan", "content": txt, "embedding": None}
            ).execute()

        # 3️⃣  wipe + reseed npc_state in one shot
        seed_pos = [
            {"npc_id": 1, "x": 100, "y": 100, "zone": "ENTRANCE"},
            {"npc_id": 2, "x": 130, "y": 100, "zone": "ENTRANCE"},
            {"npc_id": 3, "x": 160, "y": 100, "zone": "ENTRANCE"},
            {"npc_id": 4, "x": 190, "y": 100, "zone": "ENTRANCE"},
            {"npc_id": 5, "x": 220, "y": 100, "zone": "ENTRANCE"},
            {"npc_id": 6, "x": 250, "y": 100, "zone": "ENTRANCE"},
        ]

        supabase.rpc("reset_npc_state", {"seed_pos": seed_pos}).execute()

        # DEBUG — fetch rows immediately after the RPC
        check = supabase.table("npc_state").select("*").execute()
        print("NPC_STATE after reset →", check)

        # 4️⃣  clear any in-memory caches
        npc_positions.clear()        # ignore if variable doesn't exist

        # 5️⃣  broadcast reset to all websocket clients
        for ws in list(active_connections):
            try:
                await ws.send_json({"type": "RESET"})
            except Exception:
                pass  # ignore errors
        active_connections.clear()  # clear all after reset

        return {"status": "reset complete"}

    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))

@app.get("/ping")
async def ping():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True) 