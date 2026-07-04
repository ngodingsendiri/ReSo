import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import "dotenv/config";

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

  app.use(express.json());
  
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

  // Recalculate logic offloaded to backend
  app.post("/api/recalculate", async (req, res) => {
    try {
      const { engagements, employees, mode } = req.body;
      const authHeader = req.headers.authorization;
      const token = authHeader?.split('Bearer ')[1];
      
      if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
      const isExactMatchInTarget = (nameMatch: string, targetText: string) => {
        if (!targetText) return false;
        const normalizedTarget = normalize(targetText);
        return normalizedTarget.includes(nameMatch);
      };

      const updated = engagements.map((engagement: any) => {
        const processEngagement = (rawText: string, platform: 'ig' | 'fb' | 'tiktok') => {
          if (!rawText) return [];
          const textLines = rawText.split('\n').filter(l => l.trim().length > 0);
          const lowerInput = normalize(rawText);
          const engagedIds: string[] = [];

          employees.forEach((emp: any) => {
            const nameMatch = normalize(emp.name);
            const igMatch = emp.igUsername ? normalize(emp.igUsername.replace('@', '')) : '';
            const igMatch2 = emp.igUsername2 ? normalize(emp.igUsername2.replace('@', '')) : '';
            const fbMatch = emp.fbName ? normalize(emp.fbName) : '';
            const fbMatch2 = emp.fbName2 ? normalize(emp.fbName2) : '';
            const tiktokMatch = emp.tiktokName ? normalize(emp.tiktokName.replace('@', '')) : '';
            const tiktokMatch2 = emp.tiktokName2 ? normalize(emp.tiktokName2.replace('@', '')) : '';
            
            let isMatch = false;

            if (nameMatch && lowerInput.includes(nameMatch)) isMatch = true;
            
            if (platform === 'ig' && igMatch && lowerInput.includes(igMatch)) isMatch = true;
            if (platform === 'ig' && igMatch2 && lowerInput.includes(igMatch2)) isMatch = true;
            if (platform === 'fb' && fbMatch && lowerInput.includes(fbMatch)) isMatch = true;
            if (platform === 'fb' && fbMatch2 && lowerInput.includes(fbMatch2)) isMatch = true;
            if (platform === 'tiktok' && tiktokMatch && lowerInput.includes(tiktokMatch)) isMatch = true;
            if (platform === 'tiktok' && tiktokMatch2 && lowerInput.includes(tiktokMatch2)) isMatch = true;

            if (!isMatch) {
              for (const line of textLines) {
                if (isExactMatchInTarget(nameMatch, line)) {
                  isMatch = true; break;
                }
                if (platform === 'ig') {
                  if (igMatch && isExactMatchInTarget(igMatch, line)) { isMatch = true; break; }
                  if (igMatch2 && isExactMatchInTarget(igMatch2, line)) { isMatch = true; break; }
                }
                if (platform === 'fb') {
                  if (fbMatch && isExactMatchInTarget(fbMatch, line)) { isMatch = true; break; }
                  if (fbMatch2 && isExactMatchInTarget(fbMatch2, line)) { isMatch = true; break; }
                }
                if (platform === 'tiktok') {
                  if (tiktokMatch && isExactMatchInTarget(tiktokMatch, line)) { isMatch = true; break; }
                  if (tiktokMatch2 && isExactMatchInTarget(tiktokMatch2, line)) { isMatch = true; break; }
                }
              }
            }

            if (isMatch) engagedIds.push(emp.id);
          });
          return engagedIds;
        };

        const igEngagedIds = processEngagement(engagement.igRawText || '', 'ig');
        const fbEngagedIds = processEngagement(engagement.fbRawText || '', 'fb');
        const tiktokEngagedIds = processEngagement(engagement.tiktokRawText || '', 'tiktok');

        const igChanged = JSON.stringify(engagement.igEngagedEmployeeIds || []) !== JSON.stringify(igEngagedIds);
        const fbChanged = JSON.stringify(engagement.fbEngagedEmployeeIds || []) !== JSON.stringify(fbEngagedIds);
        const tiktokChanged = JSON.stringify(engagement.tiktokEngagedEmployeeIds || []) !== JSON.stringify(tiktokEngagedIds);

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
