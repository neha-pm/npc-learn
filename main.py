import os
import asyncio
import random
from typing import List
from fastapi import FastAPI, HTTPException
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

# Pydantic model for tick input
class TickIn(BaseModel):
    npc_id: int
    text: str

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