---
title: "Billing Workflow"
domain: "Billing & Finance"
doc_type: "Workflow"
summary: "The Billing Workflow describes how a Load moves from delivery to invoicing and eventual payment in Atlas Command."
status: "Draft"
version: "v1.0"
last_updated: "2025-12-04"
related_docs:
  - load
  - load_statuses
  - ready_for_billing
  - invoice
---

# Billing Workflow

## Summary
The Billing Workflow outlines the steps required to convert a delivered Load into an invoice and ultimately record payment. It ensures accurate billing and prevents operational discrepancies.

---

## Body

### Billing Workflow Overview
The Billing Workflow progresses through the following steps:

1. **Delivery Completed** — The Load reaches Delivered status.  
2. **Document Upload & Verification** — POD, BOL, Rate Confirmation.  
3. **Move to Ready for Billing** — Load is verified and locked operationally.  
4. **Invoice Creation** — Billing team generates a customer invoice.  
5. **Invoice Review & Submission** — Invoice is finalized and sent.  
6. **Payment Recorded** — Once received, payment is logged in Atlas.  
7. **Load Closed** — Load becomes fully financially completed.

### Prerequisites for Billing
A Load must:

- Be in **Delivered** status  
- Have all required documents  
- Have rates and accessorials confirmed  
- Have no unresolved disputes or exceptions  

### When a Load Enters Ready for Billing
The Load becomes:

- Locked from major operational edits  
- Visible in Billing queues  
- Eligible for Invoice creation  

### Invoicing
Billing can:

- Create an invoice  
- Adjust line items  
- Add accessorials  
- Attach required documents  
- Finalize and issue the invoice  

### Payment Recording
When payment is received:

- Invoice is marked **Paid**  
- Closeout happens  
- Load becomes financially closed  

---

## Metadata

**Domain:** Billing & Finance  
**Doc Type:** Workflow  
**Status:** Draft  
**Last Updated:** 2025-12-04  
**Version:** v1.0  
**Related Docs:**  
- load  
- load_statuses  
- ready_for_billing  
- invoice  
