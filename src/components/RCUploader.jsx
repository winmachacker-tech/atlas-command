import React, { useState } from 'react';
import { Upload, FileText, AlertCircle } from 'lucide-react';
import { useRCProcessing } from '../hooks/useRCProcessing';
import { RCProcessingProgress } from './RCProcessingProgress';
import { processRateConfirmation } from '../api/processRC';
import { createLoadFromOCR } from '../api/createLoadFromOCR';

export default function RCUploader({ onLoadCreated }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [isCreatingLoad, setIsCreatingLoad] = useState(false);
  const { 
    isProcessing, 
    currentStep, 
    progress, 
    error, 
    result,
    processRateConfirmation: process,
    reset 
  } = useRCProcessing();

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    
    // Accept both PDFs and images
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp'
    ];
    
    if (file && allowedTypes.includes(file.type)) {
      setSelectedFile(file);
    } else {
      alert('Please select a PDF or image file (JPG, PNG, WEBP)');
    }
  };

  const handleProcess = async () => {
    if (!selectedFile) return;

    try {
      const extractedData = await process(selectedFile, async (formData) => {
        return await processRateConfirmation(formData);
      });

      console.log('Extracted data:', extractedData);
      
    } catch (err) {
      console.error('Failed to process RC:', err);
      // Error is already set in the hook, modal will show it with OK button
    }
  };

  const handleCreateLoad = async () => {
    if (!result) return;

    setIsCreatingLoad(true);
    try {
      const newLoad = await createLoadFromOCR(result);
      
      // Call parent callback with new load
      if (onLoadCreated) {
        onLoadCreated(newLoad);
      }
      
      // Show success message
      alert(`Load ${newLoad.load_number || newLoad.reference} created successfully!`);
      
      // Reset to allow processing another RC
      handleReset();
      
    } catch (err) {
      console.error('Failed to create load:', err);
      alert(`Error creating load: ${err.message}`);
    } finally {
      setIsCreatingLoad(false);
    }
  };

  const handleReset = () => {
    reset();
    setSelectedFile(null);
  };

  return (
    <div className="w-full">
      {/* Upload Area - Compact */}
      {!selectedFile && !result && (
        <div className="border-2 border-dashed border-white/20 rounded-lg p-4 text-center hover:border-amber-500/40 transition-colors bg-white/5">
          <Upload className="w-6 h-6 text-white/40 mx-auto mb-2" />
          <label className="cursor-pointer">
            <span className="text-blue-400 hover:text-blue-300 font-medium text-sm">
              Upload Rate Confirmation
            </span>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/jpg,image/png,image/webp,application/pdf"
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>
          <p className="text-xs text-white/50 mt-1">PDF or image files (JPG, PNG, WEBP)</p>
        </div>
      )}

      {/* Selected File - Ready to Process */}
      {selectedFile && !isProcessing && !result && (
        <div className="border border-white/10 rounded-lg p-3 bg-white/5">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-5 h-5 text-blue-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-white truncate">{selectedFile.name}</p>
              <p className="text-xs text-white/50">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={handleProcess}
              className="flex-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
            >
              Process
            </button>
            <button
              onClick={handleReset}
              className="px-3 py-1.5 border border-white/10 text-white/70 rounded-lg hover:bg-white/5 transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Processing Modal */}
      <RCProcessingProgress
        currentStep={currentStep}
        progress={progress}
        error={error}
        isProcessing={isProcessing}
        onClose={handleReset}
      />

      {/* Results */}
      {result && !error && (
        <div className="border border-emerald-500/30 bg-emerald-500/10 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              ✓
            </div>
            <h3 className="text-base font-semibold text-emerald-300">
              Rate Confirmation Processed!
            </h3>
          </div>
          
          <div className="bg-white/5 rounded border border-white/10 p-4 mb-3 space-y-4 max-h-[500px] overflow-auto">
            {/* Load Info */}
            <div>
              <h4 className="font-semibold text-white/90 mb-2 text-xs uppercase tracking-wide">Load Information</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-white/60">Load Number:</span>
                  <p className="font-medium text-white">{result.load_number || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-white/60">Rate:</span>
                  <p className="font-medium text-white">${result.rate?.toLocaleString() || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-white/60">Equipment:</span>
                  <p className="font-medium text-white">{result.equipment || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-white/60">Commodity:</span>
                  <p className="font-medium text-white">{result.commodity || 'N/A'}</p>
                </div>
              </div>
            </div>

            {/* Broker Info */}
            {result.broker && (
              <div className="border-t border-white/10 pt-3">
                <h4 className="font-semibold text-white/90 mb-2 text-xs uppercase tracking-wide">Broker</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-white/60">Name:</span>
                    <p className="font-medium text-white">{result.broker.name || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-white/60">Contact:</span>
                    <p className="font-medium text-white">{result.broker.contact || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-white/60">Phone:</span>
                    <p className="font-medium text-white">{result.broker.phone || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-white/60">Email:</span>
                    <p className="font-medium text-white text-xs break-all">{result.broker.email || 'N/A'}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Carrier Info */}
            {result.carrier && (
              <div className="border-t border-white/10 pt-3">
                <h4 className="font-semibold text-white/90 mb-2 text-xs uppercase tracking-wide">Carrier</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-white/60">Name:</span>
                    <p className="font-medium text-white">{result.carrier.name || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-white/60">MC Number:</span>
                    <p className="font-medium text-white">{result.carrier.mc_number || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-white/60">DOT Number:</span>
                    <p className="font-medium text-white">{result.carrier.dot_number || 'N/A'}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Temperature Info */}
            {result.temperature && (result.temperature.mode || result.temperature.reefer_temp) && (
              <div className="border-t border-white/10 pt-3">
                <h4 className="font-semibold text-white/90 mb-2 text-xs uppercase tracking-wide">Temperature Requirements</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {result.temperature.mode && (
                    <div>
                      <span className="text-white/60">Mode:</span>
                      <p className="font-medium text-white">{result.temperature.mode}</p>
                    </div>
                  )}
                  {result.temperature.reefer_temp && (
                    <div>
                      <span className="text-white/60">Reefer Temp:</span>
                      <p className="font-medium text-white">{result.temperature.reefer_temp}°F</p>
                    </div>
                  )}
                  {result.temperature.product_temp && (
                    <div>
                      <span className="text-white/60">Product Temp:</span>
                      <p className="font-medium text-white">{result.temperature.product_temp}°F</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Stops */}
            {result.stops && result.stops.length > 0 && (
              <div className="border-t border-white/10 pt-3">
                <h4 className="font-semibold text-white/90 mb-2 text-xs uppercase tracking-wide">Stops ({result.stops.length})</h4>
                <div className="space-y-2">
                  {result.stops.map((stop, index) => (
                    <div key={index} className="bg-white/5 rounded p-3 border border-white/10">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          stop.type === 'pickup' ? 'bg-blue-500/20 text-blue-300' : 'bg-emerald-500/20 text-emerald-300'
                        }`}>
                          {stop.type === 'pickup' ? 'PICKUP' : 'DELIVERY'} #{stop.stop_number}
                        </span>
                        {stop.strict && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-300">
                            STRICT
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div>
                          <span className="text-white/60">Facility:</span>
                          <p className="font-medium text-white">{stop.facility_name || 'N/A'}</p>
                        </div>
                        <div>
                          <span className="text-white/60">Address:</span>
                          <p className="text-white">
                            {stop.address}<br />
                            {stop.city}, {stop.state} {stop.zip}
                          </p>
                        </div>
                        <div>
                          <span className="text-white/60">Appointment:</span>
                          <p className="font-medium text-white">
                            {stop.appointment ? new Date(stop.appointment).toLocaleString() : 'N/A'}
                          </p>
                        </div>
                        {stop.reference_numbers && stop.reference_numbers.length > 0 && (
                          <div>
                            <span className="text-white/60">References:</span>
                            <p className="text-white">{stop.reference_numbers.join(', ')}</p>
                          </div>
                        )}
                        {stop.special_instructions && (
                          <div>
                            <span className="text-white/60">Instructions:</span>
                            <p className="text-white text-xs">{stop.special_instructions}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Special Requirements */}
            {result.special_requirements && result.special_requirements.length > 0 && (
              <div className="border-t border-white/10 pt-3">
                <h4 className="font-semibold text-white/90 mb-2 text-xs uppercase tracking-wide">Special Requirements</h4>
                <ul className="list-disc list-inside text-xs text-white/80 space-y-1">
                  {result.special_requirements.map((req, index) => (
                    <li key={index}>{req}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Warnings */}
            {result.warnings && result.warnings.length > 0 && (
              <div className="border-t border-white/10 pt-3">
                <h4 className="font-semibold text-red-300 mb-2 text-xs uppercase tracking-wide flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Warnings
                </h4>
                <ul className="space-y-1.5">
                  {result.warnings.map((warning, index) => (
                    <li key={index} className="bg-red-500/10 border border-red-500/30 rounded p-2 text-xs text-red-300">
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={handleCreateLoad}
              disabled={isCreatingLoad}
              className="flex-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
            >
              {isCreatingLoad ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating...
                </>
              ) : (
                'Create Load'
              )}
            </button>
            <button
              onClick={handleReset}
              className="px-3 py-1.5 border border-white/10 text-white/70 rounded-lg hover:bg-white/5 text-sm"
            >
              Process Another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}