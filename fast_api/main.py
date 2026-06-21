import os
import re
import uuid
import uvicorn
from contextlib import asynccontextmanager
from google import genai
from google.genai import types
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct,
    Filter, FieldCondition, MatchValue,
    FilterSelector, PayloadSchemaType
)
from fastapi import FastAPI, HTTPException, Response, Depends
from fastapi.security import APIKeyHeader
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# Constants
COLLECTION_NAME = "notes_chunks"
EMBEDDING_DIM = 768
EMBEDDING_MODEL = "gemini-embedding-2"
GEMINI_MODEL = "gemini-3.1-flash-lite"

# Chunks below this score are too weak to surface in results
MIN_SCORE_THRESHOLD = 0.58

# Max characters per chunk — roughly 250 tokens at ~4 chars/token
MAX_CHUNK_CHARS = 1000
OVERLAP_CHARS = 100
MERGE_THRESHOLD = 60  # Fragments shorter than this are merged into the previous chunk
ABBREV_RE = re.compile(r'\b(?:eg|ie|dr|mr|ms|vs|st|prof|dept)\.$', re.IGNORECASE)

gemini_client: genai.Client | None = None
qdrant_client: QdrantClient | None = None


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

# Stable UUID for a (noteId, chunkIndex) pair — same input always produces the same ID.
def chunk_point_id(note_id: str, chunk_index: int) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_OID, f"{note_id}::{chunk_index}"))


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

            existing = [c.name for c in qdrant_client.get_collections().collections]
            if COLLECTION_NAME not in existing:
                qdrant_client.create_collection(
                    collection_name=COLLECTION_NAME,
                    vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
                )
                qdrant_client.create_payload_index(
                    collection_name=COLLECTION_NAME,
                    field_name="userId",
                    field_schema=PayloadSchemaType.KEYWORD,
                )
                qdrant_client.create_payload_index(
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

    yield
    print("Shutting down Quill AI Microservice")


# Auth & App
api_key_header = APIKeyHeader(name="x-api-key", auto_error=False)

def verify_api_key(api_key: str = Depends(api_key_header)):
    expected_key = os.getenv("FASTAPI_INTERNAL_KEY")
    if not expected_key:
        # Auth is unconfigured — log a startup warning but allow the request.
        # This prevents hard lockouts in dev, but should be set in production.
        return
    if api_key != expected_key:
        raise HTTPException(status_code=403, detail="Invalid API Key")

app = FastAPI(
    title="Quill AI Microservice",
    description="AI summarization and semantic search service for Quill.",
    version="3.0.0",
    lifespan=lifespan,
)

# Public routes: no auth required
@app.get("/")
async def root():
    return {"message": "Quill AI Microservice is running."}

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.head("/health")
async def health_head():
    return Response(status_code=200)


# Schemas
class SummarizeRequest(BaseModel):
    text: str

class SummarizeResponse(BaseModel):
    summary: str

class EmbedNoteRequest(BaseModel):
    noteId: str
    userId: str
    title: str = ""
    text: str

class SemanticSearchRequest(BaseModel):
    query: str
    userId: str

class SemanticSearchResponse(BaseModel):
    answer: str
    sourceNoteIds: list[str]

class ReEmbedAllRequest(BaseModel):
    userId: str
    notes: list[dict]   # [{_id, title, content}] — only used for the migration endpoint


# Summarize
@app.post("/summarize", response_model=SummarizeResponse)
async def summarize_text(request: SummarizeRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text content cannot be empty.")
    if len(text) < 50:
        return {"summary": "Too short to summarize."}
    if gemini_client is None:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY missing")

    prompt = (
        "You are a smart note-taking assistant. Provide a clear, concise summary of the following note.\n"
        "Guidelines:\n"
        "- Use 3 to 4 short, easily scannable bullet points.\n"
        "- Focus only on the most critical information, action items, or core concepts.\n"
        "- Format using clean markdown (use **bolding** for key terms).\n\n"
        f"Note Content:\n{text}\n\n"
        "Summary:"
    )
    try:
        response = gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
        summary = response.text.strip()
        if not summary:
            raise HTTPException(status_code=500, detail="Gemini returned an empty response.")
        return {"summary": summary}
    except Exception as e:
        print(f"Gemini summarization error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to summarize: {e}")


# Embed Note
# Chunk the note, embed each chunk, and upsert into Qdrant.
# Old chunks are deleted first so edits don't leave stale vectors.
@app.post("/embed-note")
async def embed_note(request: EmbedNoteRequest):
    if qdrant_client is None or gemini_client is None:
        raise HTTPException(status_code=503, detail="Vector store not available.")

    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required for embedding.")

    try:
        qdrant_client.delete(
            collection_name=COLLECTION_NAME,
            points_selector=FilterSelector(
                filter=Filter(
                    must=[FieldCondition(key="noteId", match=MatchValue(value=request.noteId))]
                )
            ),
        )
    except Exception as e:
        print(f"Warning — could not delete old chunks for {request.noteId}: {e}")

    chunks = chunk_text(text)

    # title is prepended for embedding context only, not stored in payload
    embed_contents = []
    prefix = f"Note Title: {request.title}\n---\n" if request.title else ""
    for c in chunks:
        embed_contents.append(f"{prefix}{c}")

    try:
        result = gemini_client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=embed_contents,
            config=types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIM),
        )
        vectors = [list(e.values) for e in result.embeddings]
    except Exception as e:
        print(f"Embedding error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to embed note: {e}")

    points = [
        PointStruct(
            id=chunk_point_id(request.noteId, i),
            vector=vectors[i],
            payload={
                "noteId": request.noteId,
                "userId": request.userId,
                "chunkIndex": i,
                "title": request.title,
                "text": chunks[i],
            },
        )
        for i in range(len(chunks))
    ]
    try:
        qdrant_client.upsert(collection_name=COLLECTION_NAME, points=points)
        return {"status": "ok", "noteId": request.noteId, "chunks": len(chunks)}
    except Exception as e:
        print(f"Qdrant upsert error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to store embeddings: {e}")


# Delete Embedding
# Remove all Qdrant chunks for a given note.
@app.delete("/delete-embedding/{note_id}")
async def delete_embedding(note_id: str):
    if qdrant_client is None:
        raise HTTPException(status_code=503, detail="Vector store not available.")
    try:
        qdrant_client.delete(
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
        raise HTTPException(status_code=500, detail=f"Failed to delete embedding: {e}")


# Semantic Search
# Embed the query → retrieve top chunks → filter by score → build context → generate answer.
@app.post("/semantic-search", response_model=SemanticSearchResponse)
async def semantic_search(request: SemanticSearchRequest):
    if qdrant_client is None or gemini_client is None:
        raise HTTPException(status_code=503, detail="Vector store not available.")
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    try:
        result = gemini_client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=request.query,
            config=types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIM),
        )
        query_vector = list(result.embeddings[0].values)

        results = qdrant_client.query_points(
            collection_name=COLLECTION_NAME,
            query=query_vector,
            query_filter=Filter(
                must=[FieldCondition(key="userId", match=MatchValue(value=request.userId))]
            ),
            limit=10,
            with_payload=True,
        )

        strong_hits = [r for r in results.points if r.score >= MIN_SCORE_THRESHOLD]

        if not strong_hits:
            return SemanticSearchResponse(
                answer="I couldn't find any notes relevant to your question.",
                sourceNoteIds=[],
            )

        # group matching chunks by note
        source_note_ids: list[str] = []
        notes_context: dict[str, dict] = {}

        for hit in strong_hits:
            if not hit.payload:
                continue
            note_id = hit.payload.get("noteId", "")
            chunk_text_val = hit.payload.get("text", "")
            title_val = hit.payload.get("title", "")
            
            if note_id and chunk_text_val:
                if note_id not in notes_context:
                    notes_context[note_id] = {"title": title_val, "chunks": []}
                    source_note_ids.append(note_id)
                notes_context[note_id]["chunks"].append(chunk_text_val)

        if not notes_context:
            return SemanticSearchResponse(
                answer="I couldn't find any notes relevant to your question.",
                sourceNoteIds=[],
            )

        # build context string from grouped chunks
        context_blocks = []
        for note_id, data in notes_context.items():
            t = data["title"]
            header = f"### From note: \"{t}\"" if t else "### From a note:"
            chunks_str = "\n".join(data["chunks"])
            context_blocks.append(f"{header}\n{chunks_str}")
            
        context = "\n\n".join(context_blocks)

        prompt = (
            "You are an intelligent, helpful knowledge assistant parsing a user's personal notes.\n"
            "Your goal is to answer the user's question directly based on the provided note excerpts.\n\n"
            "Guidelines:\n"
            "- Be concise and get straight to the point. Avoid generic filler.\n"
            "- Use rich markdown formatting (e.g., **bolding** for emphasis, bullet points for lists) to make your answer easy to read.\n"
            "- If the provided excerpts do not contain the answer, politely state that you cannot find the information in their notes.\n"
            "- Do not hallucinate or make up information outside of the excerpts.\n\n"
            f"User question: {request.query}\n\n"
            f"Relevant note excerpts:\n{context}\n\n"
            "Answer:"
        )

        response = gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
        answer = response.text.strip()

        return SemanticSearchResponse(answer=answer, sourceNoteIds=source_note_ids)

    except Exception as e:
        print(f"Semantic search error: {e}")
        raise HTTPException(status_code=500, detail=f"Semantic search failed: {e}")


# Migration: Re-embed All Notes
# Called by the Node migration script to re-embed all of a user's notes.
@app.post("/re-embed-all")
async def re_embed_all(request: ReEmbedAllRequest):
    if qdrant_client is None or gemini_client is None:
        raise HTTPException(status_code=503, detail="Vector store not available.")

    try:
        qdrant_client.delete(
            collection_name=COLLECTION_NAME,
            points_selector=FilterSelector(
                filter=Filter(must=[FieldCondition(key="userId", match=MatchValue(value=request.userId))])
            ),
        )
    except Exception as e:
        print(f"Warning — could not clear old chunks for user {request.userId}: {e}")

    all_chunks = []
    all_embeddings = []
    point_metadata = []

    for note in request.notes:
        note_id = str(note.get("_id", ""))
        title = note.get("title", "")
        content = note.get("content", "")
        
        # Compose the embeddable text — same logic as triggerEmbed in Express
        embed_text = content
        if note.get("isChecklist") and note.get("checklist") and len(note.get("checklist")) > 0:
            checklist_str = "\n".join([f"- [{'x' if item.get('completed') else ' '}] {item.get('text')}" for item in note.get("checklist")])
            embed_text = f"{embed_text}\n\n{checklist_str}" if embed_text else checklist_str

        # Skip notes with no content and no title
        if not embed_text.strip() and not title.strip():
            continue

        # use title as fallback if content is blank
        if not embed_text.strip():
            embed_text = title

        chunks = chunk_text(embed_text)
        prefix = f"Note Title: {title}\n---\n" if title else ""
        
        for i, c in enumerate(chunks):
            all_chunks.append(c)
            all_embeddings.append(f"{prefix}{c}")
            point_metadata.append({
                "noteId": note_id,
                "userId": request.userId,
                "chunkIndex": i,
                "title": title,
            })

    if not all_embeddings:
        return {"status": "ok", "success": 0, "failed": 0}

    # Embed in batches to stay within API rate limits
    try:
        vectors = []
        BATCH_SIZE = 100
        for i in range(0, len(all_embeddings), BATCH_SIZE):
            batch = all_embeddings[i:i + BATCH_SIZE]
            result = gemini_client.models.embed_content(
                model=EMBEDDING_MODEL,
                contents=batch,
                config=types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIM),
            )
            vectors.extend([list(e.values) for e in result.embeddings])
        success = len([n for n in request.notes if str(n.get("_id", ""))])
        failed = 0
    except Exception as e:
        print(f"Batch embedding failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to batch embed: {e}")

    points = [
        PointStruct(
            id=chunk_point_id(point_metadata[i]["noteId"], point_metadata[i]["chunkIndex"]),
            vector=vectors[i],
            payload={
                "noteId": point_metadata[i]["noteId"],
                "userId": point_metadata[i]["userId"],
                "chunkIndex": point_metadata[i]["chunkIndex"],
                "title": point_metadata[i]["title"],
                "text": all_chunks[i],
            },
        )
        for i in range(len(all_chunks))
    ]

    try:
        qdrant_client.upsert(collection_name=COLLECTION_NAME, points=points)
    except Exception as e:
        print(f"Batch Qdrant upsert error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to store batch embeddings: {e}")

    return {"status": "ok", "success": success, "failed": failed}


if __name__ == "__main__":
    if "PORT" in os.environ:
        uvicorn.run(app, host="0.0.0.0", port=int(os.environ["PORT"]))
    else:
        uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)