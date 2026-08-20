import express from "express";
import path from "path";
import "dotenv/config";

// Error handling for the process
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
  process.exit(1);
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));
  
  // Basic health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });
  
  // Logging for API requests to debug 404/500 on mobile
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`[API REQUEST] ${req.method} ${req.path} - ${new Date().toISOString()} - UA: ${req.headers['user-agent']}`);
    }
    next();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    
    // API 404 handler - Before catch-all
    app.all("/api/*", (req, res) => {
      res.status(404).json({ error: `API route ${req.method} ${req.path} not found.` });
    });

    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
