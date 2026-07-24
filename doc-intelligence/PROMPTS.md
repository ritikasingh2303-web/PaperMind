# Prompts Used in This Project

This project used two distinct prompts, serving two different purposes —
worth separating clearly in a project report.

## 1. Build-time prompt (given to an AI coding assistant to scaffold the app)

```
Build a full-stack AI web application called "Doc Intelligence" — a Document
Analyzer that lets a user upload a PDF or paste raw text and receive
structured, AI-generated insights rendered live in a multi-panel dashboard.

FUNCTIONAL REQUIREMENTS:
1. Input: user can either upload a PDF file or paste plain text into a textarea.
2. On submit, extract text from the PDF (if uploaded) on the backend.
3. Send the extracted/pasted text to an LLM (Anthropic Claude API) with a
   single structured prompt that returns JSON with these fields:
   - summary (3-4 sentence overview)
   - key_points (bullet list of 4-6 main ideas)
   - tone (one-word tone/sentiment assessment + 1 sentence justification)
   - suggested_rewrite (a tightened/improved version of the opening paragraph)
   - action_items (if the doc implies any tasks/next steps; empty list if none)
4. Stream the LLM response to the frontend so panels populate progressively
   rather than waiting for the full response.
5. Render each field as its own styled card/panel in a dashboard layout
   (Summary card, Key Points card, Tone card, Rewrite card, Action Items card).

TECHNICAL REQUIREMENTS:
- Frontend: HTML/CSS/JavaScript (or React), responsive for desktop and mobile,
  clean dashboard-style UI with a loading/streaming state per panel.
- Backend: Python FastAPI. Single endpoint (e.g. POST /analyze) that:
  - Accepts multipart file upload OR raw text
  - Extracts PDF text server-side using pdfplumber or pypdf
  - Calls the Claude API with streaming enabled
  - Streams parsed JSON fragments back to the client (SSE or chunked response)
- API key must be read from an environment variable (never hardcoded, never
  sent to frontend, never committed to version control).
- Include a .env.example file and .gitignore excluding .env.
- Include a Dockerfile that packages frontend + backend into a single
  container, exposing one port.
- Include a requirements.txt with pinned versions.

DELIVERABLE STRUCTURE:
- /backend (FastAPI app, PDF extraction logic, LLM prompt/call logic)
- /frontend (static HTML/CSS/JS or React build)
- Dockerfile
- README.md explaining setup, env vars, and how to run locally and in Docker

Prioritize clean separation of concerns, secure handling of credentials, and
a UI that clearly demonstrates real-time/streaming behavior rather than a
single blocking response.
```

## 2. Runtime system prompt (sent to Claude on every `/analyze` call)

```
You are a document analysis engine embedded in a web application called
"Doc Intelligence." You receive raw text extracted from a user-uploaded
PDF or pasted directly by the user. Your job is to analyze it and return
ONLY a valid JSON object — no preamble, no markdown code fences, no
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
    "Return an empty array [] if none are present — do not invent action items."
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
- Keep "summary" and "tone.justification" free of jargon — write for a
  general audience.
- If the document contains sensitive personal data (SSNs, medical records,
  financial account numbers), do not reproduce those values anywhere in
  your output — reference their presence generically instead (e.g.
  "contains personal identifiers") if relevant to the analysis.
```

## Why two prompts

- The **build prompt** drives the AI-assisted development process — it
  produced the application's code structure.
- The **runtime prompt** is a permanent part of the shipped application —
  it runs every time a real user analyzes a document, and is what actually
  gives the product its behavior (strict JSON, no hallucinated action
  items, graceful handling of short/unclear input, and a basic data-privacy
  rule about not echoing sensitive identifiers).

Documenting both shows the distinction between using AI to *build* a
product and using AI *inside* the product.
