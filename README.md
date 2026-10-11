# CloudPilot

CloudPilot is a cloud workflow automation platform designed for managing and executing infrastructure workflows using n8n and Supabase. It provides secure credential storage, workflow management, execution tracking, and a modern dashboard for monitoring cloud automations across multiple providers.

---

## 🏗️ Architecture

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

- **Application Database**: Supabase (Cloud PostgreSQL) for `user_workflows`, `user_credentials`, `executions`, `audit_logs`, `profiles`, `workflow_templates`.
- **Engine Database**: PostgreSQL Docker container (`cloudpilot-n8n-db`) dedicated to n8n engine state.

---

## 🚀 Getting Started

### 1. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Generate an encryption key:
```bash
npm run gen-key
```

### 2. Docker + n8n Setup
Start the n8n container and PostgreSQL database:
```bash
docker compose up -d
```
Check container status:
```bash
docker compose ps
```

Open [http://localhost:5678](http://localhost:5678) in your browser:
1. Complete n8n initial owner setup.
2. Go to **Settings** $\rightarrow$ **n8n API** $\rightarrow$ **Create API Key**.
3. Add `N8N_API_KEY=your_key_here` into your `.env` file.

### 3. Database Migration & Template Seeding
Apply `supabase/migrations/001_initial_schema.sql` in your Supabase SQL Editor.
Seed template marketplace workflows:
```bash
npm run seed
```

### 4. Run CloudPilot
```bash
npm run dev
```
Open [http://localhost:4000](http://localhost:4000) in your browser.

---

## 🛠️ Docker Management Commands

- **Start containers**: `docker compose up -d`
- **View container status**: `docker compose ps`
- **View n8n logs**: `docker compose logs -f n8n`
- **Stop containers (preserve data)**: `docker compose down`
- **Restart containers**: `docker compose restart`

> ⚠️ **Note**: Do not use `docker compose down -v` unless you intend to erase persistent n8n volume data.

---

## 🔍 Diagnostics

- Health check: `http://localhost:4000/api/health`
- n8n Diagnostics: `http://localhost:4000/api/n8n-debug`

For detailed Docker configuration guidelines, see [`docs/DOCKER_SETUP.md`](docs/DOCKER_SETUP.md).

---

## ⚡ Tech Stack

- **Frontend**: HTML5, Vanilla CSS, Modern JavaScript (ESM)
- **Backend**: Node.js, Express.js
- **Database**: Supabase (PostgreSQL) + RLS Policies
- **Workflow Engine**: n8n (Docker container)
- **Security**: AES-256-GCM encryption for credentials, Supabase Auth
