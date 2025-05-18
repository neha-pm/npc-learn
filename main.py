import os
import asyncio
import json
import random
from typing import List, Set
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from dotenv import load_dotenv
from supabase import create_client, Client
from openai import OpenAI
from pydantic import BaseModel

# Global constants
NPC_IDS = [1, 2, 3]
EMOJIS = ["😀", "🚶", "💬", "🍞"]

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

# Initialize FastAPI app
app = FastAPI(
    title="NPC Learn API",
    description="API for NPC Learning Platform",
    version="1.0.0"
)

# ---------- WebSocket plumbing ----------  #
clients: Set[WebSocket] = set()

@app.websocket("/ws")

async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        while True:                          # keep connection alive
            await ws.receive_text()          # ignore content; just ping-pong
    except WebSocketDisconnect:
        clients.discard(ws)

def broadcast_npc_action(npc_id: int, action: str):   
    payload = json.dumps({"npc_id": npc_id, "action": action})
    for ws in list(clients):                 # copy → safe iteration
        if ws.application_state.value == 2:  # CLOSED
            clients.discard(ws)
            continue
        asyncio.create_task(ws.send_text(payload))
# ----------------------------------------  #
# Pydantic model for tick input
class TickIn(BaseModel):
    npc_id: int
    text: str

class RecallOut(BaseModel):
    memories: list[str]

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

# ---------------- save position -----------------------
@app.post("/state")
async def save_state(npc_id: int, x: float, y: float):
    supabase.table("npc_state").upsert(
        {"npc_id": npc_id, "x": x, "y": y}
    ).execute()
    return {"status": "ok"}

def embed(text: str) -> list[float]:
    """Return the embedding vector for `text`."""
    resp = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=text,
    )
    # One input → one embedding
    return resp.data[0].embedding

async def ticker():
    """Background task that generates periodic observations for NPCs."""
    initial_positions: dict[int, tuple[float, float]] = {}
    res = supabase.table("npc_state").select("*").execute()
    for row in res.data or []:
        initial_positions[row["npc_id"]] = (row["x"], row["y"])
        while True:
            for npc in NPC_IDS:
                action = random.choice(EMOJIS)
                # Generate embedding and insert memory
                embedding = embed(action)
                supabase.table("memories").insert({
                    "npc_id": npc,
                    "kind": "observation",
                    "content": action,
                    "embedding": embedding
                }).execute()
                broadcast_npc_action(npc, action)
                print(f"[TICK] npc {npc} -> {action}")
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True) 