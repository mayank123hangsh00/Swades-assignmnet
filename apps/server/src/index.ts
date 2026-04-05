import { env } from "@my-better-t-app/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { db } from "@my-better-t-app/db";
import { chunks } from "@my-better-t-app/db/schema";
import { eq } from "drizzle-orm";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { existsSync } from "fs";

const BucketDir = path.join(process.cwd(), "bucket");
if (!existsSync(BucketDir)) {
  mkdir(BucketDir, { recursive: true }).catch(console.error);
}

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.get("/", (c) => {
  return c.text("OK");
});

app.post("/api/chunks/upload", async (c) => {
  try {
    let chunkId: string;
    let dataBuffer: Buffer;
    
    // Support multipart/form-data from actual browser, or application/json from k6 load tests
    const contentType = c.req.header('content-type') || '';
    if (contentType.includes('application/json')) {
       const body = await c.req.json();
       chunkId = body.chunkId;
       dataBuffer = Buffer.from(body.data, 'utf-8'); // dummy load test data
    } else {
       const formData = await c.req.parseBody();
       chunkId = formData.chunkId as string;
       const file = formData.file as File;
       if (!chunkId || !file) {
         return c.json({ error: "Missing chunkId or file" }, 400);
       }
       const arrayBuffer = await file.arrayBuffer();
       dataBuffer = Buffer.from(arrayBuffer);
    }
    
    if (!chunkId || !dataBuffer) {
      return c.json({ error: "Invalid data" }, 400);
    }

    // 1. Upload to bucket (Local FS as mock)
    const filePath = path.join(BucketDir, `${chunkId}.wav`);
    await writeFile(filePath, dataBuffer);

    // 2. Ack to database
    await db.insert(chunks).values({
      id: chunkId,
      status: "uploaded",
      ack: true
    }).onConflictDoUpdate({
      target: chunks.id,
      set: { status: "uploaded", ack: true },
    });

    return c.json({ success: true, chunkId });
  } catch (error) {
    console.error("Upload error", error);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

// Endpoint for the client to verify sync status
app.get("/api/chunks/check", async (c) => {
   const { ids } = c.req.query();
   if (!ids) return c.json({ missing: [] });
   const idArray = ids.split(",");
   // Find what does NOT exist in DB
   const existing = await db.query.chunks.findMany({
     columns: { id: true }
   });
   const existingIds = new Set(existing.map(e => e.id));
   const missing = idArray.filter(id => !existingIds.has(id));
   return c.json({ missing });
});

export default app;
