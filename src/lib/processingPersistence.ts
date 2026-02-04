/**
 * IndexedDB-based persistence for OCR processing state
 * Allows resuming interrupted processing after page navigation/closure
 */

const DB_NAME = 'documerge-processing';
const DB_VERSION = 1;
const FILES_STORE = 'files';
const STATE_STORE = 'processing-state';

// Processing state stored in IndexedDB
export interface PersistedFile {
  id: string;
  blob: Blob;
  name: string;
  type: 'holerite' | 'comprovante';
  uploadedAt: Date;
}

export interface ExtractedEntry {
  holeriteId: string;
  name: string;
  pageNumber: number;
}

export interface PersistedMatch {
  employeeName: string;
  holeriteId: string;
  holeritePageNumber: number;
  comprovanteId: string;
  comprovantePageNumber: number;
}

export interface ProcessingState {
  id: string;
  startedAt: Date;
  updatedAt: Date;
  status: 'extracting' | 'matching' | 'generating';
  
  // File references (IDs pointing to FILES_STORE)
  holeritesIds: string[];
  comprovantesIds: string[];
  
  // Current progress
  currentHoleriteIndex: number;
  currentPageNumber: number;
  totalPages: number;
  
  // Partial results
  extractedEntries: ExtractedEntry[];
  matchedPairs: PersistedMatch[];
}

let db: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Check if the database connection is still valid
 */
function isConnectionValid(): boolean {
  if (!db) return false;
  try {
    // Test if connection is alive by accessing objectStoreNames
    const _ = db.objectStoreNames;
    return true;
  } catch {
    return false;
  }
}

/**
 * Setup connection handlers for unexpected close/error
 */
function setupConnectionHandlers(database: IDBDatabase) {
  database.onclose = () => {
    console.log('[Persistence] Database connection closed unexpectedly');
    db = null;
    dbPromise = null;
  };
  
  database.onerror = (event) => {
    console.error('[Persistence] Database error:', event);
  };
}

/**
 * Open/create the IndexedDB database
 */
async function openDatabase(): Promise<IDBDatabase> {
  // Check if existing connection is still valid
  if (db) {
    if (isConnectionValid()) {
      return db;
    }
    // Connection was closed, reset references
    console.log('[Persistence] Connection was closed, reopening...');
    db = null;
    dbPromise = null;
  }
  
  if (dbPromise) return dbPromise;
  
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      console.error('[Persistence] Failed to open IndexedDB:', request.error);
      dbPromise = null; // Reset promise on error
      reject(request.error);
    };
    
    request.onsuccess = () => {
      db = request.result;
      setupConnectionHandlers(db);
      console.log('[Persistence] IndexedDB opened successfully');
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      
      // Create files store
      if (!database.objectStoreNames.contains(FILES_STORE)) {
        database.createObjectStore(FILES_STORE, { keyPath: 'id' });
        console.log('[Persistence] Created files store');
      }
      
      // Create state store
      if (!database.objectStoreNames.contains(STATE_STORE)) {
        database.createObjectStore(STATE_STORE, { keyPath: 'id' });
        console.log('[Persistence] Created state store');
      }
    };
  });
  
  return dbPromise;
}

/**
 * Save a file blob to IndexedDB
 */
export async function saveFileBlob(id: string, file: File, type: 'holerite' | 'comprovante'): Promise<void> {
  const database = await openDatabase();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([FILES_STORE], 'readwrite');
    const store = transaction.objectStore(FILES_STORE);
    
    const record: PersistedFile = {
      id,
      blob: file,
      name: file.name,
      type,
      uploadedAt: new Date(),
    };
    
    const request = store.put(record);
    
    request.onsuccess = () => {
      console.log(`[Persistence] Saved file ${file.name} (${id})`);
      resolve();
    };
    
    request.onerror = () => {
      console.error('[Persistence] Failed to save file:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Load a file blob from IndexedDB
 */
export async function loadFileBlob(id: string): Promise<File | null> {
  const database = await openDatabase();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([FILES_STORE], 'readonly');
    const store = transaction.objectStore(FILES_STORE);
    
    const request = store.get(id);
    
    request.onsuccess = () => {
      const record = request.result as PersistedFile | undefined;
      if (record) {
        // Reconstruct File from Blob
        const file = new File([record.blob], record.name, { type: 'application/pdf' });
        resolve(file);
      } else {
        resolve(null);
      }
    };
    
    request.onerror = () => {
      console.error('[Persistence] Failed to load file:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Load all files from IndexedDB
 */
export async function loadAllFiles(): Promise<PersistedFile[]> {
  const database = await openDatabase();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([FILES_STORE], 'readonly');
    const store = transaction.objectStore(FILES_STORE);
    
    const request = store.getAll();
    
    request.onsuccess = () => {
      resolve(request.result || []);
    };
    
    request.onerror = () => {
      console.error('[Persistence] Failed to load files:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Save processing state to IndexedDB
 */
export async function saveProcessingState(state: Omit<ProcessingState, 'id' | 'updatedAt'>): Promise<void> {
  const database = await openDatabase();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STATE_STORE], 'readwrite');
    const store = transaction.objectStore(STATE_STORE);
    
    const record: ProcessingState = {
      ...state,
      id: 'current',
      updatedAt: new Date(),
    };
    
    const request = store.put(record);
    
    request.onsuccess = () => {
      console.log('[Persistence] State saved:', {
        status: state.status,
        holeriteIndex: state.currentHoleriteIndex,
        page: state.currentPageNumber,
        entries: state.extractedEntries.length,
      });
      resolve();
    };
    
    request.onerror = () => {
      console.error('[Persistence] Failed to save state:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Load processing state from IndexedDB
 */
export async function loadProcessingState(): Promise<ProcessingState | null> {
  const database = await openDatabase();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STATE_STORE], 'readonly');
    const store = transaction.objectStore(STATE_STORE);
    
    const request = store.get('current');
    
    request.onsuccess = () => {
      const record = request.result as ProcessingState | undefined;
      if (record) {
        // Convert date strings back to Date objects
        record.startedAt = new Date(record.startedAt);
        record.updatedAt = new Date(record.updatedAt);
        console.log('[Persistence] Loaded saved state:', {
          status: record.status,
          holeriteIndex: record.currentHoleriteIndex,
          page: record.currentPageNumber,
          entries: record.extractedEntries.length,
        });
      }
      resolve(record || null);
    };
    
    request.onerror = () => {
      console.error('[Persistence] Failed to load state:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Clear all processing data from IndexedDB
 */
export async function clearProcessingState(): Promise<void> {
  const database = await openDatabase();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([FILES_STORE, STATE_STORE], 'readwrite');
    
    const filesStore = transaction.objectStore(FILES_STORE);
    const stateStore = transaction.objectStore(STATE_STORE);
    
    filesStore.clear();
    stateStore.clear();
    
    transaction.oncomplete = () => {
      console.log('[Persistence] Cleared all processing data');
      resolve();
    };
    
    transaction.onerror = () => {
      console.error('[Persistence] Failed to clear data:', transaction.error);
      reject(transaction.error);
    };
  });
}

/**
 * Check if there's a saved processing state
 */
export async function hasSavedProcessingState(): Promise<boolean> {
  try {
    const state = await loadProcessingState();
    return state !== null;
  } catch {
    return false;
  }
}

/**
 * Get a summary of saved processing for UI display
 */
export async function getProcessingSummary(): Promise<{
  fileName: string;
  progress: number;
  totalPages: number;
  currentPage: number;
  startedAt: Date;
  status: string;
} | null> {
  try {
    const state = await loadProcessingState();
    if (!state) return null;
    
    const files = await loadAllFiles();
    const currentFile = files.find(f => f.id === state.holeritesIds[state.currentHoleriteIndex]);
    
    const totalPages = state.totalPages || 1;
    const currentPage = state.currentPageNumber || 1;
    const progress = Math.round((currentPage / totalPages) * 100);
    
    return {
      fileName: currentFile?.name || 'Documento',
      progress,
      totalPages,
      currentPage,
      startedAt: state.startedAt,
      status: state.status,
    };
  } catch {
    return null;
  }
}

/**
 * Clean up old processing data (older than 24 hours)
 */
export async function cleanupOldData(): Promise<void> {
  try {
    const state = await loadProcessingState();
    if (!state) return;
    
    const ageMs = Date.now() - state.startedAt.getTime();
    const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours
    
    if (ageMs > maxAgeMs) {
      console.log('[Persistence] Cleaning up old processing data (>24h)');
      await clearProcessingState();
    }
  } catch (error) {
    console.error('[Persistence] Error during cleanup:', error);
  }
}
