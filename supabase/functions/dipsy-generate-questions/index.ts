// supabase/functions/dipsy-generate-questions/index.ts
// Auto-generates test questions when new docs are added to atlas_docs
//
// Trigger: Database webhook on atlas_docs INSERT/UPDATE
// Action: AI reads doc content, generates 2-4 test questions
// Output: Inserts questions into dipsy_eval_questions

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─────────────────────────────────────────────────────────────────────────────
// QUESTION GENERATION PROMPT
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a QA engineer creating test questions for an AI assistant called Dipsy.
Dipsy answers questions about Atlas Command, a trucking Transportation Management System (TMS).

Your job: Given a documentation file, generate 2-4 test questions that verify Dipsy learned the content correctly.

Rules:
1. Questions should be answerable ONLY from the provided document
2. Include a mix of question types:
   - definition: "What is X?"
   - factual_recall: "What does X contain?" or "What are the steps in X?"
   - negative_knowledge: "Is [wrong thing] a valid X?" (answer should be no)
3. For each question, provide:
   - The question text
   - question_type: definition, factual_recall, negative_knowledge, conceptual, workflow, edge_case
   - expected_contains: array of 2-5 keywords that MUST appear in a correct answer
   - expected_excludes: array of terms that should NOT appear (for negative_knowledge questions)
   - difficulty: easy, medium, hard

Respond ONLY with valid JSON array, no markdown, no explanation:
[
  {
    "question": "What is X in Atlas?",
    "question_type": "definition",
    "expected_contains": ["keyword1", "keyword2"],
    "expected_excludes": [],
    "difficulty": "easy"
  }
]`;

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE QUESTIONS VIA OPENAI
// ─────────────────────────────────────────────────────────────────────────────
async function generateQuestions(docBody: string, docTitle: string, domain: string): Promise<any[]> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const userPrompt = `Document Title: ${docTitle}
Domain: ${domain}

Document Content:
${docBody}

Generate 2-4 test questions for this document.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${err}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || '[]';

  // Parse JSON (strip any markdown if present)
  const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[generate-questions] Failed to parse AI response:', content);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse webhook payload
    const payload = await req.json();

    // Handle both direct calls and database webhook format
    let doc;
    if (payload.record) {
      // Database webhook format
      doc = payload.record;
    } else if (payload.doc_id) {
      // Direct call with doc_id
      const { data, error } = await supabase
        .from('atlas_docs')
        .select('*')
        .eq('id', payload.doc_id)
        .single();

      if (error) throw error;
      doc = data;
    } else {
      throw new Error('Invalid payload: expected record or doc_id');
    }

    // FIX: Use doc.body (not doc.content) - that's the actual column name
    if (!doc || !doc.body) {
      console.log('[generate-questions] No body in doc, skipping');
      return new Response(
        JSON.stringify({ success: true, message: 'No content to process', questions: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[generate-questions] Processing doc: ${doc.title || doc.id}`);

    // Check if questions already exist for this doc
    const { data: existing } = await supabase
      .from('dipsy_eval_questions')
      .select('id')
      .eq('source_doc_id', doc.id);

    if (existing && existing.length > 0) {
      console.log(`[generate-questions] Questions already exist for doc ${doc.id}, skipping`);
      return new Response(
        JSON.stringify({ success: true, message: 'Questions already exist', questions: existing.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate questions - FIX: pass doc.body instead of doc.content
    const questions = await generateQuestions(
      doc.body,
      doc.title || 'Untitled',
      doc.domain || doc.topic || 'General'
    );

    if (questions.length === 0) {
      console.log('[generate-questions] No questions generated');
      return new Response(
        JSON.stringify({ success: true, message: 'No questions generated', questions: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert questions
    const questionsToInsert = questions.map(q => ({
      question: q.question,
      question_type: q.question_type || 'factual_recall',
      domain: doc.domain || doc.topic || 'General',
      expected_contains: q.expected_contains || [],
      expected_excludes: q.expected_excludes || [],
      difficulty: q.difficulty || 'medium',
      source_doc_id: doc.id,
      is_active: true,
      auto_generated: true,
    }));

    const { data: inserted, error: insertError } = await supabase
      .from('dipsy_eval_questions')
      .insert(questionsToInsert)
      .select();

    if (insertError) {
      throw insertError;
    }

    console.log(`[generate-questions] Created ${inserted?.length || 0} questions for doc ${doc.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        doc_id: doc.id,
        doc_title: doc.title,
        questions_created: inserted?.length || 0,
        questions: inserted,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[generate-questions] Error:', error);

    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});