# TranslationReviewer

A web app for reviewing AI-generated translations before they are shipped. Reviewers approve or correct suggested translations per language, and admins manage batches and collect results.

## Tech stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Backend:** Node.js + Express
- **Database:** Google Cloud Firestore

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```
# Backend port (default: 8787)
PORT=8787

# Comma-separated list of allowed frontend origins
CORS_ALLOWED_ORIGINS=http://localhost:5173

# Firebase service account key (raw JSON string)
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}

# Frontend API base URL (used at build time)
VITE_API_BASE_URL=http://localhost:8787
```

### 3. Run in development

Start both servers (in separate terminals):

```bash
npm run dev:api   # Backend on port 8787
npm run dev       # Frontend on port 5173
```

Open http://localhost:5173. The Vite dev server proxies `/api` requests to the backend automatically.

## Importing a batch

Batches are imported by an admin as a `.zip` file produced by the NIBE translator.

1. Click **Admin Mode** and enter the admin password
2. Under **Add Batch**, select your `.zip` file and click **Add Batch**

The zip must contain exactly three JSON files:

```
batch-6081.zip
├── french.json
├── spanish.json
└── german.json
```

Each file is an array of objects:

```json
[
    {
        "Panel-ID": "p10026",
        "Original text": "Inget v.märke",
        "suggested translation": "Aucune marque"
    }
]
```

All three files must have the same Panel-IDs, the same number of rows, and matching Original text values across languages.

## Reviewing translations

1. Select a language on the main screen and enter the language password
2. Pick a batch to review
3. For each translation card:
   - **Approve** — mark the suggested translation as correct
   - **Disapprove** — mark it as incorrect and enter a correction
4. Once all entries are reviewed, click **Submit**

Submitted batches can be reopened and modified.

### Passwords

| Role | Password |
|---|---|
| Admin | `nibe-admin` |
| French reviewer | `bonjour-review` |
| Spanish reviewer | `hola-review` |
| German reviewer | `hallo-review` |

Passwords are set in `src/app/App.tsx` and should be changed before deploying publicly.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start frontend dev server (port 5173) |
| `npm run dev:api` | Start backend dev server (port 8787) |
| `npm run build` | Production build |
| `npm run start:api` | Start backend in production |

## Firebase setup

The backend uses Firestore as its database. You need a Firebase project before you can run the app.

1. Go to the [Firebase Console](https://console.firebase.google.com) and create a project
2. In the project, go to **Firestore Database** → **Create database** (start in production mode)
3. Go to **Project settings** → **Service accounts** → **Generate new private key**
4. Download the JSON file — this is your service account key

**Locally:** paste the contents of the JSON file into your `.env`:
```
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
```

**On Render:** paste the same JSON string into the `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable in the Render dashboard.

If `FIREBASE_SERVICE_ACCOUNT_JSON` is not set, the backend falls back to [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials) (useful if running on Google Cloud infrastructure).



The app runs as two separately hosted services:

| Service | Platform | How |
|---|---|---|
| Frontend | GitHub Pages | Auto-deployed on push to `main` via GitHub Actions |
| Backend | Render | Configured via `render.yaml` (free plan) |

### Frontend (GitHub Pages)

Deployed automatically when you push to `main`. The workflow in `.github/workflows/deploy-pages.yml` builds the frontend and publishes the `dist/` folder.

The build requires the `VITE_API_BASE_URL` GitHub Actions variable to be set in the repository settings (Settings → Secrets and variables → Actions → Variables) pointing to the Render backend URL.

### Backend (Render)

Configured via `render.yaml`. Set the following environment variables in the Render dashboard:

| Variable | Description |
|---|---|
| `CORS_ALLOWED_ORIGINS` | The GitHub Pages URL (e.g. `https://your-org.github.io`) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase service account key as a raw JSON string |
