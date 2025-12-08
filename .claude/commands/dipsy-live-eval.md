# Dipsy Live Evaluation

You are running a **live evaluation** of the Dipsy Questions Brain. This command reads pending test questions from the evaluation inbox, calls the live Dipsy API, scores responses, and updates the results file.

**IMPORTANT: This command modifies only `maintenance/evaluation_inbox.json`. Do NOT modify any code files.**

---

## Your Task

1. **Read** `maintenance/evaluation_inbox.json`
2. **Filter** evaluations with `verdict: "pending_live_eval"`
3. **Call** the Dipsy questions-brain endpoint for each question
4. **Score** responses against expected criteria
5. **Update** the JSON file with actual results

---

## Step 1: Read Evaluation Inbox

Read the file `maintenance/evaluation_inbox.json` and parse the JSON.

Extract all evaluations where:
```javascript
evaluation.verdict === "pending_live_eval"
```

---

## Step 2: Call Dipsy Questions Brain

For each pending evaluation, call the Edge Function using Supabase client:

### Option A: Via supabase.functions.invoke (if in browser/Node context)

```javascript
const { data, error } = await supabase.functions.invoke('questions-brain', {
  body: {
    question: evaluation.question,
    context: {
      source: 'live-eval',
      eval_id: evaluation.id
    }
  }
});
```

### Option B: Via curl (if running from CLI)

```bash
curl -X POST "https://tnpesnohwbwpmakvyzpn.supabase.co/functions/v1/questions-brain" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "<question>",
    "context": {
      "source": "live-eval",
      "eval_id": "<eval_id>"
    }
  }'
```

### Expected Response Structure

```json
{
  "ok": true,
  "answer": "Dipsy's response text...",
  "sources": {
    "training_examples": [],
    "docs": [...]
  },
  "meta": {
    "used_training_example": false,
    "org_id": "..."
  }
}
```

Store `response.answer` as `dipsy_answer` for scoring.

---

## Step 3: Score Each Response

For each response, calculate scores based on the evaluation criteria:

### Scoring Algorithm

```javascript
function scoreResponse(evaluation, dipsyAnswer) {
  const answer = dipsyAnswer.toLowerCase();

  // Count expected items found
  const expectedItems = evaluation.expected_answer_contains || [];
  let foundCount = 0;
  for (const item of expectedItems) {
    if (answer.includes(item.toLowerCase())) {
      foundCount++;
    }
  }

  // Count hallucinations (excluded items that appear)
  const excludedItems = evaluation.expected_answer_excludes || [];
  let hallucinationCount = 0;
  const hallucinations = [];
  for (const item of excludedItems) {
    if (answer.includes(item.toLowerCase())) {
      hallucinationCount++;
      hallucinations.push(item);
    }
  }

  // Calculate scores
  const accuracy = expectedItems.length > 0
    ? foundCount / expectedItems.length
    : 1.0;

  const grounding = Math.max(0, 1.0 - (hallucinationCount * 0.25));

  const no_hallucination = hallucinationCount === 0 ? 1.0 : 0.0;

  // Completeness: did it address the question meaningfully?
  const completeness = answer.length > 50 ? 1.0 : 0.5;

  // Overall score (weighted average)
  const overall = (accuracy * 0.35) + (grounding * 0.35) +
                  (no_hallucination * 0.20) + (completeness * 0.10);

  return {
    scores: {
      accuracy: Math.round(accuracy * 100) / 100,
      grounding: Math.round(grounding * 100) / 100,
      completeness: Math.round(completeness * 100) / 100,
      no_hallucination: Math.round(no_hallucination * 100) / 100
    },
    overall_score: Math.round(overall * 100) / 100,
    issues: hallucinations.map(h => `Hallucinated: ${h}`),
    found_items: expectedItems.filter(item =>
      answer.includes(item.toLowerCase())
    ),
    missing_items: expectedItems.filter(item =>
      !answer.includes(item.toLowerCase())
    )
  };
}
```

### Verdict Assignment

```javascript
function assignVerdict(overallScore, hallucinationCount) {
  // Automatic fail if any hallucinations on critical items
  if (hallucinationCount > 0) {
    return overallScore >= 0.7 ? 'soft_fail' : 'fail';
  }

  if (overallScore >= 0.9) return 'pass';
  if (overallScore >= 0.7) return 'soft_pass';
  if (overallScore >= 0.5) return 'needs_review';
  return 'fail';
}
```

---

## Step 4: Update Evaluation Record

For each evaluated question, update the record:

```javascript
evaluation.dipsy_answer = response.answer;
evaluation.scores = calculatedScores.scores;
evaluation.overall_score = calculatedScores.overall_score;
evaluation.verdict = assignedVerdict;
evaluation.issues = calculatedScores.issues;
evaluation.evaluated_at = new Date().toISOString();
evaluation.notes = generateNotes(calculatedScores);
```

### Generate Notes

```javascript
function generateNotes(result) {
  const notes = [];

  if (result.issues.length > 0) {
    notes.push(`HALLUCINATIONS DETECTED: ${result.issues.join(', ')}`);
  }

  if (result.missing_items.length > 0) {
    notes.push(`Missing expected items: ${result.missing_items.join(', ')}`);
  }

  if (result.scores.accuracy === 1.0 && result.scores.no_hallucination === 1.0) {
    notes.push('Perfect response - all criteria met.');
  }

  return notes.join(' | ');
}
```

---

## Step 5: Update Summary Statistics

After all evaluations complete, update the summary:

```javascript
const evaluations = data.evaluations;
const completed = evaluations.filter(e => e.verdict !== 'pending_live_eval');

data.summary = {
  pass: completed.filter(e => e.verdict === 'pass').length,
  soft_pass: completed.filter(e => e.verdict === 'soft_pass').length,
  needs_review: completed.filter(e => e.verdict === 'needs_review').length,
  soft_fail: completed.filter(e => e.verdict === 'soft_fail').length,
  fail: completed.filter(e => e.verdict === 'fail').length,
  pending_live_eval: evaluations.filter(e => e.verdict === 'pending_live_eval').length,
  avg_accuracy: average(completed.map(e => e.scores?.accuracy)),
  avg_grounding: average(completed.map(e => e.scores?.grounding))
};

data.last_live_eval = new Date().toISOString();
```

---

## Step 6: Write Updated Results

Write the updated JSON back to `maintenance/evaluation_inbox.json`:

```javascript
// Pretty print with 2-space indentation
const output = JSON.stringify(data, null, 2);
// Write to file
```

---

## Execution Flow

```
1. Read maintenance/evaluation_inbox.json
2. For each evaluation where verdict === "pending_live_eval":
   a. Call questions-brain with evaluation.question
   b. Store response.answer as dipsy_answer
   c. Score against expected_answer_contains (accuracy)
   d. Check for expected_answer_excludes (hallucinations)
   e. Calculate overall_score
   f. Assign verdict (pass/soft_pass/needs_review/soft_fail/fail)
   g. Record issues and notes
3. Update summary statistics
4. Write updated JSON to file
5. Report results
```

---

## Output Format

After running, report:

```
Dipsy Live Evaluation Complete
==============================
Questions Evaluated: X / Y
API Calls Made: X
API Errors: X

Results:
  Pass: X
  Soft Pass: X
  Needs Review: X
  Soft Fail: X
  Fail: X

Average Scores:
  Accuracy: X.XX
  Grounding: X.XX

Critical Failures (Hallucinations):
  - [eval_XXX] Question: "..."
    Hallucinated: DISPATCHED, COMPLETED

Missing Coverage:
  - [eval_XXX] Missing: POD, BOL

Results updated in: maintenance/evaluation_inbox.json
```

---

## Error Handling

### API Errors
If the questions-brain call fails:
```javascript
evaluation.dipsy_answer = null;
evaluation.verdict = 'api_error';
evaluation.notes = `API Error: ${error.message}`;
evaluation.evaluated_at = new Date().toISOString();
```

### Auth Errors
If 401/403 returned:
```
ERROR: Authentication failed. Ensure you have a valid session.
To fix:
1. Log into Atlas Command in your browser
2. Copy the JWT from localStorage or session
3. Set as SUPABASE_AUTH_TOKEN environment variable
```

### Rate Limiting
If many questions, add delay between calls:
```javascript
// Wait 500ms between API calls to avoid rate limiting
await new Promise(resolve => setTimeout(resolve, 500));
```

---

## Prerequisites

Before running this command:

1. **Valid Supabase session** - User must be logged into Atlas Command
2. **Org membership** - User must belong to an organization
3. **Pending evaluations** - `evaluation_inbox.json` must have `pending_live_eval` items

---

## Quick Reference

| File | Purpose |
|------|---------|
| `maintenance/evaluation_inbox.json` | Input/output - questions and results |
| `supabase/functions/questions-brain/` | Dipsy FAQ endpoint being tested |
| `atlas_docs/` | Source of truth for expected answers |

---

## Checklist

- [ ] Read `maintenance/evaluation_inbox.json`
- [ ] Filter for `pending_live_eval` verdicts
- [ ] Call questions-brain for each question
- [ ] Score responses (accuracy, grounding, hallucination)
- [ ] Assign verdicts based on scores
- [ ] Update summary statistics
- [ ] Write results back to JSON file
- [ ] Report summary to user
- [ ] Do NOT modify any code files
