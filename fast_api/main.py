import os
import uvicorn
from google import genai
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="Quill AI Microservice",
    description="AI summarization and semantic search service for Quill.",
    version="2.0.0",
)

# gemini setup
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
client = None

if GEMINI_API_KEY:
    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
    except Exception as e:
        print(f"Warning: Failed to initialize Gemini client: {e}")
else:
    print("Warning: GEMINI_API_KEY not set. AI endpoints will be unavailable.")


# request/response schemas
class SummarizeRequest(BaseModel):
    text: str

class SummarizeResponse(BaseModel):
    summary: str


# health
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
    if client is None:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY missing")

    prompt = (
        "Summarize the following text concisely. "
        "Keep the summary to 3-4 lines, focusing on the main points.\n\n"
        f"{text}\n\nSummary:"
    )

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        summary = response.text.strip()

        if not summary:
            raise HTTPException(status_code=500, detail="Gemini returned an empty response.")

        return {"summary": summary}

    except Exception as e:
        print(f"Gemini summarization error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to summarize: {e}")

if __name__ == "__main__":
    if "PORT" in os.environ:
        uvicorn.run(app, host="0.0.0.0", port=int(os.environ["PORT"]))
    else:
        uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)