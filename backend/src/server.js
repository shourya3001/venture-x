require("dotenv").config();

const express = require("express");
const { createChatRouter } = require("./routes/chat");
const { createAnalyzeRouter } = require("./routes/analyze");
const { createLlmProvider, LlmProviderError } = require("./services/llm-provider");

function createCorsMiddleware(allowedOrigin) {
  return (req, res, next) => {
    const origin = req.get("Origin");
    if (origin) {
      if (!allowedOrigin || origin !== allowedOrigin) {
        res.status(403).json({
          error: {
            code: "ORIGIN_NOT_ALLOWED",
            message: "This origin is not allowed to access the LectureMate backend."
          }
        });
        return;
      }

      res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Vary", "Origin");
    }

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

function getAllowedExtensionOrigin(value) {
  if (!value) {
    return "";
  }

  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    throw new Error("ALLOWED_EXTENSION_ORIGIN must be a chrome-extension origin.");
  }
  if (url.protocol !== "chrome-extension:" || !url.host ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.search || url.hash || url.username || url.password) {
    throw new Error("ALLOWED_EXTENSION_ORIGIN must be a chrome-extension origin.");
  }
  return `chrome-extension://${url.host}`;
}

function mapError(error) {
  const statusByCode = {
    MISSING_API_KEY: 503,
    INVALID_PROVIDER_CONFIGURATION: 500,
    PROVIDER_TIMEOUT: 504,
    PROVIDER_UNAVAILABLE: 502,
    UPSTREAM_ERROR: 502,
    INVALID_PROVIDER_RESPONSE: 502
  };
  const status = statusByCode[error.code] || 500;
  const messageByCode = {
    MISSING_API_KEY: "The AI provider is not configured. Add its API key to backend/.env and restart the backend.",
    INVALID_PROVIDER_CONFIGURATION: "The AI provider configuration is invalid.",
    PROVIDER_TIMEOUT: "The AI provider took too long to respond. Please try again.",
    PROVIDER_UNAVAILABLE: "The AI provider could not be reached. Check the backend connection and try again.",
    UPSTREAM_ERROR: "The AI provider rejected or failed the request. Check the provider configuration and try again.",
    INVALID_PROVIDER_RESPONSE: "The AI provider returned an unsupported response."
  };
  return {
    status,
    body: {
      error: {
        code: error.code || "INTERNAL_ERROR",
        message: messageByCode[error.code] || "The backend could not complete the request."
      }
    }
  };
}

function createApp(options = {}) {
  const app = express();
  const configuredOrigin = options.allowedOrigin === undefined
    ? process.env.ALLOWED_EXTENSION_ORIGIN || ""
    : options.allowedOrigin;
  const allowedOrigin = getAllowedExtensionOrigin(configuredOrigin);
  const llmProvider = options.llmProvider || createLlmProvider();

  app.disable("x-powered-by");
  app.use(createCorsMiddleware(allowedOrigin));
  app.use(express.json({ limit: "1mb", strict: true }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/api/chat", createChatRouter(llmProvider));
  app.use("/api/analyze", createAnalyzeRouter());
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "The requested backend endpoint does not exist."
      }
    });
  });
  app.use((error, _req, res, _next) => {
    if (error.type === "entity.too.large") {
      res.status(413).json({
        error: {
          code: "REQUEST_TOO_LARGE",
          message: "The request body exceeds the 1 MB limit."
        }
      });
      return;
    }
    if (error instanceof SyntaxError && error.status === 400) {
      res.status(400).json({
        error: {
          code: "INVALID_JSON",
          message: "The request body must contain valid JSON."
        }
      });
      return;
    }

    const mapped = mapError(error);
    if (!(error instanceof LlmProviderError) && mapped.status === 500) {
      console.error("LectureMate backend request failed (INTERNAL_ERROR).");
    } else {
      console.error(`LectureMate backend request failed (${mapped.body.error.code}).`);
    }
    res.status(mapped.status).json(mapped.body);
  });

  return app;
}

function getServerConfig(environment = process.env) {
  const port = Number(environment.PORT || 3000);
  const host = environment.HOST ||
    (environment.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (!isLoopback && !(host === "0.0.0.0" && environment.NODE_ENV === "production")) {
    throw new Error("HOST must be loopback unless running in production.");
  }
  return { port, host };
}

if (require.main === module) {
  try {
    const { port, host } = getServerConfig();
    const app = createApp();
    const server = app.listen(port, host, () => {
      console.log(`LectureMate backend listening on http://${host}:${port}`);
    });
    server.on("error", (error) => {
      console.error(`LectureMate backend could not start (${error.code || "SERVER_ERROR"}).`);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(`LectureMate backend configuration error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { createApp, getServerConfig };
