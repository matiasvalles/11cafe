import admin from 'firebase-admin';

let isInitialized = false;

export function getFirebaseAdmin() {
  if (isInitialized && admin.apps.length > 0) {
    return {
      admin,
      db: admin.firestore(),
      auth: admin.auth(),
      isConfigured: true
    };
  }

  try {
    // 1. Intentar con FIREBASE_SERVICE_ACCOUNT_KEY (JSON string o Base64)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      let rawCreds = process.env.FIREBASE_SERVICE_ACCOUNT_KEY.trim();
      let serviceAccount;
      if (rawCreds.startsWith('{')) {
        serviceAccount = JSON.parse(rawCreds);
      } else {
        const decoded = Buffer.from(rawCreds, 'base64').toString('utf-8');
        serviceAccount = JSON.parse(decoded);
      }

      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
      }
      isInitialized = true;
      return { admin, db: admin.firestore(), auth: admin.auth(), isConfigured: true };
    }

    // 2. Intentar con variables individuales (PROJECT_ID, CLIENT_EMAIL, PRIVATE_KEY)
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
          })
        });
      }
      isInitialized = true;
      return { admin, db: admin.firestore(), auth: admin.auth(), isConfigured: true };
    }

    // 3. Fallback: Google Application Default Credentials si está en GCP/Cloud Run
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GCLOUD_PROJECT) {
      if (!admin.apps.length) {
        admin.initializeApp();
      }
      isInitialized = true;
      return { admin, db: admin.firestore(), auth: admin.auth(), isConfigured: true };
    }
  } catch (err) {
    console.warn('[Firebase Admin] No se pudo inicializar con credenciales de entorno:', err.message);
  }

  return {
    admin: null,
    db: null,
    auth: null,
    isConfigured: false
  };
}

export default getFirebaseAdmin;
