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
}

export interface GeneratedDocument {
  id: string;
  employeeName: string;
  year: number;
  month: number;
  createdAt: Date;
  blobUrl: string;
  fileName: string;
}
