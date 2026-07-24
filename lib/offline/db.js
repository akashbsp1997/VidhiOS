// lib/offline/db.js
//
// A minimal raw-IndexedDB wrapper -- no new npm dependency, since the
// actual usage here (one object store, add/getAll/delete) doesn't need
// more than a few small promise-wrapped calls. Client-only by nature
// (IndexedDB doesn't exist during SSR); every exported function is only
// ever called from inside a "use client" component's effect, never at
// module-eval time, so importing this module during server rendering is
// safe even though calling it there would not be.
const DB_NAME = "vidhios-offline";
const DB_VERSION = 1;
const STORE_NAME = "pendingWrites";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// write: { url, method, body, createdAt } -- id is assigned by autoIncrement.
export async function addPendingWrite(write) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add(write);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllPendingWrites() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deletePendingWrite(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
