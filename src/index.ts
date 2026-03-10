import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import swaggerUi from "swagger-ui-express";
import { query, initDB } from "./db";
import { identifyContact } from "./identify";
import { IdentifyRequest } from "./types";
import { swaggerSpec } from "./swagger";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ─── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());

// ─── Swagger UI ─────────────────────────────────────────────────────────────────
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "Bitespeed Identity API Docs",
}));

// ─── Routes ─────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check
 *     description: Returns the health status of the service and database connectivity.
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 db:
 *                   type: string
 *                   example: connected
 *       500:
 *         description: Database connection error
 */
app.get("/health", async (_req: Request, res: Response) => {
  try {
    await query("SELECT 1");
    res.status(200).json({ status: "ok", db: "connected" });
  } catch {
    res.status(500).json({ status: "ok", db: "error" });
  }
});

/**
 * @swagger
 * /identify:
 *   post:
 *     summary: Identify and reconcile a contact
 *     description: |
 *       Receives an email and/or phone number and returns a consolidated contact identity.
 *       - If no existing contact matches, a new primary contact is created.
 *       - If a match is found with new information, a secondary contact is created.
 *       - If the request links two separate primary contacts, the newer one is demoted to secondary.
 *     tags: [Identity]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 nullable: true
 *                 example: lorraine@hillvalley.edu
 *               phoneNumber:
 *                 type: string
 *                 nullable: true
 *                 example: "123456"
 *           examples:
 *             newContact:
 *               summary: New contact
 *               value:
 *                 email: lorraine@hillvalley.edu
 *                 phoneNumber: "123456"
 *             emailOnly:
 *               summary: Email only
 *               value:
 *                 email: mcfly@hillvalley.edu
 *             phoneOnly:
 *               summary: Phone only
 *               value:
 *                 phoneNumber: "123456"
 *             linkTwoContacts:
 *               summary: Link two existing contacts
 *               value:
 *                 email: george@hillvalley.edu
 *                 phoneNumber: "123456"
 *     responses:
 *       200:
 *         description: Consolidated contact identity
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contact:
 *                   type: object
 *                   properties:
 *                     primaryContatctId:
 *                       type: integer
 *                       example: 1
 *                     emails:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["lorraine@hillvalley.edu", "mcfly@hillvalley.edu"]
 *                     phoneNumbers:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["123456"]
 *                     secondaryContactIds:
 *                       type: array
 *                       items:
 *                         type: integer
 *                       example: [23]
 *       400:
 *         description: Validation error — at least one of email or phoneNumber is required
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: At least one of email or phoneNumber is required
 */
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
      console.log(`📚 Swagger docs at http://localhost:${PORT}/api-docs`);
    });
  } catch (err) {
    console.error("❌ Failed to initialise database:", err);
    process.exit(1);
  }
})();

export default app;
