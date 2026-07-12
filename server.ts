import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import "dotenv/config";
import { matchEmployeesToEngagement, engagedIdsEqual } from "./src/lib/matching";

// Error handling for the process
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
  process.exit(1);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));
  
  // Basic health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });
  
  // Logging for API requests to debug 404/500 on mobile
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`[API REQUEST] ${req.method} ${req.path} - ${new Date().toISOString()} - UA: ${req.headers['user-agent']}`);
    }
    next();
  });

  // Load config once
  let firebaseConfig: any = {};
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8'));
  } catch (e) {
    console.error('Could not load firebase-applet-config.json', e);
  }

  // Optional local-dev recalculate (production uses client-side; same matching module)
  app.post("/api/recalculate", async (req, res) => {
    try {
      const { engagements, employees } = req.body;
      const authHeader = req.headers.authorization;
      const token = authHeader?.split('Bearer ')[1];
      
      if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!Array.isArray(engagements) || !Array.isArray(employees)) {
        return res.status(400).json({ error: "Invalid payload" });
      }

      const updated = engagements.map((engagement: any) => {
        const igEngagedIds = matchEmployeesToEngagement(engagement.igRawText || '', employees, 'ig');
        const fbEngagedIds = matchEmployeesToEngagement(engagement.fbRawText || '', employees, 'fb');
        const tiktokEngagedIds = matchEmployeesToEngagement(engagement.tiktokRawText || '', employees, 'tiktok');

        const igChanged = !engagedIdsEqual(engagement.igEngagedEmployeeIds || [], igEngagedIds);
        const fbChanged = !engagedIdsEqual(engagement.fbEngagedEmployeeIds || [], fbEngagedIds);
        const tiktokChanged = !engagedIdsEqual(engagement.tiktokEngagedEmployeeIds || [], tiktokEngagedIds);

        return {
          id: engagement.id,
          date: engagement.date,
          igEngagedIds,
          fbEngagedIds,
          tiktokEngagedIds,
          igChanged,
          fbChanged,
          tiktokChanged,
          hasChanges: igChanged || fbChanged || tiktokChanged
        };
      }).filter((e: any) => e.hasChanges);

      if (updated.length === 0) {
        return res.json({ updatedCount: 0 });
      }

      // Execute writes to Firestore via REST API
      const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
      const projectId = firebaseConfig.projectId;
      
      const writes = updated.map((update: any) => {
        const fields: any = {};
        const updateMask: string[] = [];
        
        if (update.igChanged) {
          fields.igEngagedEmployeeIds = { arrayValue: { values: update.igEngagedIds.map((id: string) => ({ stringValue: id })) } };
          updateMask.push("igEngagedEmployeeIds");
        }
        if (update.fbChanged) {
          fields.fbEngagedEmployeeIds = { arrayValue: { values: update.fbEngagedIds.map((id: string) => ({ stringValue: id })) } };
          updateMask.push("fbEngagedEmployeeIds");
        }
        if (update.tiktokChanged) {
          fields.tiktokEngagedEmployeeIds = { arrayValue: { values: update.tiktokEngagedIds.map((id: string) => ({ stringValue: id })) } };
          updateMask.push("tiktokEngagedEmployeeIds");
        }
        
        // Add updatedAt
        fields.updatedAt = { timestampValue: new Date().toISOString() };
        updateMask.push("updatedAt");

        return {
          update: {
            name: `projects/${projectId}/databases/${dbId}/documents/dailyEngagement/${update.id}`,
            fields
          },
          updateMask: {
            fieldPaths: updateMask
          }
        };
      });

      // Split into chunks of 500
      for (let i = 0; i < writes.length; i += 500) {
        const chunk = writes.slice(i, i + 500);
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents:commit`;
        
        const commitRes = await fetch(firestoreUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ writes: chunk })
        });
        
        if (!commitRes.ok) {
          const errText = await commitRes.text();
          console.error('Firestore commit failed', errText);
          throw new Error('Failed to commit to Firestore');
        }
      }

      res.json({ updatedCount: updated.length });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Server error during recalculation" });
    }
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

    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
