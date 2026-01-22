import { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileText, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UploadedFile } from '@/types/document';

interface FileDropzoneProps {
  title: string;
  description: string;
  files: UploadedFile[];
  onFilesAdded: (files: File[]) => void;
  onFileRemove: (id: string) => void;
  accept?: string;
  disabled?: boolean;
}

export function FileDropzone({
  title,
  description,
  files,
  onFilesAdded,
  onFileRemove,
  accept = '.pdf',
  disabled = false,
}: FileDropzoneProps) {
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (disabled) return;

      const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
        f.name.toLowerCase().endsWith('.pdf')
      );
      if (droppedFiles.length > 0) {
        onFilesAdded(droppedFiles);
      }
    },
    [onFilesAdded, disabled]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files || []);
      if (selectedFiles.length > 0) {
        onFilesAdded(selectedFiles);
      }
      e.target.value = '';
    },
    [onFilesAdded]
  );

  const getStatusIcon = (status: UploadedFile['status']) => {
    switch (status) {
      case 'processing':
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-primary" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      default:
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className={cn(
          'relative rounded-xl border-2 border-dashed transition-all duration-200',
          disabled
            ? 'cursor-not-allowed border-muted bg-muted/30'
            : 'cursor-pointer border-primary/30 bg-accent/30 hover:border-primary/50 hover:bg-accent/50'
        )}
      >
        <input
          type="file"
          accept={accept}
          multiple
          onChange={handleFileInput}
          disabled={disabled}
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <div className="flex flex-col items-center justify-center py-10 px-4">
          <div className="rounded-full bg-primary/10 p-4 mb-4">
            <Upload className="h-8 w-8 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">
            Arraste arquivos PDF aqui
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            ou clique para selecionar
          </p>
        </div>
      </div>

      <AnimatePresence mode="popLayout">
        {files.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2 max-h-60 overflow-y-auto"
          >
            {files.map((file) => (
              <motion.div
                key={file.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 transition-colors',
                  file.status === 'error'
                    ? 'border-destructive/50 bg-destructive/5'
                    : file.status === 'completed'
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border bg-card'
                )}
              >
                {file.previewUrl ? (
                  <img
                    src={file.previewUrl}
                    alt="Preview"
                    className="h-12 w-10 rounded object-cover border"
                  />
                ) : (
                  <div className="h-12 w-10 rounded bg-muted flex items-center justify-center">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  {file.extractedName && (
                    <p className="text-xs text-primary font-medium">
                      {file.extractedName}
                    </p>
                  )}
                  {file.error && (
                    <p className="text-xs text-destructive">{file.error}</p>
                  )}
                  {file.status === 'processing' && (
                    <div className="mt-1 h-1 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{ width: `${file.progress}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {getStatusIcon(file.status)}
                  <button
                    onClick={() => onFileRemove(file.id)}
                    disabled={file.status === 'processing'}
                    className="rounded-full p-1 hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
