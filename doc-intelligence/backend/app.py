import json
import os
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import httpx
import pdfplumber
import io

app = FastAPI(title="Doc Intelligence API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite")
GEMINI_STREAM_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:streamGenerateContent"
)

SYSTEM_PROMPT = """You are a document analysis engine embedded in a web application called
"Doc Intelligence." You receive raw text extracted from a user-uploaded
PDF or pasted directly by the user. Your job is to analyze it and return
ONLY a valid JSON object - no preamble, no markdown code fences, no
explanation before or after.

Analyze the input text and return JSON in exactly this structure:

{
  "summary": "A 3-4 sentence plain-language overview of what the document is about and its main purpose.",
  "key_points": [
    "First key idea, stated concisely",
    "Second key idea",
    "3-6 total points depending on document length/density"
  ],
  "tone": {
    "label": "One word describing overall tone (e.g. Formal, Persuasive, Neutral, Urgent, Optimistic)",
    "justification": "One sentence explaining why you assigned this tone label, referencing something specific in the text."
  },
  "suggested_rewrite": "A tightened, clearer rewrite of the document's opening paragraph (or first 2-3 sentences if no clear paragraph structure). Preserve original meaning; improve clarity and flow.",
  "action_items": [
    "Only include if the document implies tasks, next steps, deadlines, or decisions.",
    "Return an empty array [] if none are present - do not invent action items."
  ]
}

RULES:
- Base every field strictly on the provided text. Do not add outside
  knowledge, opinions, or assumptions not supported by the document.
- If the text is too short or unclear to analyze meaningfully (e.g. under
  20 words, gibberish, or empty), return:
  {"error": "Insufficient text to analyze. Please provide a longer document or more detailed input."}
- Never wrap the JSON in ```json code fences or any other formatting.
- Never include commentary, disclaimers, or meta-notes outside the JSON object.
- Keep "summary" and "tone.justification" free of jargon - write for a
  general audience.
- If the document contains sensitive personal data (SSNs, medical records,
  financial account numbers), do not reproduce those values anywhere in
  your output - reference their presence generically instead (e.g.
  "contains personal identifiers") if relevant to the analysis.
"""


def extract_pdf_text(file_bytes: bytes) -> str:
    text_parts = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
    return "\n".join(text_parts)


def event(payload: dict) -> str:
    """Format a single Server-Sent Event chunk."""
    return f"data: {json.dumps(payload)}\n\n"


async def stream_analysis(document_text: str):
    """Generator that calls Gemini with streaming and yields SSE chunks.

    Two-phase streaming:
      1. "delta" events forward raw model tokens as they arrive, so the UI
         can show a live, progressively-growing raw feed (this is what
         satisfies real-time rendering rather than a blocking wait).
      2. Once the full response is in, it's parsed as JSON and each field
         is emitted as a "field" event so the frontend can snap the raw
         feed into clean, structured panels.

    Gemini's streamGenerateContent endpoint (with alt=sse) returns a
    stream of `data: {...}` lines, each wrapping a partial response object
    of the form {"candidates":[{"content":{"parts":[{"text": "..."}]}}]}.
    We pull the text delta out of each chunk and forward it the same way
    the frontend already expects.
    """
    if not GEMINI_API_KEY:
        yield event({"type": "error", "message": "Server is missing GEMINI_API_KEY."})
        return

    buffer = ""

    request_body = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": document_text}]}],
        "generationConfig": {
            "response_mime_type": "application/json",
            "temperature": 0.4,
            "maxOutputTokens": 2000,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as http_client:
            async with http_client.stream(
                "POST",
                GEMINI_STREAM_URL,
                params={"key": GEMINI_API_KEY, "alt": "sse"},
                json=request_body,
            ) as response:
                if response.status_code != 200:
                    error_bytes = await response.aread()
                    yield event({
                        "type": "error",
                        "message": f"AI service error ({response.status_code}): {error_bytes.decode(errors='ignore')[:300]}",
                    })
                    return

                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[len("data:"):].strip()
                    if not raw:
                        continue
                    try:
                        chunk = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    text_piece = _extract_text(chunk)
                    if text_piece:
                        buffer += text_piece
                        yield event({"type": "delta", "text": text_piece})

        try:
            final = json.loads(buffer)
        except json.JSONDecodeError:
            yield event({"type": "error", "message": "Model returned malformed output. Please try again."})
            return

        if "error" in final:
            yield event({"type": "error", "message": final["error"]})
            return

        for key, value in final.items():
            yield event({"type": "field", "key": key, "value": value})

        yield event({"type": "done"})

    except httpx.HTTPError as e:
        yield event({"type": "error", "message": f"AI service error: {str(e)}"})


def _extract_text(chunk: dict) -> str:
    """Pull the text delta out of one Gemini streaming chunk, if present."""
    try:
        candidates = chunk.get("candidates", [])
        if not candidates:
            return ""
        parts = candidates[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts)
    except (AttributeError, IndexError, TypeError):
        return ""


@app.post("/analyze")
async def analyze(
    text: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
):
    document_text = ""

    if file is not None:
        if file.content_type != "application/pdf":
            raise HTTPException(status_code=400, detail="Only PDF files are supported for upload.")
        file_bytes = await file.read()
        try:
            document_text = extract_pdf_text(file_bytes)
        except Exception:
            raise HTTPException(status_code=400, detail="Could not read PDF. It may be scanned/image-only or corrupted.")
    elif text:
        document_text = text.strip()

    if not document_text or len(document_text.split()) < 5:
        raise HTTPException(status_code=400, detail="Please provide more text or a readable PDF to analyze.")

    # Truncate very long documents to keep latency reasonable for a demo.
    if len(document_text) > 15000:
        document_text = document_text[:15000]

    return StreamingResponse(
        stream_analysis(document_text),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL, "api_key_configured": bool(GEMINI_API_KEY)}


# Serve the frontend as static files (single-container deployment)
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
