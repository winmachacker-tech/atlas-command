// supabase/functions/dipsy-auto-eval/index.ts
// Dipsy Quality Evaluation - Automated Testing with Learning Feedback Loop
// 
// Features:
// - Negation-aware hallucination detection
// - Learns from human feedback on false positives
// - Supports scheduled and manual runs

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// NEGATION PATTERNS - Terms that indicate something is NOT true
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const NEGATION_PATTERNS = [
  /\bnot\s+(?:a\s+)?valid\b/i,
  /\bare\s+not\b/i,
  /\bis\s+not\b/i,
  /\bisn't\b/i,
  /\baren't\b/i,
  /\bnot\s+(?:actually\s+)?(?:a\s+)?(?:real|actual|true|correct)\b/i,
  /\binvalid\b/i,
  /\bdo(?:es)?\s+not\s+exist\b/i,
  /\bnever\s+(?:a\s+)?valid\b/i,
  /\bshould\s+not\b/i,
  /\bcannot\s+be\b/i,
  /\bwon't\s+(?:be\s+)?(?:accepted|valid|recognized)\b/i,
  /\bexcluded?\b/i,
  /\bnot\s+(?:one\s+of\s+)?the\s+(?:valid|actual|real)\b/i,
];

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CHECK IF TERM APPEARS IN NEGATION CONTEXT
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function isInNegationContext(answer: string, term: string): boolean {
  const lowerAnswer = answer.toLowerCase();
  const lowerTerm = term.toLowerCase();
  
  // Find all occurrences of the term
  let index = lowerAnswer.indexOf(lowerTerm);
  
  while (index !== -1) {
    // Get surrounding context (100 chars before and after)
    const contextStart = Math.max(0, index - 100);
    const contextEnd = Math.min(lowerAnswer.length, index + lowerTerm.length + 100);
    const context = lowerAnswer.substring(contextStart, contextEnd);
    
    // Check if any negation pattern appears in this context
    for (const pattern of NEGATION_PATTERNS) {
      if (pattern.test(context)) {
        return true; // Term is being negated, not a hallucination
      }
    }
    
    // Look for next occurrence
    index = lowerAnswer.indexOf(lowerTerm, index + 1);
  }
  
  return false; // Term appears without negation = potential hallucination
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DETECT HALLUCINATIONS (with negation awareness)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function detectHallucinations(
  answer: string,
  excludes: string[],
  knownFalsePositives: string[] = []
): string[] {
  const hallucinations: string[] = [];
  const lowerAnswer = answer.toLowerCase();

  for (const term of excludes) {
    const lowerTerm = term.toLowerCase();
    
    // Skip if this term was previously marked as a false positive
    if (knownFalsePositives.some(fp => fp.toLowerCase() === lowerTerm)) {
      continue;
    }
    
    // Check if term appears in the answer
    if (lowerAnswer.includes(lowerTerm)) {
      // Check if it's in a negation context
      if (!isInNegationContext(answer, term)) {
        hallucinations.push(`Hallucinated: ${term}`);
      }
      // If in negation context, Dipsy is correctly saying it's NOT valid - no hallucination
    }
  }

  return hallucinations;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CALCULATE SCORES
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function calculateScores(
  answer: string,
  expectedContains: string[],
  expectedExcludes: string[],
  knownFalsePositives: string[] = []
): {
  accuracy: number;
  grounding: number;
  completeness: number;
  overall: number;
  issues: string[];
  hallucinations: string[];
} {
  const issues: string[] = [];
  const lowerAnswer = answer.toLowerCase();

  // ACCURACY: How many expected items were found?
  let foundCount = 0;
  for (const expected of expectedContains) {
    if (lowerAnswer.includes(expected.toLowerCase())) {
      foundCount++;
    } else {
      issues.push(`Missing: ${expected}`);
    }
  }
  const accuracy = expectedContains.length > 0 
    ? foundCount / expectedContains.length 
    : 1.0;

  // GROUNDING: Check for hallucinations (negation-aware)
  const hallucinations = detectHallucinations(answer, expectedExcludes, knownFalsePositives);
  const grounding = Math.max(0, 1.0 - (hallucinations.length * 0.25));

  // COMPLETENESS: Based on answer length and structure
  let completeness = 0.5;
  if (answer.length > 50) completeness = 0.7;
  if (answer.length > 150) completeness = 0.85;
  if (answer.length > 300) completeness = 1.0;
  
  // Bonus for structured answers
  if (answer.includes('-') || answer.includes('â€¢') || answer.includes('\n')) {
    completeness = Math.min(1.0, completeness + 0.1);
  }

  // OVERALL: Weighted average (accuracy and grounding matter most)
  const overall = (accuracy * 0.4) + (grounding * 0.4) + (completeness * 0.2);

  return { accuracy, grounding, completeness, overall, issues, hallucinations };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DETERMINE VERDICT
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getVerdict(overall: number): string {
  if (overall >= 0.9) return 'pass';
  if (overall >= 0.7) return 'soft_pass';
  if (overall >= 0.5) return 'needs_review';
  return 'fail';
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// MAIN HANDLER
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Parse request body
    const { run_type = 'manual' } = await req.json().catch(() => ({}));

    // Create Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Service client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user is authenticated
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError && !authHeader.includes('service_role')) { throw new Error('Unauthorized'); }

    console.log(`[dipsy-auto-eval] Starting ${run_type} evaluation for user ${user.id}`);

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // STEP 1: Create evaluation run record
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { data: runData, error: runError } = await supabase
      .from('dipsy_eval_runs')
      .insert({
        run_type,
        run_status: 'running',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (runError) {
      throw new Error(`Failed to create run: ${runError.message}`);
    }

    const runId = runData.id;
    console.log(`[dipsy-auto-eval] Created run ${runId}`);

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // STEP 2: Fetch active test questions
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { data: questions, error: qError } = await supabase
      .from('dipsy_eval_questions')
      .select('*')
      .eq('is_active', true);

    if (qError) {
      throw new Error(`Failed to fetch questions: ${qError.message}`);
    }

    if (!questions || questions.length === 0) {
      throw new Error('No active test questions found');
    }

    console.log(`[dipsy-auto-eval] Found ${questions.length} questions`);

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // STEP 3: Fetch known false positives from feedback
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let knownFalsePositives: Record<string, string[]> = {};
    
    const { data: feedback } = await supabase
      .from('dipsy_eval_feedback')
      .select('question_id, false_positive_terms')
      .eq('feedback_type', 'false_positive');

    if (feedback) {
      for (const fb of feedback) {
        if (fb.question_id && fb.false_positive_terms) {
          knownFalsePositives[fb.question_id] = fb.false_positive_terms;
        }
      }
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // STEP 4: Call questions-brain for each question
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const results: any[] = [];
    let passed = 0, softPassed = 0, needsReview = 0, failed = 0;
    let totalAccuracy = 0, totalGrounding = 0;

    for (const q of questions) {
      try {
        console.log(`[dipsy-auto-eval] Testing: ${q.question.substring(0, 50)}...`);

        // Call questions-brain Edge Function
        const brainResponse = await fetch(`${supabaseUrl}/functions/v1/ai-chat`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prompt: q.question }),
        });

        if (!brainResponse.ok) {
          throw new Error(`questions-brain returned ${brainResponse.status}`);
        }

        const brainData = await brainResponse.json();
        const dipsyAnswer = brainData.output || '';

        // Get false positives for this specific question
        const questionFPs = knownFalsePositives[q.id] || [];

        // Calculate scores with negation awareness
        const scores = calculateScores(
          dipsyAnswer,
          q.expected_contains || [],
          q.expected_excludes || [],
          questionFPs
        );

        const verdict = getVerdict(scores.overall);

        // Track counts
        if (verdict === 'pass') passed++;
        else if (verdict === 'soft_pass') softPassed++;
        else if (verdict === 'needs_review') needsReview++;
        else failed++;

        totalAccuracy += scores.accuracy;
        totalGrounding += scores.grounding;

        // Store result
        results.push({
          run_id: runId,
          question_id: q.id,
          question: q.question,
          dipsy_answer: dipsyAnswer,
          expected_contains: q.expected_contains,
          expected_excludes: q.expected_excludes,
          accuracy: scores.accuracy,
          grounding: scores.grounding,
          completeness: scores.completeness,
          overall_score: scores.overall,
          verdict,
          issues: scores.issues,
          hallucinations: scores.hallucinations,
        });

      } catch (err) {
        console.error(`[dipsy-auto-eval] Error on question ${q.id}:`, err);
        
        results.push({
          run_id: runId,
          question_id: q.id,
          question: q.question,
          dipsy_answer: `ERROR: ${err.message}`,
          expected_contains: q.expected_contains,
          expected_excludes: q.expected_excludes,
          accuracy: 0,
          grounding: 0,
          completeness: 0,
          overall_score: 0,
          verdict: 'fail',
          issues: [`Error: ${err.message}`],
          hallucinations: [],
        });
        failed++;
      }
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // STEP 5: Store all results
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { error: insertError } = await supabase
      .from('dipsy_eval_results')
      .insert(results);

    if (insertError) {
      console.error('[dipsy-auto-eval] Error inserting results:', insertError);
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // STEP 6: Update run with final stats
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const avgAccuracy = questions.length > 0 ? totalAccuracy / questions.length : 0;
    const avgGrounding = questions.length > 0 ? totalGrounding / questions.length : 0;

    await supabase
      .from('dipsy_eval_runs')
      .update({
        run_status: 'completed',
        completed_at: new Date().toISOString(),
        total_questions: questions.length,
        passed,
        soft_passed: softPassed,
        needs_review: needsReview,
        failed,
        avg_accuracy: avgAccuracy,
        avg_grounding: avgGrounding,
      })
      .eq('id', runId);

    console.log(`[dipsy-auto-eval] Completed. Pass: ${passed}, Soft: ${softPassed}, Review: ${needsReview}, Fail: ${failed}`);

    return new Response(
      JSON.stringify({
        success: true,
        run_id: runId,
        summary: {
          total: questions.length,
          passed,
          soft_passed: softPassed,
          needs_review: needsReview,
          failed,
          avg_accuracy: avgAccuracy,
          avg_grounding: avgGrounding,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[dipsy-auto-eval] Fatal error:', error);
    
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});



