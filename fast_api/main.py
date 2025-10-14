# main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from groq import Groq
import uvicorn
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="Groq AI Summarization Microservice",
    description="A microservice to summarize text using Groq's LLM.",
    version="1.0.0",
)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY environment variable not set.")

groq_client = Groq(api_key=GROQ_API_KEY)

GROQ_MODEL_NAME = "llama-3.1-8b-instant"

class SummarizeRequest(BaseModel):
    text: str

class SummarizeResponse(BaseModel):
    summary: str

@app.get("/")
async def root():
    return {"message": "Welcome to the Groq FastAPI Summarization Microservice! Use /summarize-note for text summarization."}

@app.post("/summarize", response_model=SummarizeResponse)
async def summarize_text(request: SummarizeRequest):
    if not request.text or len(request.text.strip()) == 0:
        raise HTTPException(status_code=400, detail="Text content cannot be empty for summarization.")

    if len(request.text.strip()) < 50:
        return {"summary": "Too short to summarize."}

    try:
        prompt = f"""Summarize the following text concisely and accurately if large, depending on the size of the content keep it around 3 to 4 lines . Focus on the main points and key information.
Text to summarize:
---
{request.text}
---
Concise Summary (3-4 lines):"""

        chat_completion = groq_client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that summarizes text. Your primary goal is to provide summaries that are exactly 3 to 4 lines long, without saying Here is a concise summary of the text in 3-4 lines,  extracting the most important information."
                },
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            model=GROQ_MODEL_NAME,
            temperature=0.3, # Lower temperature makes the output more deterministic and less "creative"
            max_tokens=150,  # max_tokens 
                             # This is a general upper bound. 3-4 lines typically fit within 50-150 tokens.
                             # It's better to overestimate slightly than to cut off a summary mid-sentence.
        )

        summary_text = chat_completion.choices[0].message.content.strip()

        if not summary_text:
            raise HTTPException(status_code=500, detail="Groq API returned an empty summary.")

        return {"summary": summary_text}

    except Exception as e:
        print(f"Error during Groq summarization: {e}")
        if hasattr(e, 'response') and e.response:
            detail_message = f"Groq API Error: {e.response.status_code} - {e.response.text}"
        else:
            detail_message = f"Failed to summarize text: {e}"
        raise HTTPException(status_code=500, detail=detail_message)

if __name__ == "__main__":
    is_production = "PORT" in os.environ

    if is_production:
        # In production use the port provided by the environment
        port = int(os.environ.get("PORT"))
        uvicorn.run(app, host="0.0.0.0", port=port)
    else:
        # In development, run with reload on a fixed port
        uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)