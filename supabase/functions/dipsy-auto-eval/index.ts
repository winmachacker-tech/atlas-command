// supabase/functions/dipsy-auto-eval/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 15;

const NEGATION_PATTERNS = [
  /\bnot\s+(?:a\s+)?valid\b/i,
  /\bare\s+not\b/i,
  /\bis\s+not\b/i,
  /\bisn't\b/i,
  /\baren't\b/i,
  /\binvalid\b/i,
  /\bdo(?:es)?\s+not\s+exist\b/i,
  /\bnever\s+(?:a\s+)?valid\b/i,
  /\bshould\s+not\b/i,
  /\bcannot\s+be\b/i,
  /\bexcluded?\b/i,
];

function isInNegationContext(answer: string, term: string): boolean {
  const lowerAnswer = answer.toLowerCase();
  const lowerTerm = term.toLowerCase();
  let index = lowerAnswer.indexOf(lowerTerm);
  while (index !== -1) {
    const contextStart = Math.max(0, index - 100);
    const contextEnd = Math.min(lowerAnswer.length, index + lowerTerm.length + 100);
    const context = lowerAnswer.substring(contextStart, contextEnd);
    for (const pattern of NEGATION_PATTERNS) {
      if (pattern.test(context)) return true;
    }
    index = lowerAnswer.indexOf(lowerTerm, index + 1);
  }
  return false;
}

function detectHallucinations(answer: string, excludes: string[], knownFPs: string[] = []): string[] {
  const hallucinations: string[] = [];
  const lowerAnswer = answer.toLowerCase();
  for (const term of excludes) {
    const lowerTerm = term.toLowerCase();
    if (knownFPs.some(fp => fp.toLowerCase() === lowerTerm)) continue;
    if (lowerAnswer.includes(lowerTerm) && !isInNegationContext(answer, term)) {
      hallucinations.push('Hallucinated: ' + term);
    }
  }
  return hallucinations;
}

function calculateScores(answer: string, expectedContains: string[], expectedExcludes: string[], knownFPs: string[] = []) {
  const issues: string[] = [];
  const lowerAnswer = answer.toLowerCase();
  let foundCount = 0;
  for (const expected of expectedContains) {
    if (lowerAnswer.includes(expected.toLowerCase())) foundCount++;
    else issues.push('Missing: ' + expected);
  }
  const accuracy = expectedContains.length > 0 ? foundCount / expectedContains.length : 1.0;
  const hallucinations = detectHallucinations(answer, expectedExcludes, knownFPs);
  const grounding = Math.max(0, 1.0 - (hallucinations.length * 0.25));
  let completeness = 0.5;
  if (answer.length > 50) completeness = 0.7;
  if (answer.length > 150) completeness = 0.85;
  if (answer.length > 300) completeness = 1.0;
  const overall = (accuracy * 0.4) + (grounding * 0.4) + (completeness * 0.2);
  return { accuracy, grounding, completeness, overall, issues, hallucinations };
}

function getVerdict(overall: number): string {
  if (overall >= 0.9) return 'pass';
  if (overall >= 0.7) return 'soft_pass';
  if (overall >= 0.5) return 'needs_review';
  return 'fail';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization header');

    const body = await req.json().catch(() => ({}));
    const run_type = body.run_type || 'manual';
    const run_id = body.run_id || null;
    const offset = body.offset || 0;
    const batch_stats = body.batch_stats || null;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    const { error: authError } = await userClient.auth.getUser();
    const isServiceRole = authHeader.includes('eyJpc3MiOiJzdXBhYmFzZSI');
if (authError && !isServiceRole) throw new Error('Unauthorized');

    console.log('[dipsy-auto-eval] Starting batch at offset ' + offset);

    let currentRunId = run_id;
    if (!currentRunId) {
      const { data: runData, error: runError } = await supabase
        .from('dipsy_eval_runs')
        .insert({ run_type, run_status: 'running', started_at: new Date().toISOString() })
        .select().single();
      if (runError) throw new Error('Failed to create run: ' + runError.message);
      currentRunId = runData.id;
      console.log('[dipsy-auto-eval] Created run ' + currentRunId);
    }

    const { data: allQuestions, error: qError } = await supabase
      .from('dipsy_eval_questions').select('*').eq('is_active', true).order('created_at', { ascending: true });
    if (qError) throw new Error('Failed to fetch questions: ' + qError.message);
    if (!allQuestions || allQuestions.length === 0) throw new Error('No active test questions found');

    const totalQuestions = allQuestions.length;
    const questions = allQuestions.slice(offset, offset + BATCH_SIZE);
    console.log('[dipsy-auto-eval] Processing ' + questions.length + ' questions (' + (offset + 1) + '-' + (offset + questions.length) + ' of ' + totalQuestions + ')');

    const knownFalsePositives: Record<string, string[]> = {};
    const { data: feedback } = await supabase.from('dipsy_eval_feedback').select('question_id, false_positive_terms').eq('feedback_type', 'false_positive');
    if (feedback) {
      for (const fb of feedback) {
        if (fb.question_id && fb.false_positive_terms) knownFalsePositives[fb.question_id] = fb.false_positive_terms;
      }
    }

    const results: any[] = [];
    let passed = batch_stats?.passed || 0;
    let softPassed = batch_stats?.soft_passed || 0;
    let needsReview = batch_stats?.needs_review || 0;
    let failed = batch_stats?.failed || 0;
    let totalAccuracy = batch_stats?.total_accuracy || 0;
    let totalGrounding = batch_stats?.total_grounding || 0;

    for (const q of questions) {
      try {
        console.log('[dipsy-auto-eval] Testing: ' + q.question.substring(0, 40) + '...');
        const brainResponse = await fetch(supabaseUrl + '/functions/v1/ai-chat', {
          method: 'POST',
          headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: q.question }),
        });
        if (!brainResponse.ok) throw new Error('ai-chat returned ' + brainResponse.status);
        const brainData = await brainResponse.json();
        const dipsyAnswer = brainData.output || '';
        const questionFPs = knownFalsePositives[q.id] || [];
        const scores = calculateScores(dipsyAnswer, q.expected_contains || [], q.expected_excludes || [], questionFPs);
        const verdict = getVerdict(scores.overall);
        if (verdict === 'pass') passed++;
        else if (verdict === 'soft_pass') softPassed++;
        else if (verdict === 'needs_review') needsReview++;
        else failed++;
        totalAccuracy += scores.accuracy;
        totalGrounding += scores.grounding;
        results.push({
          run_id: currentRunId, question_id: q.id, question: q.question, dipsy_answer: dipsyAnswer,
          expected_contains: q.expected_contains, expected_excludes: q.expected_excludes,
          accuracy: scores.accuracy, grounding: scores.grounding, completeness: scores.completeness,
          overall_score: scores.overall, verdict, issues: scores.issues, hallucinations: scores.hallucinations,
        });
      } catch (err: any) {
        console.error('[dipsy-auto-eval] Error on question ' + q.id + ':', err);
        results.push({
          run_id: currentRunId, question_id: q.id, question: q.question, dipsy_answer: 'ERROR: ' + err.message,
          expected_contains: q.expected_contains, expected_excludes: q.expected_excludes,
          accuracy: 0, grounding: 0, completeness: 0, overall_score: 0, verdict: 'fail',
          issues: ['Error: ' + err.message], hallucinations: [],
        });
        failed++;
      }
    }

    const { error: insertError } = await supabase.from('dipsy_eval_results').insert(results);
    if (insertError) console.error('[dipsy-auto-eval] Error inserting results:', insertError);

    const processedSoFar = offset + questions.length;
    const hasMore = processedSoFar < totalQuestions;

    if (hasMore) {
      console.log('[dipsy-auto-eval] Chaining to next batch (offset: ' + processedSoFar + ')');
      fetch(supabaseUrl + '/functions/v1/dipsy-auto-eval', {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_type, run_id: currentRunId, offset: processedSoFar,
          batch_stats: { passed, soft_passed: softPassed, needs_review: needsReview, failed, total_accuracy: totalAccuracy, total_grounding: totalGrounding },
        }),
      }).catch(err => console.error('[dipsy-auto-eval] Chain error:', err));

      await supabase.from('dipsy_eval_runs').update({
        total_questions: totalQuestions, passed, soft_passed: softPassed, needs_review: needsReview, failed,
        avg_accuracy: totalAccuracy / processedSoFar, avg_grounding: totalGrounding / processedSoFar,
      }).eq('id', currentRunId);

      return new Response(JSON.stringify({
        success: true, run_id: currentRunId, status: 'processing',
        progress: { processed: processedSoFar, total: totalQuestions, percent: Math.round((processedSoFar / totalQuestions) * 100) },
        batch_summary: { passed, soft_passed: softPassed, needs_review: needsReview, failed },
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } else {
      const avgAccuracy = totalQuestions > 0 ? totalAccuracy / totalQuestions : 0;
      const avgGrounding = totalQuestions > 0 ? totalGrounding / totalQuestions : 0;
      await supabase.from('dipsy_eval_runs').update({
        run_status: 'completed', completed_at: new Date().toISOString(), total_questions: totalQuestions,
        passed, soft_passed: softPassed, needs_review: needsReview, failed, avg_accuracy: avgAccuracy, avg_grounding: avgGrounding,
      }).eq('id', currentRunId);
      console.log('[dipsy-auto-eval] COMPLETED. Pass: ' + passed + ', Soft: ' + softPassed + ', Review: ' + needsReview + ', Fail: ' + failed);
      return new Response(JSON.stringify({
        success: true, run_id: currentRunId, status: 'completed',
        summary: { total: totalQuestions, passed, soft_passed: softPassed, needs_review: needsReview, failed, avg_accuracy: avgAccuracy, avg_grounding: avgGrounding },
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error: any) {
    console.error('[dipsy-auto-eval] Fatal error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});