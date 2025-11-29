// src/pages/MotiveOAuthCallback.jsx
// Saves Motive OAuth tokens to motive_connections table

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

// Module-level flags - survives component remounts in StrictMode
let globalExchangeInProgress = false;
let globalExchangeCompleted = false;

export default function MotiveOAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('processing');
  const [error, setError] = useState(null);
  const [details, setDetails] = useState(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // If Motive returned an error in the URL
    if (errorParam) {
      console.error('[MotiveOAuthCallback] OAuth error from Motive:', errorParam, errorDescription);
      setStatus('error');
      setError(`Motive authorization failed: ${errorParam}`);
      setDetails(errorDescription);
      return;
    }

    // If no code present
    if (!code) {
      console.error('[MotiveOAuthCallback] No authorization code in URL');
      setStatus('error');
      setError('No authorization code received from Motive');
      return;
    }

    // MUTEX CHECK - only one exchange attempt ever
    if (globalExchangeInProgress || globalExchangeCompleted) {
      console.log('[MotiveOAuthCallback] Exchange already in progress or completed, skipping');
      return;
    }
    
    // Set flag SYNCHRONOUSLY before any async work
    globalExchangeInProgress = true;

    const exchangeCode = async () => {
      const redirectUri = `${window.location.origin}/integrations/motive/callback`;
      
      console.log('[MotiveOAuthCallback] Exchanging code via Edge Function', {
        codeSnippet: code.substring(0, 10) + '...',
        redirectUri,
      });

      try {
        // Step 1: Exchange code for tokens
        const { data, error: fnError } = await supabase.functions.invoke(
          'motive-oauth-exchange',
          {
            body: { code, redirect_uri: redirectUri },
          }
        );

        // If already completed by another call, ignore this response
        if (globalExchangeCompleted) {
          console.log('[MotiveOAuthCallback] Already completed, ignoring response');
          return;
        }

        if (fnError) {
          console.error('[MotiveOAuthCallback] Edge function error:', fnError);
          if (!globalExchangeCompleted) {
            globalExchangeInProgress = false;
            setStatus('error');
            setError('OAuth exchange failed');
            setDetails(fnError.message || JSON.stringify(fnError));
          }
          return;
        }

        console.log('[MotiveOAuthCallback] Exchange response:', data);

        if (data?.ok && data?.access_token) {
          console.log('[MotiveOAuthCallback] SUCCESS! Got access token');
          console.log('[MotiveOAuthCallback] Token expires in:', data.expires_in, 'seconds');
          
          // Step 2: Get current user
          const { data: { user }, error: userError } = await supabase.auth.getUser();
          if (userError || !user) {
            console.error('[MotiveOAuthCallback] Failed to get user:', userError);
            globalExchangeInProgress = false;
            setStatus('error');
            setError('Failed to get current user');
            setDetails(userError?.message);
            return;
          }

          // Step 3: Get user's org from team_members
          const { data: membership, error: orgError } = await supabase
            .from('team_members')
            .select('org_id')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .limit(1)
            .single();

          if (orgError || !membership) {
            console.error('[MotiveOAuthCallback] Failed to get org:', orgError);
            globalExchangeInProgress = false;
            setStatus('error');
            setError('Failed to get organization');
            setDetails(orgError?.message || 'No organization membership found');
            return;
          }
          
          const activeOrg = membership;

          // Step 4: Calculate expiration time
          const expiresAt = new Date(Date.now() + (data.expires_in * 1000)).toISOString();

          // Step 5: Upsert to motive_connections (update if exists, insert if not)
          const { error: upsertError } = await supabase
            .from('motive_connections')
            .upsert({
              org_id: activeOrg.org_id,
              connected_by: user.id,
              access_token: data.access_token,
              refresh_token: data.refresh_token,
              token_type: data.token_type || 'Bearer',
              scope: data.scope,
              expires_at: expiresAt,
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'org_id'
            });

          if (upsertError) {
            console.error('[MotiveOAuthCallback] Failed to save tokens:', upsertError);
            globalExchangeInProgress = false;
            setStatus('error');
            setError('Failed to save Motive connection');
            setDetails(upsertError.message);
            return;
          }

          // Mark as completed
          globalExchangeCompleted = true;
          globalExchangeInProgress = false;
          
          console.log('[MotiveOAuthCallback] Tokens saved successfully!');
          setStatus('success');
          
          // Redirect after showing success
          setTimeout(() => {
            navigate('/integrations?motive=connected');
          }, 1500);
          
        } else if (data?.error) {
          console.error('[MotiveOAuthCallback] Motive API error:', data);
          if (!globalExchangeCompleted) {
            globalExchangeInProgress = false;
            setStatus('error');
            setError(data.error);
            setDetails(data.motive_error_description || data.motive_error || JSON.stringify(data));
          }
        } else {
          console.error('[MotiveOAuthCallback] Unexpected response:', data);
          if (!globalExchangeCompleted) {
            globalExchangeInProgress = false;
            setStatus('error');
            setError('Unexpected response from OAuth exchange');
            setDetails(JSON.stringify(data, null, 2));
          }
        }
      } catch (err) {
        console.error('[MotiveOAuthCallback] Exception:', err);
        if (!globalExchangeCompleted) {
          globalExchangeInProgress = false;
          setStatus('error');
          setError('Failed to complete OAuth exchange');
          setDetails(err.message);
        }
      }
    };

    exchangeCode();
    
    // Cleanup: reset flags when navigating away
    return () => {
      setTimeout(() => {
        if (window.location.pathname !== '/integrations/motive/callback') {
          globalExchangeInProgress = false;
          globalExchangeCompleted = false;
        }
      }, 100);
    };
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full p-8 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
        {status === 'processing' && (
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Connecting to Motive...
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Please wait while we complete the authorization.
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Successfully Connected!
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Motive has been connected to Atlas Command. Redirecting...
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Connection Failed
            </h2>
            <p className="text-red-600 dark:text-red-400 mb-2">
              {error}
            </p>
            {details && (
              <pre className="text-left text-xs bg-gray-100 dark:bg-gray-700 p-3 rounded overflow-auto max-h-40 mb-4">
                {details}
              </pre>
            )}
            <button
              onClick={() => navigate('/integrations')}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
            >
              Back to Integrations
            </button>
          </div>
        )}
      </div>
    </div>
  );
}