import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function DocumentUpload({ organizationId }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      setError('Please upload a JPG, PNG, or PDF file');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB');
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(false);

    try {
      // Convert file to base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64String = reader.result.split(',')[1];
          resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      console.log('Calling extract-load-document function...');

      // Call edge function
      const { data, error: functionError } = await supabase.functions.invoke(
        'extract-load-document',
        {
          body: {
            fileBase64: base64,
            fileName: file.name,
            mimeType: file.type,
            organizationId: organizationId,
            source: 'manual_upload',
          },
        }
      );

      if (functionError) throw functionError;

      console.log('Document processed:', data);
      setSuccess(true);
      
      // Reset file input
      e.target.value = '';
      
      // Show success message briefly
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.message || 'Failed to process document');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-4">Upload Load Document</h3>
      <p className="text-sm text-gray-600 mb-4">
        Upload a BOL, rate confirmation, or load tender. AI will extract the load details.
      </p>

      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
        <input
          type="file"
          accept="image/jpeg,image/jpg,image/png,application/pdf"
          onChange={handleFileUpload}
          disabled={uploading}
          className="hidden"
          id="document-upload"
        />
        <label
          htmlFor="document-upload"
          className={`cursor-pointer inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white ${
            uploading ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {uploading ? (
            <>
              <svg
                className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Processing...
            </>
          ) : (
            'Choose File'
          )}
        </label>
        <p className="mt-2 text-xs text-gray-500">JPG, PNG, or PDF up to 10MB</p>
      </div>

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {success && (
        <div className="mt-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
          Document processed! Check the Load Drafts tab for review.
        </div>
      )}
    </div>
  );
}