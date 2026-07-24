# PaperMind — AI-Powered Document Intelligence

An AI-powered document analyzer. Paste text or upload a PDF and get a
structured, streaming breakdown: summary, tone, key points, action items,
and a tightened rewrite of the opening — rendered live as the model responds.

## Stack

- **Frontend:** vanilla HTML/CSS/JS, no build step
- **Backend:** FastAPI (Python), streams responses via Server-Sent Events
- **AI:** Google Gemini API (free tier, no credit card required)
- **PDF parsing:** pdfplumber
- **Deployment:** Docker → AWS App Runner (or Elastic Beanstalk)

## Project structure

```
doc-intelligence/
├── backend/
│   ├── app.py            # FastAPI app, PDF extraction, streaming LLM call
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── Dockerfile
├── .env.example
└── .gitignore
```

## Get a free API key

1. Go to https://aistudio.google.com/apikey
2. Sign in with a Google account
3. Click **Create API key** — no credit card needed
4. Copy the key

## Run locally (no Docker)

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

export GEMINI_API_KEY=your_key_here   # Windows (PowerShell): $env:GEMINI_API_KEY="your_key_here"
uvicorn app:app --reload --port 8000
```

Open `http://localhost:8000` in your browser.

## Run with Docker

```bash
docker build -t doc-intelligence .
docker run -p 8000:8000 --env-file .env doc-intelligence
```

(Copy `.env.example` to `.env` and fill in your real key first — `.env` is
git-ignored and never baked into the image.)

Open `http://localhost:8000`.

## Deploying to AWS App Runner

1. Push the image to Amazon ECR:
   ```bash
   aws ecr create-repository --repository-name doc-intelligence
   aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com
   docker tag doc-intelligence:latest <account-id>.dkr.ecr.<region>.amazonaws.com/doc-intelligence:latest
   docker push <account-id>.dkr.ecr.<region>.amazonaws.com/doc-intelligence:latest
   ```
2. In the AWS Console, create an **App Runner** service pointing at that ECR image.
3. Under **Configuration → Environment variables**, add `GEMINI_API_KEY`
   (and `GEMINI_MODEL` if you want to override the default). Never put
   the key in the Dockerfile or in source control.
4. Deploy. App Runner gives you a public HTTPS URL automatically.

## Security notes

- The API key lives only in the environment (`.env` locally, App Runner
  environment variables in the cloud) — it is never present in frontend
  code, never logged, and never committed.
- `.env` is excluded via `.gitignore`.
- The backend, not the browser, makes the call to the Gemini API, so
  the key never reaches the client.

## How the streaming works

The `/analyze` endpoint returns a `text/event-stream` response. Two kinds
of events are sent:

- `delta` — raw model tokens as they're generated, shown live in the
  "live model output" strip so the UI is visibly progressive rather than
  a blocking spinner.
- `field` — once the full JSON response is complete and parsed, each
  top-level field (`summary`, `tone`, `key_points`, `action_items`,
  `suggested_rewrite`) is emitted individually and animates into its own
  card.

## Prompts used

See `PROMPTS.md` for the build prompt and the runtime system prompt used
to drive the model's analysis — included here as part of the documented
AI-assisted development process.
