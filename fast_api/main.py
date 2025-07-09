# main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from groq import Groq
import uvicorn
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = FastAPI(
    title="Groq AI Summarization Microservice",
    description="A microservice to summarize text using Groq's LLM.",
    version="1.0.0",
)

# --- Groq Client Initialization ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY environment variable not set.")

groq_client = Groq(api_key=GROQ_API_KEY)

# Define the Groq model to use for summarization
GROQ_MODEL_NAME = "meta-llama/llama-4-scout-17b-16e-instruct"


class SummarizeRequest(BaseModel):
    text: str

class SummarizeResponse(BaseModel):
    summary: str

@app.get("/")
async def root():
    return {"message": "Welcome to the Groq FastAPI Summarization Microservice! Use /summarize for text summarization."}

@app.post("/summarize", response_model=SummarizeResponse)
async def summarize_text(request: SummarizeRequest):
    if not request.text or len(request.text.strip()) == 0:
        raise HTTPException(status_code=400, detail="Text content cannot be empty for summarization.")

    try:
        # --- MODIFIED PROMPT ENGINEERING ---
        # Explicitly instruct the model to summarize in 3 to 4 lines.
        # Adding a few-shot example (even a generic one) can sometimes help.
        prompt = f"""Summarize the following text concisely and accurately into 3 to 4 lines. Focus on the main points and key information.

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
            max_tokens=150,  # --- ADJUSTED max_tokens ---
                             # This is a general upper bound. 3-4 lines typically fit within 50-150 tokens.
                             # You might need to fine-tune this value based on your actual content and desired line length.
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
    port = int(os.environ.get("FASTAPI_PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)