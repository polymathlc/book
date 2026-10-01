// Browser acceptance double for the existing Firebase services. No live user
// content or provider calls are created by CI.
module.exports = async function installFirebaseMock(page, base) {
  await page.addInitScript(() => {
    window.__fm = {
      auth: { currentUser: null },
      listeners: [],
      index: { aiEngine: "openai", bookStudioProjects: {} },
      files: {},
      uploads: 0,
      requests: [],
      delayAI: false,
    };
  });
  const shared = `const f=window.__fm;`;
  const modules = {
    "firebase-app.js": `export const getApps=()=>[];export const initializeApp=c=>({name:'[DEFAULT]',options:c});`,
    "firebase-auth.js":
      shared +
      `export const getAuth=()=>f.auth;export const onAuthStateChanged=(a,cb)=>{f.listeners.push(cb);queueMicrotask(()=>cb(a.currentUser));return()=>{f.listeners=f.listeners.filter(x=>x!==cb);};};export class GoogleAuthProvider{};function login(){f.auth.currentUser={uid:'teacher',email:'teacher@example.test'};f.listeners.slice().forEach(cb=>cb(f.auth.currentUser));return Promise.resolve({user:f.auth.currentUser});}export const signInWithPopup=login;export const signInWithEmailAndPassword=login;export async function signOut(){f.auth.currentUser=null;f.listeners.slice().forEach(cb=>cb(null));}`,
    "firebase-app-check.js": `export class ReCaptchaV3Provider{};export const initializeAppCheck=()=>({});`,
    "firebase-functions.js":
      shared +
      `export const getFunctions=()=>({});export const httpsCallable=(fn,name)=>async data=>{f.requests.push({name,data});if(f.delayAI)await new Promise(r=>setTimeout(r,900));const response=await fetch(${JSON.stringify(base + "/mock-ai")},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data})});return {data:await response.json()};};`,
    "firebase-firestore.js":
      shared +
      `export const getFirestore=()=>({});export const doc=(db,...p)=>p.join('/');export const collection=doc;const snap=data=>({exists:()=>!!data,data:()=>structuredClone(data)});export const getDoc=async path=>snap(path==='adminSettings/teacher'?f.index:path==='config/admin'?{uid:'teacher'}:path.includes('answerStyle')?{profile:{styleRules:'Use clear arithmetic and name the units.'}}:null);export const getDocs=async()=>({forEach:cb=>cb({data:()=>({guidance:'Explain one quantity per line.',title:'Arithmetic',subject:'Mathematics',level:'P6'})})});export const runTransaction=async(db,fn)=>fn({get:async path=>snap(f.index),set:(path,patch)=>{f.index={...f.index,...patch,bookStudioProjects:{...f.index.bookStudioProjects,...patch.bookStudioProjects}};}});`,
    "firebase-storage.js":
      shared +
      `export const getStorage=()=>({});export const ref=(storage,path)=>path;export async function uploadBytes(path,blob){await new Promise(r=>setTimeout(r,60));f.files[path]=blob;f.uploads++;}export const getBlob=async path=>f.files[path];export const deleteObject=async path=>{delete f.files[path];};`,
  };
  await page.route(
    "https://www.gstatic.com/firebasejs/11.10.0/*",
    async (route) => {
      const name = new URL(route.request().url()).pathname.split("/").pop();
      if (!modules[name]) return route.abort();
      return route.fulfill({
        status: 200,
        contentType: "text/javascript",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: modules[name],
      });
    },
  );
  await page.route(base + "/mock-ai", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        model: "mock-shared-AI",
        text: JSON.stringify({
          warnings: [],
          verification: "3 × 12 = 36; 36 ÷ 3 = 12.",
          answers: [
            {
              part: "a",
              answer: "36 beads",
              working: "Each box contains 12 beads.\n3 × 12 = 36 beads",
              explanation:
                "Multiply the number of boxes by the beads in each box.",
            },
          ],
          habits: [],
        }),
      }),
    }),
  );
};
