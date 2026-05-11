import admin from 'firebase-admin';
import * as fs from 'fs';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));

try {
  admin.initializeApp({
    projectId: config.firebaseProjectId
  });
  const db = admin.firestore();
  db.collection('test').get().then(() => {
    console.log('Firebase Admin Success');
  }).catch((e: any) => {
    console.log('Firebase Admin Failed:', e);
  });
} catch(e) {
  console.log('Init Failed:', e);
}
