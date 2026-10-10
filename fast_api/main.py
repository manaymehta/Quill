import asyncio
from functools import partial
import json
import os
import re
import time
import uuid
import uvicorn
from contextlib import asynccontextmanager
from google import genai
from google.genai import types
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct,
    Filter, FieldCondition, MatchValue,
    FilterSelector, PointIdsList, PayloadSchemaType
)
from fastapi import FastAPI, HTTPException, Header, Response, Depends
from fastapi.responses import StreamingResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from agent import (
    run_agent_turn,
    AgentChatRequest,
    QuotaExceeded,
    ToolContext,
)

load_dotenv()

# Constants
COLLECTION_NAME = "notes_chunks"
EMBEDDING_DIM = 768
EMBEDDING_MODEL = "gemini-embedding-2"
GEMINI_MODEL = "gemini-3.5-flash-lite"

# Max characters per chunk — roughly 250 tokens at ~4 chars/token
MAX_CHUNK_CHARS = 1000
OVERLAP_CHARS = 100
MERGE_THRESHOLD = 60  # Fragments shorter than this are merged into the previous chunk
ABBREV_RE = re.compile(r'\b(?:eg|ie|dr|mr|ms|vs|st|prof|dept)\.$', re.IGNORECASE)

# These limits protect the provider-facing endpoints, not MongoDB note storage.
# A note can still be saved when its AI operation is rejected or unavailable.
MAX_AI_TEXT_CHARS = 200_000
MAX_SEARCH_QUERY_CHARS = 4_000

gemini_client: genai.Client | None = None
qdrant_client: QdrantClient | None = None
embedding_locks: dict[str, asyncio.Lock] = {}
embedding_lock_users: dict[str, int] = {}


async def run_blocking(function, *args, **kwargs):
    """Run synchronous SDK/database calls without blocking FastAPI's event loop."""
    return await asyncio.to_thread(partial(function, *args, **kwargs))


def acquire_embedding_lock(note_id: str) -> asyncio.Lock:
    lock = embedding_locks.setdefault(note_id, asyncio.Lock())
    embedding_lock_users[note_id] = embedding_lock_users.get(note_id, 0) + 1
    return lock


def release_embedding_lock(note_id: str, lock: asyncio.Lock) -> None:
    remaining_users = embedding_lock_users.get(note_id, 0) - 1
    if remaining_users <= 0:
        embedding_lock_users.pop(note_id, None)
        if embedding_locks.get(note_id) is lock:
            embedding_locks.pop(note_id, None)
    else:
        embedding_lock_users[note_id] = remaining_users


# Chunking
# Prepend a tail of the previous chunk to give each chunk context from the one before it.
def apply_overlap(chunks: list[str], overlap: int = OVERLAP_CHARS) -> list[str]:
    if len(chunks) <= 1:
        return chunks
    overlapped = [chunks[0]]
    for i in range(1, len(chunks)):
        tail = chunks[i - 1][-overlap:]
        # Find a clean word boundary so overlap doesn't start mid-word
        space = tail.find(' ')
        clean_tail = tail[space + 1:] if space != -1 else tail
        overlapped.append(clean_tail + " " + chunks[i])
    return overlapped


# Scan backwards from max_chars to find the cleanest cut point using a punctuation hierarchy.
# Paragraph-level splitting is handled upstream in chunk_text, not here.
def find_best_split_point(text: str, max_chars: int) -> int:
    if len(text) <= max_chars:
        return len(text)
        
    search_text = text[:max_chars]
    
    # Layer 1 - Sentence endings (. ! ? … followed by space or EOF)
    for match in reversed(list(re.finditer(r'[.!?…](?=\s|$)', search_text))):
        if match.group() == '.' and ABBREV_RE.search(search_text[:match.end()]):
            continue
        return match.end()
        
    # Layer 2 - Clause endings (; : — – ) ] } " and smart quotes)
    matches = list(re.finditer(r'[;:—–)\]}\"\u201d\u2019]\s*', search_text))
    if matches:
        return matches[-1].end()
        
    # Layer 3 - Natural pauses
    matches = list(re.finditer(r',\s*', search_text))
    if matches:
        return matches[-1].end()
        
    # Layer 4 - Word boundaries — never cut a word in half
    space_idx = search_text.rfind(' ')
    if space_idx != -1:
        return space_idx + 1
        
    # Layer 5 - Hard slice — no usable boundary found, cut at the limit
    return max_chars


# Split note text into chunks for embedding. Paragraph breaks first, then punctuation fallbacks.
def chunk_text(text: str) -> list[str]:
    if not text or not text.strip():
        return []

    # Split on paragraph breaks first
    raw_paras = [p.strip() for p in text.split("\n\n") if p.strip()]
    
    segments: list[str] = []
    
    for para in raw_paras:
        remaining_para = para
        while remaining_para:
            # If the paragraph fits within the limit, pack it as a complete segment
            if len(remaining_para) <= MAX_CHUNK_CHARS:
                segments.append(remaining_para)
                break
                
            # Too long — find the best cut point
            split_idx = find_best_split_point(remaining_para, MAX_CHUNK_CHARS)
            
            # Failsafe against infinite loops
            split_idx = max(split_idx, 1)
                
            segments.append(remaining_para[:split_idx].strip())
            remaining_para = remaining_para[split_idx:].strip()

    # Merge short trailing fragments into the previous chunk
    chunks: list[str] = []
    for seg in segments:
        if chunks and len(seg) < MERGE_THRESHOLD and (len(chunks[-1]) + len(seg) + 2) <= MAX_CHUNK_CHARS:
            chunks[-1] = chunks[-1] + "\n\n" + seg
        else:
            chunks.append(seg)
            
    # fallback in case paragraphs are all empty after stripping, shouldn't normally fire
    if not chunks and text.strip():
        remaining = text.strip()
        while remaining:
            split_idx = find_best_split_point(remaining, MAX_CHUNK_CHARS)
            split_idx = max(split_idx, 1)
            chunks.append(remaining[:split_idx].strip())
            remaining = remaining[split_idx:].strip()
            
    return apply_overlap(chunks)

# Stable UUID for a note version and chunk index. Versioned IDs let a complete
# replacement be written before the previous version is cleaned up.
def chunk_point_id(note_id: str, chunk_index: int, embedding_version: str = "legacy") -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_OID, f"{note_id}::{embedding_version}::{chunk_index}"))


# Lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    global gemini_client, qdrant_client

    api_key = os.getenv("GEMINI_API_KEY")
    if api_key:
        try:
            gemini_client = genai.Client(api_key=api_key)
            print("Gemini client ready")
        except Exception as e:
            print(f"Gemini init failed: {e}")
    else:
        print("GEMINI_API_KEY not set")

    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_key = os.getenv("QDRANT_API_KEY")
    if qdrant_url:
        try:
            qdrant_client = QdrantClient(url=qdrant_url, api_key=qdrant_key)

            existing = [
                c.name
                for c in (await run_blocking(qdrant_client.get_collections)).collections
            ]
            if COLLECTION_NAME not in existing:
                await run_blocking(
                    qdrant_client.create_collection,
                    collection_name=COLLECTION_NAME,
                    vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
                )
                await run_blocking(
                    qdrant_client.create_payload_index,
                    collection_name=COLLECTION_NAME,
                    field_name="userId",
                    field_schema=PayloadSchemaType.KEYWORD,
                )
                await run_blocking(
                    qdrant_client.create_payload_index,
                    collection_name=COLLECTION_NAME,
                    field_name="noteId",
                    field_schema=PayloadSchemaType.KEYWORD,
                )
                print(f"Qdrant chunk collection '{COLLECTION_NAME}' created")
            else:
                print(f"Qdrant chunk collection '{COLLECTION_NAME}' found")
        except Exception as e:
            print(f"Qdrant init failed: {e}")
    else:
        print("QDRANT_URL not set")

    try:
        yield
    finally:
        if qdrant_client is not None:
            try:
                await run_blocking(qdrant_client.close)
            except Exception as e:
                print(f"Qdrant shutdown error: {e}")
        print("Shutting down Quill AI Microservice")


# Auth & App
api_key_header = APIKeyHeader(name="x-api-key", auto_error=False)

def verify_api_key(api_key: str = Depends(api_key_header)):
    expected_key = os.getenv("FASTAPI_INTERNAL_KEY")
    if not expected_key:
        raise HTTPException(status_code=503, detail="AI service authentication is not configured")
    if api_key != expected_key:
        raise HTTPException(status_code=403, detail="Invalid API Key")

app = FastAPI(
    title="Quill AI Microservice",
    description="AI summarization, note indexing and the notes agent for Quill.",
    version="3.0.0",
    lifespan=lifespan,
)

# Render probes health directly; application routes require the internal key.
@app.get("/")
async def root(_: None = Depends(verify_api_key)):
    return {"message": "Quill AI Microservice is running."}

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.head("/health")
async def health_head():
    return Response(status_code=200)


@app.get("/ready")
async def ready():
    checks = {
        "gemini": gemini_client is not None,
        "qdrant": False,
    }
    if qdrant_client is not None:
        try:
            await asyncio.wait_for(run_blocking(qdrant_client.get_collections), timeout=3)
            checks["qdrant"] = True
        except Exception as e:
            print(f"Qdrant readiness check failed: {e}")

    if not all(checks.values()):
        raise HTTPException(status_code=503, detail={"status": "not_ready", "checks": checks})
    return {"status": "ready", "checks": checks}


# Schemas
class SummarizeRequest(BaseModel):
    text: str = Field(max_length=MAX_AI_TEXT_CHARS)

class SummarizeResponse(BaseModel):
    summary: str

class EmbedNoteRequest(BaseModel):
    noteId: str = Field(max_length=128)
    userId: str = Field(max_length=128)
    title: str = Field(default="", max_length=MAX_AI_TEXT_CHARS)
    text: str = Field(max_length=MAX_AI_TEXT_CHARS)
    embeddingVersion: str = Field(default="", max_length=128)
    isArchived: bool = False
    # Fingerprint of the indexed title + text (Express note-index.service), stored
    # on every piece so search can tell when a piece is from an older version.
    textHash: str = Field(default="", max_length=64)
    # Put in front of every piece with the title, so tagged notes match by meaning.
    tags: list[str] = Field(default_factory=list, max_length=50)

# Summarize
@app.post("/summarize", response_model=SummarizeResponse)
async def summarize_text(request: SummarizeRequest, _: None = Depends(verify_api_key)):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text content cannot be empty.")
    if len(text) < 50:
        return {"summary": "Too short to summarize."}
    if gemini_client is None:
        raise HTTPException(status_code=503, detail="Summarization service not available.")

    prompt = (
        "You are a smart note-taking assistant. Provide a clear, concise summary of the following note.\n"
        "Guidelines:\n"
        "- Use 3 to 4 short, easily scannable bullet points.\n"
        "- Focus only on the most critical information, action items, or core concepts.\n"
        "- Format using clean markdown (use **bolding** for key terms).\n\n"
        f"Note Content:\n{text}\n\n"
        "Summary:"
    )
    start_time = time.perf_counter()
    try:
        response = await run_blocking(
            gemini_client.models.generate_content,
            model=GEMINI_MODEL,
            contents=prompt,
        )
        summary = response.text.strip()
        if not summary:
            raise HTTPException(status_code=500, detail="Gemini returned an empty response.")
        duration = time.perf_counter() - start_time
        print(f"Summarization completed in {duration:.2f}s")
        return {"summary": summary}
    except Exception as e:
        print(f"Gemini summarization error: {e}")
        raise HTTPException(status_code=500, detail="Failed to summarize note.")
# Embed Note
# Chunk the note, embed each chunk, and replace its Qdrant vectors.
# New vectors are written before stale chunks are removed, so a provider or
# upsert failure cannot erase a previously searchable version of the note.
@app.post("/embed-note")
async def embed_note(request: EmbedNoteRequest, _: None = Depends(verify_api_key)):
    if qdrant_client is None or gemini_client is None:
        raise HTTPException(status_code=503, detail="Vector store not available.")

    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required for embedding.")

    chunks = chunk_text(text)
    if not chunks:
        raise HTTPException(status_code=400, detail="Text is required for embedding.")

    # title and tags are prepended for embedding context only, not stored in payload.
    # Each chunk must be its own Content: gemini-embedding-2 merges a list of
    # plain strings into ONE embedding (verified Oct 2026), which failed every
    # note longer than one chunk with "invalid response".
    tags = [t.strip()[:100] for t in request.tags if t and t.strip()]
    header = (f"Note Title: {request.title}\n" if request.title else "") + (f"Tags: {', '.join(tags)}\n" if tags else "")
    prefix = f"{header}---\n" if header else ""
    embed_contents = [
        types.Content(parts=[types.Part(text=f"{prefix}{c}")])
        for c in chunks
    ]

    start_time = time.perf_counter()
    try:
        result = await run_blocking(
            gemini_client.models.embed_content,
            model=EMBEDDING_MODEL,
            contents=embed_contents,
            config=types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIM),
        )
        vectors = [list(e.values) for e in (result.embeddings or [])]
        duration = time.perf_counter() - start_time
        print(f"Generated {len(vectors)} embeddings for note {request.noteId} in {duration:.2f}s")
    except Exception as e:
        print(f"Embedding error: {e}")
        raise HTTPException(status_code=500, detail="Failed to embed note.")

    if len(vectors) != len(chunks) or any(len(vector) != EMBEDDING_DIM for vector in vectors):
        print(
            f"Embedding response shape mismatch for {request.noteId}: "
            f"received {len(vectors)} vectors for {len(chunks)} chunks"
        )
        raise HTTPException(status_code=502, detail="Embedding provider returned an invalid response.")

    points = [
        PointStruct(
            id=chunk_point_id(request.noteId, i, request.embeddingVersion or "legacy"),
            vector=vectors[i],
            payload={
                "noteId": request.noteId,
                "userId": request.userId,
                "chunkIndex": i,
                "title": request.title,
                "text": chunks[i],
                "embeddingVersion": request.embeddingVersion,
                "isArchived": request.isArchived,
                "textHash": request.textHash,
            },
        )
        for i in range(len(chunks))
    ]
    note_lock = acquire_embedding_lock(request.noteId)
    try:
        async with note_lock:
            # Re-read after provider work and serialize this final section. This
            # prevents a slower older request from overwriting a newer version.
            try:
                existing_points, _ = await run_blocking(
                    qdrant_client.scroll,
                    collection_name=COLLECTION_NAME,
                    scroll_filter=Filter(
                        must=[FieldCondition(key="noteId", match=MatchValue(value=request.noteId))]
                    ),
                    with_payload=True,
                    with_vectors=False,
                    limit=10_000,
                )
            except Exception as e:
                print(f"Qdrant read error for {request.noteId}: {e}")
                raise HTTPException(status_code=503, detail="Unable to read existing embeddings.")

            if request.embeddingVersion:
                existing_versions = [
                    point.payload.get("embeddingVersion")
                    for point in existing_points
                    if point.payload and point.payload.get("embeddingVersion")
                ]
                newest_existing_version = max(existing_versions, default="")
                if newest_existing_version and request.embeddingVersion < newest_existing_version:
                    return {"status": "stale", "noteId": request.noteId}

            try:
                await run_blocking(qdrant_client.upsert, collection_name=COLLECTION_NAME, points=points)
                new_point_ids = {point.id for point in points}
                stale_point_ids = [point.id for point in existing_points if point.id not in new_point_ids]
            except Exception as e:
                print(f"Qdrant upsert error: {e}")
                raise HTTPException(status_code=500, detail="Failed to store embeddings.")

            if stale_point_ids:
                try:
                    await run_blocking(
                        qdrant_client.delete,
                        collection_name=COLLECTION_NAME,
                        points_selector=PointIdsList(points=stale_point_ids),
                    )
                except Exception as e:
                    # The new version is already available. Report the partial cleanup
                    # explicitly so the caller can warn without losing the saved note.
                    print(f"Qdrant stale-chunk cleanup error for {request.noteId}: {e}")
                    return {
                        "status": "partial",
                        "noteId": request.noteId,
                        "chunks": len(chunks),
                        "staleChunks": len(stale_point_ids),
                    }

            return {"status": "ok", "noteId": request.noteId, "chunks": len(chunks)}
    finally:
        release_embedding_lock(request.noteId, note_lock)


# Delete Embedding
# Remove all Qdrant chunks for a given note.
@app.delete("/delete-embedding/{note_id}")
async def delete_embedding(note_id: str, _: None = Depends(verify_api_key)):
    if qdrant_client is None:
        raise HTTPException(status_code=503, detail="Vector store not available.")
    note_lock = acquire_embedding_lock(note_id)
    try:
        async with note_lock:
            await run_blocking(
                qdrant_client.delete,
                collection_name=COLLECTION_NAME,
                points_selector=FilterSelector(
                    filter=Filter(
                        must=[FieldCondition(key="noteId", match=MatchValue(value=note_id))]
                    )
                ),
            )
            return {"status": "ok", "noteId": note_id}
    except Exception as e:
        print(f"Delete embedding error: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete embedding.")
    finally:
        release_embedding_lock(note_id, note_lock)


# Agent Chat
# The loop owns orchestration; tools execute against Express using the user's
# own forwarded JWT (Authorization header), so the agent can never exceed the
# caller's permissions and never sees MongoDB directly.
#
# The reply is a Server-Sent Events stream (architecture plan §2.1, step 1a):
# `step` events while the turn works, then exactly one `final` or `error`
# event. A comment line every few seconds keeps proxies from treating the
# connection as idle. When the client disconnects (Stop), Starlette cancels
# the stream and the turn task is cancelled with it.
AGENT_KEEPALIVE_SECONDS = 10.0
AGENT_FAILED_MESSAGE = "The assistant hit a problem and couldn't answer. Try again."
AGENT_QUOTA_MESSAGE = (
    "The assistant is at its request limit right now — try again in about "
    "{seconds} seconds."
)


async def agent_meaning_search(query: str, user_id: str, limit: int) -> list[dict]:
    """The agent's meaning search (architecture plan §2.4): embed the query and
    return this user's closest indexed pieces. No LLM call; scoring, cutoffs
    and merging with the exact search happen in agent/retrieval.py."""
    if qdrant_client is None or gemini_client is None:
        raise RuntimeError("Vector store not available.")
    result = await gemini_client.aio.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=query[:MAX_SEARCH_QUERY_CHARS],
        config=types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIM),
    )
    query_vector = list(result.embeddings[0].values)
    found = await run_blocking(
        qdrant_client.query_points,
        collection_name=COLLECTION_NAME,
        query=query_vector,
        query_filter=Filter(must=[FieldCondition(key="userId", match=MatchValue(value=user_id))]),
        limit=limit,
        with_payload=True,
    )
    return [
        {
            "noteId": str(point.payload.get("noteId", "")),
            "chunkIndex": int(point.payload.get("chunkIndex", 0) or 0),
            "text": str(point.payload.get("text", "") or ""),
            "score": float(point.score),
            "textHash": str(point.payload.get("textHash", "") or ""),
        }
        for point in found.points
        if point.payload and point.payload.get("noteId")
    ]


def sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.post("/agent/chat")
async def agent_chat(
    request: AgentChatRequest,
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
    _: None = Depends(verify_api_key),
):
    if gemini_client is None:
        raise HTTPException(status_code=503, detail="Agent service not available.")
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    if not authorization or not authorization.strip():
        raise HTTPException(status_code=400, detail="User authorization header is required.")

    express_base_url = (os.getenv("EXPRESS_INTERNAL_URL") or "").rstrip("/")
    tool_context = ToolContext(
        user_id=x_user_id or "",
        auth_header=authorization.strip(),
        express_base_url=express_base_url,
        unsaved_notes={note.noteId: note.model_dump() for note in request.unsavedNotes},
        meaning_search=agent_meaning_search,
    )
    events: asyncio.Queue[str | None] = asyncio.Queue()

    async def on_step(label: str) -> None:
        events.put_nowait(sse_event("step", {"label": label}))

    async def run_turn() -> None:
        start_time = time.perf_counter()
        try:
            result = await run_agent_turn(
                gemini_client=gemini_client,
                message=request.message.strip(),
                history=request.history,
                working_set=request.workingSet,
                tool_context=tool_context,
                on_step=on_step,
            )
            print(
                f"Agent chat turn completed in {time.perf_counter() - start_time:.2f}s "
                f"(tools used: {len(result.toolsUsed)}, user: {x_user_id or 'unknown'})"
            )
            events.put_nowait(sse_event("final", result.model_dump()))
        except QuotaExceeded as exc:
            print(f"Agent chat turn stopped by the Gemini quota (retry in ~{exc.retry_after_seconds}s)")
            events.put_nowait(sse_event("error", {
                "message": AGENT_QUOTA_MESSAGE.format(seconds=exc.retry_after_seconds),
                "retryAfterSeconds": exc.retry_after_seconds,
            }))
        except Exception as e:
            print(f"Agent chat error: {e!r}")
            events.put_nowait(sse_event("error", {"message": AGENT_FAILED_MESSAGE}))
        finally:
            events.put_nowait(None)

    async def stream():
        turn = asyncio.create_task(run_turn())
        try:
            yield ": connected\n\n"
            while True:
                try:
                    item = await asyncio.wait_for(events.get(), timeout=AGENT_KEEPALIVE_SECONDS)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if item is None:
                    break
                yield item
        finally:
            if not turn.done():
                turn.cancel()
                print(f"Agent chat turn cancelled: client disconnected (user: {x_user_id or 'unknown'})")

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    if "PORT" in os.environ:
        uvicorn.run(app, host="0.0.0.0", port=int(os.environ["PORT"]))
    else:
        uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
