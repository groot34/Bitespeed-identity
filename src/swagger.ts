import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Bitespeed Identity Reconciliation API",
      version: "1.0.0",
      description:
        "A service that links different contact details (email, phone number) " +
        "of the same person into a single consolidated identity. Built for " +
        "FluxKart.com to give Doc Brown a personalised shopping experience.",
      contact: {
        name: "Bitespeed",
      },
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Local development server",
      },
    ],
  },
  apis: ["./src/index.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
