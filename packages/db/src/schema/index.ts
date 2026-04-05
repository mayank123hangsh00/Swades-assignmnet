import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const chunks = pgTable("chunks", {
  id: text("id").primaryKey(),
  status: text("status", { enum: ["uploaded", "failed"] }).notNull().default("uploaded"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  ack: boolean("ack").default(true),
});
