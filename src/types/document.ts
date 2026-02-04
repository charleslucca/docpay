export interface GeneratedDocument {
  id: string;
  employeeName: string;
  year: number;
  month: number;
  monthName: string; // Portuguese month name (e.g., "Janeiro")
  createdAt: Date;
  blobUrl: string;
  fileName: string;
}

export interface UploadedFile {
  id: string;
  file: File;
  name: string;
  type: 'holerite' | 'comprovante';
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  extractedName?: string;
  pageNumber?: number;
  previewUrl?: string;
  error?: string;
  // For multi-page PDF support - tracks source page in original PDF
  sourcePageNumber?: number;
  sourceFileName?: string;
  // Page count for employee estimation
  pageCount?: number;
  estimatedEmployees?: number;
}

export interface MatchedPair {
  id: string;
  employeeName: string;
  holerite: UploadedFile;
  comprovante: UploadedFile & { pageNumber: number };
  status: 'pending' | 'generating' | 'completed' | 'error';
  outputUrl?: string;
  error?: string;
}

export interface ProcessingStatus {
  step: 'idle' | 'uploading' | 'extracting' | 'matching' | 'generating' | 'completed';
  progress: number;
  message: string;
  // Time tracking fields
  startTime?: number;
  currentItemStartTime?: number;
  estimatedTimeRemaining?: number;
  currentItem?: string;
  totalItems?: number;
  processedItems?: number;
  isSlowOperation?: boolean;
  // OCR progress tracking
  ocrProgress?: number; // 0-100 during OCR recognition
  isOcrActive?: boolean;
  // Persistence tracking
  isSaving?: boolean;
  // Matching progress tracking
  matchesFound?: number;
  totalToMatch?: number;
  // OCR diagnostic metrics (for comprovantes)
  ocrPagesTotal?: number;
  ocrPagesNeedingOcr?: number;
  ocrPagesEmptyOrShort?: number; // text < 40 chars
  ocrTimeoutCount?: number;
  ocrRetryCount?: number;
}
