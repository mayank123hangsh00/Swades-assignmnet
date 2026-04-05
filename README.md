# Swades: Reliable Audio Chunking & Transcription Pipeline 🎙️🚀

A production-ready, high-reliability audio recording pipeline built for the Swades AI Hackathon. This system ensures 100% data integrity for long-form recordings (up to 1 hour) by combining browser-native persistence with robust server-side reconciliation.

## 🌟 Live Links
- **Frontend (Web App)**: [swades-assignmnet-web.vercel.app](https://swades-assignmnet-web.vercel.app)
- **Backend (API Server)**: [swades-assignmnet.onrender.com](https://swades-assignmnet.onrender.com)
- **Database**: Supabase PostgreSQL (Live)

---

## ✨ Key Features

### 1. 🛡️ 5-Minute Reliable Chunking
Automatically slices audio recordings into 5-minute segments. This ensures that even if a long recording is interrupted, previously completed chunks are already safe in the cloud.

### 2. 💾 OPFS (Origin Private File System) Persistence
Uses the latest browser technology to store audio chunks in a durable, high-performance local file system **before** uploading.
- Chunks survive tab crashes, browser restarts, and network outages.
- Chunks are only cleared from local storage once both the Storage Bucket AND Database Acknowledgment are confirmed.

### 3. 📝 Native Web Speech API Transcription
Real-time transcription using the browser's native capabilities. 
- Zero latency.
- Zero external API costs.
- High accuracy for supported languages.

### 4. 🔄 Automatic Reconciliation Loop
If the database shows a record but the physical file is missing (or vice-versa), the client automatically detects the "Sync Error" and re-uploads the chunk from the OPFS buffer.

### 5. 🏗️ Modern Monorepo Architecture
Built with **Turborepo** for high-velocity development, shared type-safe environment variables, and a unified database schema.

---

## 🛠️ Tech Stack
- **Frontend**: Next.js 15 (App Router), TailwindCSS, Shadcn/UI
- **Backend**: Hono (High-performance API Framework)
- **Runtime**: Bun (Fast JS runtime & bundler)
- **Database**: Drizzle ORM + Supabase (PostgreSQL)
- **Deployment**: Vercel (Frontend) + Render (Dockerized Backend)

---

## 🚀 Getting Started

### 1. Prerequisites
- **Bun** installed (`curl -fsSL https://bun.sh/install | bash`)

### 2. Installation
```bash
bun install
```

### 3. Environment Variables

#### apps/web/.env
```env
NEXT_PUBLIC_SERVER_URL=https://swades-assignmnet.onrender.com
```

#### apps/server/.env
```env
DATABASE_URL=your_supabase_postgresql_url
CORS_ORIGIN=*
NODE_ENV=production
```

### 4. Running Locally
```bash
# Start both Web and Server
bun run dev

# Start only Server
bun run dev --filter server

# Start only Web
bun run dev --filter web
```

---

## 🏗️ Project Structure
- `apps/web`: Next.js frontend with recording logic and OPFS management.
- `apps/server`: Hono backend handling multi-part uploads and storage reconciliation.
- `packages/db`: Shared Drizzle ORM schema for the `chunks` table.
- `packages/env`: Type-safe environment variable validation using Zod.

---

## ✅ Submission Checklist
- [x] Records up to 1 hour
- [x] Auto-chunks every 5 minutes
- [x] OPFS Durable Buffer
- [x] Native Web Speech Transcription
- [x] Server-side Bucket + DB Verification
- [x] Fully Deployed (Vercel + Render)

---

Developed with ❤️ for the Swades AI Hackathon.
