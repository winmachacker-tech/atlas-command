# Dipsy Synthetic Evaluation

You are running a **proactive synthetic evaluation** of the Dipsy Questions Brain. This command generates test questions from Atlas docs, calls Dipsy, scores the responses, and writes results to the evaluation inbox.

**IMPORTANT: This is a read-only evaluation. Do NOT modify any code files.**

---

## Your Task

1. **Read Atlas documentation** from `atlas_docs/`
2. **Generate synthetic test questions** based on the docs
3. **Call the Dipsy questions-brain** for each question
4. **Score each response** for accuracy and grounding
5. **Write results** to `maintenance/evaluation_inbox.json`

---

## Step 1: Read Documentation

Read all markdown files in `atlas_docs/` to understand the authoritative source of truth:

```
atlas_docs/
├── load.md
├── load_statuses.md
├── driver.md
├── assignment.md
├── billing_workflow.md
├── ready_for_billing.md
├── ai/
├── billing/
├── definitions/
├── metadata/
└── operations/
```

Parse the YAML frontmatter for:
- `title` - Document title
- `domain` - Knowledge domain
- `doc_type` - Definition, Workflow, Reference, etc.
- `summary` - Brief description

---

## Step 2: Generate Test Questions

For each document, generate 2-4 synthetic questions that test Dipsy's knowledge:

### Question Types

1. **Factual recall** - "What are the valid load statuses in Atlas?"
2. **Definition** - "What is a Driver in Atlas Command?"
3. **Process/workflow** - "What are the steps in the billing workflow?"
4. **Edge cases** - "Can a load go from DELIVERED back to IN_TRANSIT?"
5. **Negative knowledge** - "Does Atlas have a COMPLETED status for loads?"
6. **Cross-reference** - "How does a driver assignment affect load status?"

### Question Template

For each question, record:
```json
{
  "id": "eval_<timestamp>_<index>",
  "source_doc": "load_statuses.md",
  "domain": "Core Workflows",
  "question_type": "factual_recall",
  "question": "What are the valid load statuses in Atlas?",
  "expected_answer_contains": ["AVAILABLE", "PENDING_PICKUP", "IN_TRANSIT", "DELIVERED", "READY_FOR_BILLING", "PROBLEM", "CANCELLED"],
  "expected_answer_excludes": ["DISPATCHED", "INVOICED", "PAID", "COMPLETED"],
  "difficulty": "easy"
}
```

---

## Step 3: Call Dipsy Questions Brain

For each question, call the Edge Function:

```bash
curl -X POST "https://tnpesnohwbwpmakvyzpn.supabase.co/functions/v1/questions-brain" \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "<question>",
    "context": {
      "source": "synthetic-eval",
      "eval_id": "<eval_id>"
    }
  }'
```

**Note:** If you cannot call the function directly (no auth), simulate the expected response structure:

```json
{
  "ok": true,
  "answer": "<dipsy's response>",
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

---

## Step 4: Score Responses

For each response, evaluate on these dimensions:

### Scoring Rubric (0.0 - 1.0)

| Dimension | Description |
|-----------|-------------|
| **accuracy** | Does the answer contain correct information per the docs? |
| **grounding** | Is every claim supported by atlas_docs? No hallucinations? |
| **completeness** | Did it address the full question? |
| **no_hallucination** | Did it avoid inventing features/statuses not in docs? |

### Scoring Logic

```
For each expected_answer_contains item:
  +0.1 if present in response

For each expected_answer_excludes item:
  -0.2 if incorrectly present in response (hallucination)

accuracy = (correct_items / total_expected)
grounding = 1.0 - (hallucination_count * 0.25)
```

### Verdict Assignment

| Score Range | Verdict |
|-------------|---------|
| >= 0.9 | `pass` |
| 0.7 - 0.89 | `soft_pass` |
| 0.5 - 0.69 | `needs_review` |
| < 0.5 | `fail` |

---

## Step 5: Write Results

Write evaluation results to `maintenance/evaluation_inbox.json`:

```json
{
  "eval_run_id": "synthetic_eval_2024-12-08T12:00:00Z",
  "run_type": "synthetic",
  "run_at": "2024-12-08T12:00:00Z",
  "docs_read": 6,
  "questions_generated": 15,
  "questions_evaluated": 15,
  "summary": {
    "pass": 10,
    "soft_pass": 3,
    "needs_review": 1,
    "fail": 1,
    "avg_accuracy": 0.85,
    "avg_grounding": 0.92
  },
  "evaluations": [
    {
      "id": "eval_1733666400_001",
      "source_doc": "load_statuses.md",
      "domain": "Core Workflows",
      "question_type": "factual_recall",
      "question": "What are the valid load statuses in Atlas?",
      "expected_answer_contains": ["AVAILABLE", "PENDING_PICKUP", "IN_TRANSIT", "DELIVERED", "READY_FOR_BILLING", "PROBLEM", "CANCELLED"],
      "expected_answer_excludes": ["DISPATCHED", "INVOICED", "PAID", "COMPLETED"],
      "dipsy_answer": "Atlas uses the following load statuses: AVAILABLE, PENDING_PICKUP, IN_TRANSIT, DELIVERED, READY_FOR_BILLING, PROBLEM, and CANCELLED.",
      "scores": {
        "accuracy": 1.0,
        "grounding": 1.0,
        "completeness": 1.0,
        "no_hallucination": 1.0
      },
      "overall_score": 1.0,
      "verdict": "pass",
      "issues": [],
      "notes": "Perfect response - all valid statuses listed, no invalid ones mentioned."
    },
    {
      "id": "eval_1733666400_002",
      "source_doc": "load_statuses.md",
      "domain": "Core Workflows",
      "question_type": "negative_knowledge",
      "question": "Is COMPLETED a valid load status in Atlas?",
      "expected_answer_contains": ["not", "no", "invalid"],
      "expected_answer_excludes": [],
      "dipsy_answer": "No, COMPLETED is not a valid load status in Atlas. The valid statuses are...",
      "scores": {
        "accuracy": 1.0,
        "grounding": 1.0,
        "completeness": 1.0,
        "no_hallucination": 1.0
      },
      "overall_score": 1.0,
      "verdict": "pass",
      "issues": [],
      "notes": "Correctly identified COMPLETED as invalid."
    }
  ],
  "flagged_for_review": [
    {
      "id": "eval_1733666400_008",
      "reason": "Mentioned DISPATCHED as a status (hallucination)",
      "priority": "high"
    }
  ],
  "recommendations": [
    "Add more training examples for billing workflow questions",
    "Review hallucination around DISPATCHED status"
  ]
}
```

---

## Sample Test Questions by Domain

### Load Statuses
1. "What are the valid load statuses in Atlas?"
2. "Is DISPATCHED a valid load status?"
3. "What status comes after DELIVERED?"
4. "Can a load be in COMPLETED status?"

### Billing Workflow
1. "What are the steps in the billing workflow?"
2. "What must happen before a load can be invoiced?"
3. "When does a load enter Ready for Billing status?"
4. "What documents are required for billing?"

### Drivers
1. "What information is stored in a Driver profile?"
2. "How are drivers linked to loads?"
3. "What is an Assignment in Atlas?"

### Cross-Domain
1. "What happens to load status when a driver is assigned?"
2. "Can billing start before delivery is confirmed?"
3. "What role do documents play in the load lifecycle?"

---

## Execution Checklist

- [ ] Read all files in `atlas_docs/`
- [ ] Generate 15-20 test questions across domains
- [ ] Include at least 3 "negative knowledge" questions (things Dipsy should NOT claim)
- [ ] Score each response using the rubric
- [ ] Flag any hallucinations with `priority: high`
- [ ] Write results to `maintenance/evaluation_inbox.json`
- [ ] Do NOT modify any code files

---

## Output Format

After running, report:

```
Synthetic Evaluation Complete
=============================
Docs Read: X
Questions Generated: X
Questions Evaluated: X

Results:
  Pass: X
  Soft Pass: X
  Needs Review: X
  Fail: X

Average Scores:
  Accuracy: X.XX
  Grounding: X.XX

Flagged Issues: X
  - [HIGH] <issue description>
  - [MEDIUM] <issue description>

Results written to: maintenance/evaluation_inbox.json
```
