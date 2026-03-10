# Bitespeed Identity Reconciliation Service

A backend service that links different contact details (email, phone number) of the same person into a single, consolidated identity. Built with **Node.js**, **TypeScript**, **Express**, and **PostgreSQL**.

---

## Table of Contents

- [Local Development Setup](#local-development-setup)
- [NeonDB Setup for Production](#neondb-setup-for-production)
- [Deploying to Render.com](#deploying-to-rendercom)
- [API Documentation (Swagger)](#api-documentation-swagger)
- [API Endpoints](#api-endpoints)
- [Example curl Requests](#example-curl-requests)
- [Hosted Endpoint](#hosted-endpoint)

---

## Local Development Setup

1. **Clone the repo**
   ```bash
   git clone <your-repo-url>
   cd bitespeed-identity
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create `.env` from `.env.example`**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set your local PostgreSQL credentials:
   ```
   DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/bitespeed
   NODE_ENV=development
   PORT=3000
   ```

4. **Create the local PostgreSQL database**
   ```bash
   createdb bitespeed
   ```

5. **Start the dev server**
   ```bash
   npm run dev
   ```

6. The server starts at **http://localhost:3000**. The `contact` table and indexes are created automatically on startup.

---

## NeonDB Setup for Production

1. Go to [neon.tech](https://neon.tech) and create a free project.
2. Copy the connection string from the Neon dashboard (looks like `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require`).
3. Set `DATABASE_URL` to the NeonDB connection string.
4. Set `NODE_ENV=production`.

---

## Deploying to Render.com

1. Push your code to **GitHub**.
2. Create a new **Web Service** on [Render](https://render.com).
3. Set the **Build Command**:
   ```
   npm install && npm run build
   ```
4. Set the **Start Command**:
   ```
   npm start
   ```
5. Add **Environment Variables**:
   | Variable       | Value                          |
   | -------------- | ------------------------------ |
   | `DATABASE_URL` | Your NeonDB connection string  |
   | `NODE_ENV`     | `production`                   |
6. Click **Deploy**.

---

## API Documentation (Swagger)

This project includes interactive API documentation powered by **Swagger UI**.

Once the server is running, open your browser and navigate to:

```
http://localhost:3000/api-docs
```

From the Swagger UI you can:
- View full request/response schemas for every endpoint
- Try out API calls directly from the browser using the **"Try it out"** button
- Switch between multiple request examples (new contact, email-only, phone-only, merge)

---

## API Endpoints

### `GET /health`

Returns the health status of the service and database connection.

**Response 200:**
```json
{ "status": "ok", "db": "connected" }
```

**Response 500 (DB unreachable):**
```json
{ "status": "ok", "db": "error" }
```

### `POST /identify`

Accepts a JSON body with at least one of `email` or `phoneNumber` and returns a consolidated identity.

**Request:**
```json
{
  "email": "string (optional)",
  "phoneNumber": "string (optional)"
}
```

**Response 200:**
```json
{
  "contact": {
    "primaryContatctId": 1,
    "emails": ["primary@email.com", "secondary@email.com"],
    "phoneNumbers": ["123456", "789012"],
    "secondaryContactIds": [2, 3]
  }
}
```

**Response 400:**
```json
{ "error": "At least one of email or phoneNumber is required" }
```

---

## Example curl Requests

### Case 1 — New contact (no prior records)

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "lorraine@hillvalley.edu", "phoneNumber": "123456"}'
```

### Case 2 — Existing contact, no new info

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "lorraine@hillvalley.edu", "phoneNumber": "123456"}'
```

### Case 3 — New info, creates a secondary contact

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "mcfly@hillvalley.edu", "phoneNumber": "123456"}'
```

### Case 4 — Two primaries get merged

First create a separate primary:
```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "george@hillvalley.edu", "phoneNumber": "717171"}'
```

Then link them:
```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "george@hillvalley.edu", "phoneNumber": "123456"}'
```

---

## Hosted Endpoint

```
https://your-app.onrender.com/identify
```

---

## Tech Stack

| Layer      | Technology                              |
| ---------- | --------------------------------------- |
| Runtime    | Node.js                                 |
| Language   | TypeScript (strict mode)                |
| Framework  | Express.js                              |
| DB (dev)   | PostgreSQL via `pg`                     |
| DB (prod)  | NeonDB via `@neondatabase/serverless`   |
| API Docs   | Swagger UI (`swagger-ui-express` + `swagger-jsdoc`) |

---

## License

MIT
