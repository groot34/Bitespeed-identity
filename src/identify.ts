import { query, getClient } from "./db";
import { Contact, IdentifyResponse } from "./types";
import { PoolClient } from "pg";

// ─── Row → Contact mapper ──────────────────────────────────────────────────────
function rowToContact(row: Record<string, unknown>): Contact {
  return {
    id: row.id as number,
    phoneNumber: (row.phoneNumber ?? null) as string | null,
    email: (row.email ?? null) as string | null,
    linkedId: (row.linkedId ?? null) as number | null,
    linkPrecedence: row.linkPrecedence as "primary" | "secondary",
    createdAt: new Date(row.createdAt as string),
    updatedAt: new Date(row.updatedAt as string),
    deletedAt: row.deletedAt ? new Date(row.deletedAt as string) : null,
  };
}

// ─── Build consolidated response from a primary id ─────────────────────────────
async function buildResponse(
  primaryId: number,
  execQuery: (text: string, params?: (string | number | null | undefined)[]) => Promise<{ rows: Record<string, unknown>[] }>
): Promise<IdentifyResponse> {
  const { rows } = await execQuery(
    `SELECT * FROM contact
     WHERE (id = $1 OR "linkedId" = $1)
       AND "deletedAt" IS NULL
     ORDER BY "createdAt" ASC`,
    [primaryId]
  );

  const contacts = rows.map(rowToContact);

  const primary = contacts.find((c) => c.linkPrecedence === "primary")!;
  const secondaries = contacts.filter((c) => c.linkPrecedence === "secondary");

  // Unique, order-preserving arrays
  const emails: string[] = [];
  const phoneNumbers: string[] = [];

  for (const c of [primary, ...secondaries]) {
    if (c.email && !emails.includes(c.email)) emails.push(c.email);
    if (c.phoneNumber && !phoneNumbers.includes(c.phoneNumber)) phoneNumbers.push(c.phoneNumber);
  }

  return {
    contact: {
      primaryContatctId: primary.id,
      emails,
      phoneNumbers,
      secondaryContactIds: secondaries.map((s) => s.id),
    },
  };
}

// ─── Main identify logic ───────────────────────────────────────────────────────
export async function identifyContact(
  email: string | null | undefined,
  phoneNumber: string | null | undefined
): Promise<IdentifyResponse> {
  const emailVal = email ?? null;
  const phoneVal = phoneNumber ?? null;

  // ── Development: use a real transaction ──────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const client: PoolClient = await getClient();

    try {
      await client.query("BEGIN");

      // Step 1 — find all matching contacts
      const { rows: matchedRows } = await client.query(
        `SELECT * FROM contact
         WHERE ((email = $1 AND $1 IS NOT NULL)
            OR ("phoneNumber" = $2 AND $2 IS NOT NULL))
           AND "deletedAt" IS NULL`,
        [emailVal, phoneVal]
      );

      const matched = matchedRows.map((r: Record<string, unknown>) => rowToContact(r));

      // Step 2 — resolve each match to its primary
      const primaryMap = new Map<number, Contact>();

      for (const c of matched) {
        if (c.linkPrecedence === "primary") {
          primaryMap.set(c.id, c);
        } else if (c.linkedId !== null) {
          if (!primaryMap.has(c.linkedId)) {
            const { rows: pRows } = await client.query(
              `SELECT * FROM contact WHERE id = $1 AND "deletedAt" IS NULL`,
              [c.linkedId]
            );
            if (pRows.length > 0) {
              const p = rowToContact(pRows[0] as Record<string, unknown>);
              primaryMap.set(p.id, p);
            }
          }
        }
      }

      const primaries = Array.from(primaryMap.values());

      // ── Case 1: No matches ──────────────────────────────────────────────
      if (primaries.length === 0) {
        const { rows: newRows } = await client.query(
          `INSERT INTO contact ("phoneNumber", email, "linkedId", "linkPrecedence", "createdAt", "updatedAt")
           VALUES ($1, $2, NULL, 'primary', NOW(), NOW())
           RETURNING *`,
          [phoneVal, emailVal]
        );

        const newContact = rowToContact(newRows[0] as Record<string, unknown>);
        await client.query("COMMIT");

        return {
          contact: {
            primaryContatctId: newContact.id,
            emails: newContact.email ? [newContact.email] : [],
            phoneNumbers: newContact.phoneNumber ? [newContact.phoneNumber] : [],
            secondaryContactIds: [],
          },
        };
      }

      // ── Case 4: Two different primaries → merge ─────────────────────────
      if (primaries.length >= 2) {
        primaries.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        const keepPrimary = primaries[0];
        const demotedPrimaries = primaries.slice(1);

        for (const demoted of demotedPrimaries) {
          // Demote the younger primary to secondary
          await client.query(
            `UPDATE contact
             SET "linkPrecedence" = 'secondary', "linkedId" = $1, "updatedAt" = NOW()
             WHERE id = $2`,
            [keepPrimary.id, demoted.id]
          );

          // Re-link all secondaries of the demoted primary
          await client.query(
            `UPDATE contact
             SET "linkedId" = $1, "updatedAt" = NOW()
             WHERE "linkedId" = $2`,
            [keepPrimary.id, demoted.id]
          );
        }

        await client.query("COMMIT");

        // Build from the surviving primary using the shared query helper
        return buildResponse(keepPrimary.id, (text, params) =>
          client.query(text, params).then((r) => ({ rows: r.rows as Record<string, unknown>[] }))
        );
      }

      // Single primary cluster — gather full cluster info
      const thePrimary = primaries[0];

      // Fetch all contacts in this cluster
      const { rows: clusterRows } = await client.query(
        `SELECT * FROM contact
         WHERE (id = $1 OR "linkedId" = $1)
           AND "deletedAt" IS NULL`,
        [thePrimary.id]
      );

      const cluster = clusterRows.map((r: Record<string, unknown>) => rowToContact(r));

      const existingEmails = new Set(cluster.map((c) => c.email).filter(Boolean));
      const existingPhones = new Set(cluster.map((c) => c.phoneNumber).filter(Boolean));

      const emailIsNew = emailVal !== null && !existingEmails.has(emailVal);
      const phoneIsNew = phoneVal !== null && !existingPhones.has(phoneVal);

      // ── Case 2: No new info ─────────────────────────────────────────────
      if (!emailIsNew && !phoneIsNew) {
        await client.query("COMMIT");
        return buildResponse(thePrimary.id, (text, params) =>
          client.query(text, params).then((r) => ({ rows: r.rows as Record<string, unknown>[] }))
        );
      }

      // ── Case 3: New info → create secondary ────────────────────────────
      await client.query(
        `INSERT INTO contact ("phoneNumber", email, "linkedId", "linkPrecedence", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'secondary', NOW(), NOW())
         RETURNING *`,
        [phoneVal, emailVal, thePrimary.id]
      );

      await client.query("COMMIT");

      return buildResponse(thePrimary.id, (text, params) =>
        client.query(text, params).then((r) => ({ rows: r.rows as Record<string, unknown>[] }))
      );
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Production (NeonDB serverless): sequential operations ────────────────
  // Step 1 — find all matching contacts
  const { rows: matchedRows } = await query(
    `SELECT * FROM contact
     WHERE ((email = $1 AND $1 IS NOT NULL)
        OR ("phoneNumber" = $2 AND $2 IS NOT NULL))
       AND "deletedAt" IS NULL`,
    [emailVal, phoneVal]
  );

  const matched = (matchedRows as Record<string, unknown>[]).map(rowToContact);

  // Step 2 — resolve each match to its primary
  const primaryMap = new Map<number, Contact>();

  for (const c of matched) {
    if (c.linkPrecedence === "primary") {
      primaryMap.set(c.id, c);
    } else if (c.linkedId !== null) {
      if (!primaryMap.has(c.linkedId)) {
        const { rows: pRows } = await query(
          `SELECT * FROM contact WHERE id = $1 AND "deletedAt" IS NULL`,
          [c.linkedId]
        );
        if ((pRows as Record<string, unknown>[]).length > 0) {
          const p = rowToContact((pRows as Record<string, unknown>[])[0]);
          primaryMap.set(p.id, p);
        }
      }
    }
  }

  const primaries = Array.from(primaryMap.values());

  // Case 1: No matches
  if (primaries.length === 0) {
    const { rows: newRows } = await query(
      `INSERT INTO contact ("phoneNumber", email, "linkedId", "linkPrecedence", "createdAt", "updatedAt")
       VALUES ($1, $2, NULL, 'primary', NOW(), NOW())
       RETURNING *`,
      [phoneVal, emailVal]
    );

    const newContact = rowToContact((newRows as Record<string, unknown>[])[0]);

    return {
      contact: {
        primaryContatctId: newContact.id,
        emails: newContact.email ? [newContact.email] : [],
        phoneNumbers: newContact.phoneNumber ? [newContact.phoneNumber] : [],
        secondaryContactIds: [],
      },
    };
  }

  // Case 4: Two different primaries → merge
  if (primaries.length >= 2) {
    primaries.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const keepPrimary = primaries[0];
    const demotedPrimaries = primaries.slice(1);

    for (const demoted of demotedPrimaries) {
      await query(
        `UPDATE contact
         SET "linkPrecedence" = 'secondary', "linkedId" = $1, "updatedAt" = NOW()
         WHERE id = $2`,
        [keepPrimary.id, demoted.id]
      );

      await query(
        `UPDATE contact
         SET "linkedId" = $1, "updatedAt" = NOW()
         WHERE "linkedId" = $2`,
        [keepPrimary.id, demoted.id]
      );
    }

    return buildResponse(keepPrimary.id, query as (text: string, params?: (string | number | null | undefined)[]) => Promise<{ rows: Record<string, unknown>[] }>);
  }

  // Single primary cluster
  const thePrimary = primaries[0];

  const { rows: clusterRows } = await query(
    `SELECT * FROM contact
     WHERE (id = $1 OR "linkedId" = $1)
       AND "deletedAt" IS NULL`,
    [thePrimary.id]
  );

  const cluster = (clusterRows as Record<string, unknown>[]).map(rowToContact);

  const existingEmails = new Set(cluster.map((c) => c.email).filter(Boolean));
  const existingPhones = new Set(cluster.map((c) => c.phoneNumber).filter(Boolean));

  const emailIsNew = emailVal !== null && !existingEmails.has(emailVal);
  const phoneIsNew = phoneVal !== null && !existingPhones.has(phoneVal);

  // Case 2: No new info
  if (!emailIsNew && !phoneIsNew) {
    return buildResponse(thePrimary.id, query as (text: string, params?: (string | number | null | undefined)[]) => Promise<{ rows: Record<string, unknown>[] }>);
  }

  // Case 3: New info → create secondary
  await query(
    `INSERT INTO contact ("phoneNumber", email, "linkedId", "linkPrecedence", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'secondary', NOW(), NOW())
     RETURNING *`,
    [phoneVal, emailVal, thePrimary.id]
  );

  return buildResponse(thePrimary.id, query as (text: string, params?: (string | number | null | undefined)[]) => Promise<{ rows: Record<string, unknown>[] }>);
}
