# Dipsy Brain Maintenance & Evaluation System

You are performing maintenance on the **Dipsy Questions Brain** evaluation and training pipeline.

## System Overview

The Dipsy training pipeline ensures FAQ answers are accurate, grounded in Atlas docs, and continuously improved through human-in-the-loop review.

### Pipeline Flow

```
User Question → dipsy_interaction_log
       ↓
   [INGEST] dipsy-training-ingest
       ↓
dipsy_training_examples (status: draft)
       ↓
   [EVALUATE] dipsy-training-evaluator
       ↓
dipsy_training_evaluations + examples updated with scores
       ↓
   [REWRITE] dipsy-training-rewriter (if rewrite_recommended)
       ↓
examples.rewritten_answer populated
       ↓
   [HUMAN REVIEW] DipsyTrainingReview UI
       ↓
Approve → status: approved → embeddings generated
Reject → status: rejected
```

## Key Components

### Edge Functions (supabase/functions/)

| Function | Purpose | Auth |
|----------|---------|------|
| `dipsy-training-ingest` | Ingests interaction_log → training_examples | DIPSY_TRAINING_TOKEN |
| `dipsy-training-evaluator` | Scores Q&A pairs using GPT-4 | DIPSY_TRAINING_TOKEN |
| `dipsy-training-evaluate` | Alternative evaluator with doc grounding | User JWT |
| `dipsy-training-rewriter` | Rewrites weak answers | DIPSY_TRAINING_TOKEN |
| `dipsy-training-run` | Combined ingest + embed pipeline | User JWT |

### Database Tables

| Table | Purpose |
|-------|---------|
| `dipsy_interaction_log` | Raw Q&A interactions (agent_type = 'questions_brain') |
| `dipsy_training_examples` | Training examples with status, scores, rewrites |
| `dipsy_training_evaluations` | Detailed evaluation JSON per interaction |
| `dipsy_training_embeddings` | Vector embeddings for approved examples |
| `atlas_docs` | Source documentation for grounding checks |

### UI Component

- **`src/pages/DipsyTrainingReview.jsx`** - Human review interface for approving/rejecting examples

## Evaluation Criteria

The evaluator scores answers on 5 dimensions (0.0 - 1.0):

1. **accuracy** - Factually correct per Atlas docs
2. **grounding** - No hallucinations, no guessing
3. **clarity** - Easy to understand, well-structured
4. **completeness** - Fully addresses the question
5. **style_tone** - Matches Atlas voice (concise, professional, helpful)

### Verdicts

| Verdict | Score Range | Action |
|---------|-------------|--------|
| `excellent` | >= 0.9 | No rewrite needed |
| `good` | 0.8 - 0.9 | Minor issues only |
| `good_but_improvable` | 0.6 - 0.8 | Rewrite recommended |
| `needs_revision` | 0.3 - 0.6 | Rewrite required |
| `unsafe_or_incorrect` | < 0.3 | Critical issues, must fix |

### Hallucination Flags

Common flags set by the evaluator:
- `FABRICATED_FIELD` - Invented database fields
- `FABRICATED_STATUS_VALUE` - Made-up status values
- `UNSUPPORTED_POLICY_CLAIM` - Claims not in docs
- `OVERCONFIDENT_WHEN_DOCS_MISSING` - Should say "unknown"
- `CONTRADICTS_GOVERNANCE` - Violates stated rules
- `MISSTATES_STATUS_LIFECYCLE` - Wrong status flow

## Maintenance Tasks

### 1. Run Full Training Pipeline

```bash
# Via Supabase function (requires DIPSY_TRAINING_TOKEN)
curl -X POST "https://tnpesnohwbwpmakvyzpn.supabase.co/functions/v1/dipsy-training-run" \
  -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 50}'
```

Or from the UI: Click "Run Training Now" in DipsyTrainingReview page.

### 2. Check Pipeline Health

```sql
-- Pending examples by status
SELECT status, COUNT(*)
FROM dipsy_training_examples
GROUP BY status;

-- Recent evaluations with low scores
SELECT id, question, overall_score, verdict
FROM dipsy_training_examples
WHERE overall_score < 0.6
ORDER BY created_at DESC
LIMIT 20;

-- Examples needing rewrite but not yet rewritten
SELECT COUNT(*)
FROM dipsy_training_examples
WHERE evaluation->>'rewrite_recommended' = 'true'
  AND rewritten_answer IS NULL;

-- Hallucination flags distribution
SELECT
  jsonb_array_elements_text(hallucination_flags) as flag,
  COUNT(*)
FROM dipsy_training_examples
WHERE hallucination_flags IS NOT NULL
GROUP BY flag
ORDER BY COUNT(*) DESC;
```

### 3. Manual Ingest (single interaction)

```bash
curl -X POST "https://tnpesnohwbwpmakvyzpn.supabase.co/functions/v1/dipsy-training-ingest" \
  -H "x-atlas-training-token: <DIPSY_TRAINING_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"interaction_id": "<uuid>"}'
```

### 4. Trigger Rewriter

```bash
curl -X POST "https://tnpesnohwbwpmakvyzpn.supabase.co/functions/v1/dipsy-training-rewriter?token=<DIPSY_TRAINING_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"limit": 20}'
```

### 5. Trigger Evaluator

```bash
curl -X POST "https://tnpesnohwbwpmakvyzpn.supabase.co/functions/v1/dipsy-training-evaluator?token=<DIPSY_TRAINING_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"limit": 20}'
```

## Environment Variables Required

| Variable | Used By |
|----------|---------|
| `DIPSY_TRAINING_TOKEN` | All training functions (internal auth) |
| `OPENAI_API_KEY` | Evaluator, rewriter |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypass RLS for training tables |
| `DIPSY_TRAINING_EVAL_MODEL` | Model for evaluation (default: gpt-4.1-mini) |

## Common Issues

### No examples being ingested
- Check `dipsy_interaction_log` has rows with `agent_type = 'questions_brain'`
- Verify `question` and `answer` columns are not null
- Check if examples already exist (deduplication by interaction_id)

### Evaluator returning errors
- Verify OPENAI_API_KEY is set
- Check OpenAI API quota/limits
- Review function logs: `supabase functions logs dipsy-training-evaluator`

### Rewriter not running
- Ensure `evaluation.rewrite_recommended = true`
- Check `rewritten_answer` is NULL (won't re-rewrite)
- Verify DIPSY_TRAINING_TOKEN matches

### Low evaluation scores across the board
- Review `atlas_docs` table - may be missing key documentation
- Check if evaluator is being too strict (adjust prompts if needed)
- Ensure answers reference actual Atlas features

## Files to Review

When debugging the training pipeline, check these files:

```
supabase/functions/dipsy-training-ingest/index.ts
supabase/functions/dipsy-training-evaluator/index.ts
supabase/functions/dipsy-training-evaluate/index.ts
supabase/functions/dipsy-training-rewriter/index.ts
supabase/functions/dipsy-training-run/index.ts
src/pages/DipsyTrainingReview.jsx
```

## Evaluation History

After running maintenance, save results to:
```
maintenance/evaluation_history/YYYY-MM-DD_evaluation_run.md
```

Include:
- Total examples processed
- Score distribution
- Common issues found
- Actions taken
- Recommendations for next run
