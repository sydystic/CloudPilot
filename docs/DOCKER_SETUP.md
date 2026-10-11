# CloudPilot — Docker & n8n Setup Guide

This guide covers setting up a reproducible development environment for **CloudPilot** using Docker and a local **n8n** automation container.

---

## 🏗️ Architecture Overview

```
┌───────────────┐
│    Browser    │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│  CloudPilot   │  Node/Express Host Process (Port 4000)
│ Node/Express  │  N8N_URL=http://localhost:5678
└──────┬────────┘
       │
┌──────┴──────────────┐
▼                     ▼
┌─────────────┐   ┌─────────────┐
│  Supabase   │   │     n8n     │  Docker Container (Port 5678)
│ PostgreSQL  │   │   Docker    │
└─────────────┘   └──────┬──────┘
                         │
                         ▼
                  ┌─────────────┐
                  │   n8n DB    │  Docker Container (Internal n8n state only)
                  │ PostgreSQL  │
                  └─────────────┘
```

### Critical Database Distinction
- **Supabase**: CloudPilot's primary application database (`user_workflows`, `user_credentials`, `executions`, `audit_logs`, `profiles`, `workflow_templates`).
- **n8n PostgreSQL Container (`cloudpilot-n8n-db`)**: Dedicated internal storage for n8n execution state and engine metadata **only**.
- **Do not mix or replace these databases.** Supabase is CloudPilot's application source of truth.

---

## 🚀 Quick Start Instructions

### Step 1: Start Docker Desktop
Ensure Docker Desktop is installed and running on your machine.

### Step 2: Launch n8n with Docker Compose
Start the n8n container and its PostgreSQL database:
```bash
docker compose up -d
```

Check running container status:
```bash
docker compose ps
```
You should see:
- `cloudpilot-n8n-db` (healthy)
- `n8n` (healthy)

### Step 3: First-Time n8n Setup & API Key Generation
1. Open your browser and navigate to: [http://localhost:5678](http://localhost:5678)
2. Complete the initial n8n owner setup (Name, Email, Password).
3. In n8n, navigate to **Settings** (bottom-left gear icon) $\rightarrow$ **n8n API**.
4. Click **Create API Key**, enter a label (e.g., `CloudPilot Key`), and copy the generated key.

### Step 4: Configure CloudPilot `.env`
Open your `.env` file (or copy `.env.example` to `.env`) and set your API key:
```env
N8N_URL=http://localhost:5678
N8N_API_KEY=your_generated_n8n_api_key_here
N8N_CONTAINER_NAME=n8n
DEMO_MODE=false
```

### Step 5: Start CloudPilot
```bash
npm run dev
```

CloudPilot will automatically detect n8n, connect using the `X-N8N-API-KEY` header, and sync workflows.

---

## 🛠️ Docker Management Commands

| Action | Command | Notes |
| :--- | :--- | :--- |
| **Start containers** | `docker compose up -d` | Runs in background |
| **Check container status** | `docker compose ps` | Shows status & healthchecks |
| **View n8n container logs** | `docker compose logs -f n8n` | Press Ctrl+C to exit log tail |
| **View database logs** | `docker compose logs -f n8n-db` | Tails PostgreSQL logs |
| **Restart containers** | `docker compose restart` | Restarts n8n without data loss |
| **Stop containers** | `docker compose down` | Preserves persistent volume data |

> ⚠️ **WARNING**: Do **NOT** use `docker compose down -v` unless you intentionally want to wipe all n8n workflows and database volumes! Standard `docker compose down` keeps volume data safe.

---

## 🔍 Diagnostic & Connectivity Verification

### 1. Verify n8n Web & Health Endpoint
Open terminal and test:
```bash
curl -I http://localhost:5678/healthz
```
Expected output: `HTTP/1.1 200 OK`

### 2. Verify CloudPilot n8n Connection
With CloudPilot running (`npm run dev`), test:
```bash
curl http://localhost:4000/api/health
```
Expected response:
```json
{
  "status": "healthy",
  "services": {
    "n8n": "connected",
    "supabase": "configured"
  }
}
```

### 3. Deep n8n Diagnostics
Run CloudPilot's diagnostic endpoint:
```bash
curl http://localhost:4000/api/n8n-debug
```
This tests n8n public API endpoints (`/api/v1/workflows`), docker execution capability, and key previews.

---

## 🐳 Containerized Backend Option (`docker-compose.full.yml`)

If you want to run the **CloudPilot Express backend** inside Docker alongside n8n:

```bash
docker compose -f docker-compose.full.yml up -d
```

### Container-to-Container Network Rule:
When CloudPilot runs inside a Docker container, it communicates with n8n via Docker's internal DNS using the service name `n8n`:
```env
# Inside Docker container:
N8N_URL=http://n8n:5678

# On Host machine:
N8N_URL=http://localhost:5678
```
