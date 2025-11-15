import React from 'react';
import { Loader2, CheckCircle2, AlertCircle, FileText, X } from 'lucide-react';

export function RCProcessingProgress({ currentStep, progress, error, isProcessing, onClose }) {
  // Only show modal if actively processing OR there's an error
  // Don't show on successful completion - let parent handle success display
  if (!isProcessing && !error) {
    return null;
  }

  const canClose = error;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 relative">
        {/* X Button - only show on error */}
        {canClose && onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          {error ? (
            <AlertCircle className="w-6 h-6 text-red-500" />
          ) : (
            <FileText className="w-6 h-6 text-blue-500" />
          )}
          <h3 className="text-lg font-semibold text-gray-900">
            {error ? 'Processing Failed' : 'Processing Rate Confirmation'}
          </h3>
        </div>

        {/* Progress Bar */}
        {!error && (
          <div className="mb-4">
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between items-center mt-2 text-sm text-gray-600">
              <span>{progress}%</span>
              <span className="text-xs">This may take up to a minute...</span>
            </div>
          </div>
        )}

        {/* Current Step */}
        {currentStep && !error && (
          <div className="flex items-center gap-3 mb-6">
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
            <p className="text-gray-700">{currentStep.label}</p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Processing Details */}
        {!error && isProcessing && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 text-sm text-blue-800">
            <p className="font-medium mb-2">What's happening:</p>
            <ul className="space-y-1 text-xs">
              <li className={currentStep?.id === 'upload' || progress > 0 ? 'text-blue-900' : 'text-blue-600'}>
                • {progress > 0 ? '✓' : '○'} Uploading document
              </li>
              <li className={currentStep?.id === 'extract' || progress > 15 ? 'text-blue-900' : 'text-blue-600'}>
                • {progress > 15 ? '✓' : '○'} Extracting text
              </li>
              <li className={currentStep?.id === 'analyze' || progress > 30 ? 'text-blue-900 font-medium' : 'text-blue-600'}>
                • {progress > 30 ? '✓' : currentStep?.id === 'analyze' ? '⟳' : '○'} AI analysis (longest step)
              </li>
              <li className={currentStep?.id === 'parse' || progress > 60 ? 'text-blue-900' : 'text-blue-600'}>
                • {progress > 60 ? '✓' : '○'} Parsing stops and details
              </li>
              <li className={currentStep?.id === 'validate' || progress > 75 ? 'text-blue-900' : 'text-blue-600'}>
                • {progress > 75 ? '✓' : '○'} Validating data
              </li>
              <li className={currentStep?.id === 'create' || progress > 90 ? 'text-blue-900' : 'text-blue-600'}>
                • {progress > 90 ? '✓' : '○'} Creating load records
              </li>
            </ul>
          </div>
        )}

        {/* OK Button - only show on error */}
        {canClose && onClose && (
          <div className="mt-4">
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
            >
              OK
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Compact version for queued processing
export function RCProcessingCard({ filename, currentStep, progress, error, onCancel }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {error ? (
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
        ) : currentStep?.id === 'complete' ? (
          <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
        ) : (
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0 mt-0.5" />
        )}
        
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate mb-1">
            {filename}
          </p>
          
          {!error && currentStep && (
            <>
              <p className="text-xs text-gray-600 mb-2">{currentStep.label}</p>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </>
          )}
          
          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}
        </div>
        
        {!currentStep?.id === 'complete' && onCancel && (
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600"
            title="Cancel"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}