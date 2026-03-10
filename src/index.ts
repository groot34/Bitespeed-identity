import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import { query, initDB } from "./db";
import { identifyContact } from "./identify";
import { IdentifyRequest } from "./types";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ─── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());

// ─── Routes ─────────────────────────────────────────────────────────────────────

// Health check
app.get("/health", async (_req: Request, res: Response) => {
  try {
    await query("SELECT 1");
    res.status(200).json({ status: "ok", db: "connected" });
  } catch {
    res.status(500).json({ status: "ok", db: "error" });
  }
});

// Identity reconciliation
app.post("/identify", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, phoneNumber } = req.body as IdentifyRequest;

    // Validate — at least one field must be present
    if (
      (email === undefined || email === null) &&
      (phoneNumber === undefined || phoneNumber === null)
    ) {
      res.status(400).json({ error: "At least one of email or phoneNumber is required" });
      return;
    }

    const result = await identifyContact(email, phoneNumber);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// ─── Global error handler ───────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start server after DB init ─────────────────────────────────────────────────
(async () => {
  try {
    await initDB();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to initialise database:", err);
    process.exit(1);
  }
})();

export default app;
