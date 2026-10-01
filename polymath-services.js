// The same public Firebase application and server-keyed callables as CER,
// Ans Key and Tutor. Provider secrets stay in the existing Cloud Functions.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo",
  authDomain: "mathgen--app.firebaseapp.com",
  projectId: "mathgen--app",
  storageBucket: "mathgen--app.firebasestorage.app",
  messagingSenderId: "165654161198",
  appId: "1:165654161198:web:16c8bd60eb3a2aa7edbcbf",
};
const SITE_KEY = "6Le98gwtAAAAAAzkjJTZXFM5D8tpjx_P4rtRuhuH";
export const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/11.10.0/";
let servicesPromise;
export async function polymathServices() {
  if (!servicesPromise)
    servicesPromise = (async () => {
      const [appSDK, authSDK, fnsSDK, checkSDK, storeSDK] = await Promise.all([
        import(FIREBASE_SDK + "firebase-app.js"),
        import(FIREBASE_SDK + "firebase-auth.js"),
        import(FIREBASE_SDK + "firebase-functions.js"),
        import(FIREBASE_SDK + "firebase-app-check.js"),
        import(FIREBASE_SDK + "firebase-firestore.js"),
      ]);
      const app =
        appSDK.getApps().find((a) => a.name === "[DEFAULT]") ||
        appSDK.initializeApp(FIREBASE_CONFIG);
      try {
        checkSDK.initializeAppCheck(app, {
          provider: new checkSDK.ReCaptchaV3Provider(SITE_KEY),
          isTokenAutoRefreshEnabled: true,
        });
      } catch {}
      const auth = authSDK.getAuth(app);
      await new Promise((resolve) => {
        let stop;
        stop = authSDK.onAuthStateChanged(auth, () => {
          queueMicrotask(() => stop?.());
          resolve();
        });
      });
      return {
        app,
        auth,
        authSDK,
        fnsSDK,
        storeSDK,
        functions: fnsSDK.getFunctions(app, "us-central1"),
        db: storeSDK.getFirestore(app),
      };
    })().catch((error) => {
      servicesPromise = null;
      throw new Error(
        "The Polymath sign-in connection could not load. Check your connection and open AI tools again. " +
          error.message,
      );
    });
  return servicesPromise;
}
