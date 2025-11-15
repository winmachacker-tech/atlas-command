import { useState, useCallback } from 'react';

const PROCESSING_STEPS = [
  { id: 'upload', label: 'Uploading rate confirmation...', duration: 1000 },
  { id: 'extract', label: 'Extracting text from PDF...', duration: 3000 },
  { id: 'analyze', label: 'Analyzing load details...', duration: 15000 },
  { id: 'parse', label: 'Parsing stops and requirements...', duration: 3000 },
  { id: 'validate', label: 'Validating carrier and facility info...', duration: 2000 },
  { id: 'create', label: 'Creating load records...', duration: 2000 },
  { id: 'complete', label: 'Load ready for review!', duration: 0 }
];

export function useRCProcessing() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const updateStep = useCallback((stepId) => {
    const stepIndex = PROCESSING_STEPS.findIndex(s => s.id === stepId);
    if (stepIndex !== -1) {
      setCurrentStep(PROCESSING_STEPS[stepIndex]);
      setProgress(Math.round((stepIndex / (PROCESSING_STEPS.length - 1)) * 100));
    }
  }, []);

  const processRateConfirmation = useCallback(async (file, apiFunction) => {
    setIsProcessing(true);
    setError(null);
    setResult(null);
    setProgress(0);

    try {
      // Step 1: Upload
      updateStep('upload');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Step 2: Extract text
      updateStep('extract');
      const formData = new FormData();
      formData.append('file', file);
      
      // Step 3: Analyze with AI (this is where OpenAI gets called)
      updateStep('analyze');
      const extractedData = await apiFunction(formData);
      
      // Step 4: Parse
      updateStep('parse');
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Step 5: Validate
      updateStep('validate');
      await new Promise(resolve => setTimeout(resolve, 600));
      
      // Step 6: Create records
      updateStep('create');
      // This would be your Supabase insert logic
      
      // Step 7: Complete
      updateStep('complete');
      setResult(extractedData);
      
      return extractedData;
      
    } catch (err) {
      setError(err.message || 'Failed to process rate confirmation');
      throw err;
    } finally {
      setIsProcessing(false);
    }
  }, [updateStep]);

  const reset = useCallback(() => {
    setIsProcessing(false);
    setCurrentStep(null);
    setProgress(0);
    setError(null);
    setResult(null);
  }, []);

  return {
    isProcessing,
    currentStep,
    progress,
    error,
    result,
    processRateConfirmation,
    reset
  };
}