export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "Anti-loss Server API",
    version: "1.0.0",
    description: "Device auth, telemetry upload, and admin APIs."
  },
  servers: [
    { url: "http://127.0.0.1:8081" }
  ],
  tags: [
    { name: "Health" },
    { name: "Auth" },
    { name: "Telemetry" },
    { name: "Admin" }
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      adminKey: { type: "apiKey", in: "header", name: "x-admin-key" }
    },
    schemas: {
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
        required: ["error"]
      },
      RegisterRequest: {
        type: "object",
        properties: {
          deviceId: { type: "string" },
          secret: { type: "string" }
        },
        required: ["deviceId", "secret"]
      },
      LoginRequest: {
        type: "object",
        properties: {
          deviceId: { type: "string" },
          secret: { type: "string" }
        },
        required: ["deviceId", "secret"]
      },
      LoginResponse: {
        type: "object",
        properties: {
          token: { type: "string" },
          expiresIn: { type: "number" },
          autoRegistered: { type: "boolean" }
        },
        required: ["token", "expiresIn"]
      },
      SignatureHeaders: {
        type: "object",
        properties: {
          xTimestamp: { type: "string", description: "x-timestamp header" },
          xNonce: { type: "string", description: "x-nonce header" },
          xSignature: { type: "string", description: "x-signature header" }
        }
      },
      HeartbeatBody: {
        type: "object",
        additionalProperties: true,
        properties: {
          collectedAt: { type: "string", format: "date-time" },
          batteryPct: { type: "number" },
          charging: { type: "boolean" },
          networkType: { type: "string" },
          appVersion: { type: "string" }
        }
      },
      LocationBody: {
        type: "object",
        additionalProperties: true,
        properties: {
          collectedAt: { type: "string", format: "date-time" },
          lat: { type: "number" },
          lon: { type: "number" },
          accuracyM: { type: "number" },
          speedMps: { type: "number" }
        }
      },
      EventBody: {
        type: "object",
        additionalProperties: true
      }
    }
  },
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    now: { type: "string", format: "date-time" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register or update device secret",
        security: [{ adminKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RegisterRequest" }
            }
          }
        },
        responses: {
          "201": { description: "Created" },
          "400": {
            description: "Missing fields",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
          },
          "401": {
            description: "Invalid admin key",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
          }
        }
      }
    },
    "/api/v1/auth/device-login": {
      post: {
        tags: ["Auth"],
        summary: "Device login (auto-register if device does not exist)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginRequest" }
            }
          }
        },
        responses: {
          "200": {
            description: "Login success",
            content: { "application/json": { schema: { $ref: "#/components/schemas/LoginResponse" } } }
          },
          "201": {
            description: "Auto-registered and logged in",
            content: { "application/json": { schema: { $ref: "#/components/schemas/LoginResponse" } } }
          },
          "400": {
            description: "Missing fields",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
          },
          "401": {
            description: "Invalid credentials",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
          }
        }
      }
    },
    "/api/v1/heartbeat": {
      post: {
        tags: ["Telemetry"],
        summary: "Upload heartbeat",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "header", name: "x-timestamp", required: true, schema: { type: "string" } },
          { in: "header", name: "x-nonce", required: true, schema: { type: "string" } },
          { in: "header", name: "x-signature", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/HeartbeatBody" } } }
        },
        responses: { "201": { description: "Saved" }, "401": { description: "Unauthorized" } }
      }
    },
    "/api/v1/location": {
      post: {
        tags: ["Telemetry"],
        summary: "Upload location",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "header", name: "x-timestamp", required: true, schema: { type: "string" } },
          { in: "header", name: "x-nonce", required: true, schema: { type: "string" } },
          { in: "header", name: "x-signature", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LocationBody" } } }
        },
        responses: { "201": { description: "Saved" }, "401": { description: "Unauthorized" } }
      }
    },
    "/api/v1/events": {
      post: {
        tags: ["Telemetry"],
        summary: "Upload generic event",
        security: [{ bearerAuth: [] }],
        parameters: [
          { in: "header", name: "x-timestamp", required: true, schema: { type: "string" } },
          { in: "header", name: "x-nonce", required: true, schema: { type: "string" } },
          { in: "header", name: "x-signature", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/EventBody" } } }
        },
        responses: { "201": { description: "Saved" }, "401": { description: "Unauthorized" } }
      }
    },
    "/api/v1/admin/devices": {
      get: {
        tags: ["Admin"],
        summary: "List devices",
        security: [{ adminKey: [] }],
        responses: { "200": { description: "OK" }, "401": { description: "Unauthorized" } }
      }
    },
    "/api/v1/admin/overview": {
      get: {
        tags: ["Admin"],
        summary: "Overview dashboard data",
        security: [{ adminKey: [] }],
        parameters: [
          { in: "query", name: "limit", schema: { type: "integer", default: 20 } }
        ],
        responses: { "200": { description: "OK" }, "401": { description: "Unauthorized" } }
      }
    },
    "/api/v1/admin/records/{kind}": {
      get: {
        tags: ["Admin"],
        summary: "List records by kind",
        security: [{ adminKey: [] }],
        parameters: [
          { in: "path", name: "kind", required: true, schema: { type: "string", enum: ["heartbeats", "locations", "events"] } },
          { in: "query", name: "limit", schema: { type: "integer", default: 50 } },
          { in: "query", name: "deviceId", schema: { type: "string" } },
          { in: "query", name: "order", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } }
        ],
        responses: {
          "200": { description: "OK" },
          "400": { description: "Invalid kind" },
          "401": { description: "Unauthorized" }
        }
      }
    }
  }
};
