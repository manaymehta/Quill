import os
import uuid
import uvicorn
from contextlib import asynccontextmanager
from google import genai
from google.genai import types 
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# constants and clients and type declarations
COLLECTION_NAME = "notes"
EMBEDDING_DIM = 768
EMBEDDING_MODEL = "gemini-embedding-001"
GEMINI_MODEL = "gemma-3-27b-it"
gemini_client: genai.Client | None = None
qdrant_client: QdrantClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    # clients initialized at startup, cleaned up at shutdown
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

    # qdrant
    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_key = os.getenv("QDRANT_API_KEY")
    if qdrant_url:
        try:
            qdrant_client = QdrantClient(url=qdrant_url, api_key=qdrant_key)
           
            existing = [c.name for c in qdrant_client.get_collections().collections]
            if COLLECTION_NAME not in existing:  # create collection if it doesn't exist yet
                qdrant_client.create_collection(
                    collection_name=COLLECTION_NAME,
                    vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
                )
                print(f"Qdrant collection '{COLLECTION_NAME}' created ({EMBEDDING_DIM} dims)")
            else:
                print(f"Qdrant collection '{COLLECTION_NAME}' found")
        except Exception as e:
            print(f"Qdrant init failed: {e}")
    else:
        print("QDRANT_URL not set")

    yield  # app starts here

    print("Shutting down Quill AI Microservice")


app = FastAPI(
    title="Quill AI Microservice",
    description="AI summarization and semantic search service for Quill.",
    version="2.0.0",
    lifespan=lifespan,
)

def note_id_to_uuid(note_id: str) -> str:
    # Qdrant doesn't accept MongoDB ObjectId, so we convert it to a UUID
    return str(uuid.uuid5(uuid.NAMESPACE_OID, note_id))


# schemas
class SummarizeRequest(BaseModel):
    text: str

class SummarizeResponse(BaseModel):
    summary: str

class EmbedNoteRequest(BaseModel): # title and content
    noteId: str
    userId: str
    text: str   

class SemanticSearchRequest(BaseModel): # question, user id and notes
    query: str
    userId: str
    notes: list[dict]  

class SemanticSearchResponse(BaseModel): # answer and note ids
    answer: str
    sourceNoteIds: list[str]


@app.get("/")
async def root():
    return {"message": "Quill AI Microservice is running."}

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.head("/health")
async def health_head():
    return Response(status_code=200)


# summarization
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
        "Summarize the following text concisely. "
        "Keep the summary to 3-4 lines, focusing on the main points."
        "Remove unwanted symbols and characters from the summary."
        "Remove any extra spaces and newlines."
        f"{text}\n\nSummary:"
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

@app.post("/embed-note")
async def embed_note(request: EmbedNoteRequest):
    # generate and update a vector embedding for a note, if embedding for a note doesnt exist create it, called by Express after every note create/edit.
    if qdrant_client is None or gemini_client is None:
        raise HTTPException(status_code=503, detail="Vector store not available.")

    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required for embedding.")

    try:
        result = gemini_client.models.embed_content(model=EMBEDDING_MODEL, contents=text, config=types.EmbedContentConfig(
        output_dimensionality=EMBEDDING_DIM)) 
        vector = result.embeddings[0].values  # 768-dim float list
        qdrant_client.upsert( # update or insert
            collection_name=COLLECTION_NAME,
            points=[PointStruct(    # pointstruct is a class that is used to create a point in Qdrant
                id=note_id_to_uuid(request.noteId),
                vector=vector,
                payload={"noteId": request.noteId, "userId": request.userId},  # mongodb ID and owner for isolating notes by user in cluster
            )],
        )
        return {"status": "ok", "noteId": request.noteId}
    except Exception as e:
        print(f"Embedding error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to embed note: {e}")


@app.delete("/delete-embedding/{note_id}")
async def delete_embedding(note_id: str):
    # when permanently deleted
    if qdrant_client is None:
        raise HTTPException(status_code=503, detail="Vector store not available.")
    try:
        qdrant_client.delete(
            collection_name=COLLECTION_NAME,
            points_selector=[note_id_to_uuid(note_id)],
        )
        return {"status": "ok", "noteId": note_id}
    except Exception as e:
        print(f"Delete embedding error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete embedding: {e}")


@app.post("/semantic-search", response_model=SemanticSearchResponse)
async def semantic_search(request: SemanticSearchRequest):
    if qdrant_client is None or gemini_client is None:
        raise HTTPException(status_code=503, detail="Vector store not available.")
    if gemini_client is None:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY missing.")
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    try:
        # embed query
        result = gemini_client.models.embed_content(model=EMBEDDING_MODEL, contents=request.query, config=types.EmbedContentConfig(
        output_dimensionality=EMBEDDING_DIM
    ))
        query_vector = result.embeddings[0].values  # 768-dim float list

        # search qdrant, filtered to current users notes as only one cluster is being used
        results = qdrant_client.query_points(
            collection_name=COLLECTION_NAME,
            query=query_vector,
            query_filter=Filter(
                must=[FieldCondition(key="userId", match=MatchValue(value=request.userId))]
            ),
            limit=5,
        )

        if not results.points:
            return SemanticSearchResponse(
                answer="I couldn't find any relevant notes for your question.",
                sourceNoteIds=[],
            )

        matched_ids = {r.payload["noteId"] for r in results.points if r.payload and "noteId" in r.payload}

        # filter full matched notes sent from express
        source_notes = [n for n in request.notes if str(n.get("_id", "")) in matched_ids]

        if not source_notes:
            return SemanticSearchResponse(
                answer="couldn't find any relevant notes",
                sourceNoteIds=list(matched_ids),
            )

        # context
        context_blocks = []
        for note in source_notes:
            block = f"Note Title: {note.get('title', 'Untitled')}\n{note.get('content', '')}"
            context_blocks.append(block)
        context = "\n\n---\n\n".join(context_blocks)

        prompt = (
            "You are a personal knowledge assistant. "
            "Answer the user's question using ONLY the notes provided below as your knowledge source. "
            "Be direct. If the notes don't contain a clear answer, say so honestly.\n\n"
            f"User question: {request.query}\n\n"
            f"Notes:\n{context}\n\n"
            "Answer:"
        )

        # generated response
        response = gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
        answer = response.text.strip()

        return SemanticSearchResponse(
            answer=answer,
            sourceNoteIds=[str(n.get("_id")) for n in source_notes],
        )

    except Exception as e:
        print(f"Semantic search error: {e}")
        raise HTTPException(status_code=500, detail=f"Semantic search failed: {e}")

if __name__ == "__main__":
    if "PORT" in os.environ:
        uvicorn.run(app, host="0.0.0.0", port=int(os.environ["PORT"]))
    else:
        uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)