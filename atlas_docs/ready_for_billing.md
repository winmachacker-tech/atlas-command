---
title: "Ready for Billing"
domain: "Billing & Finance"
doc_type: "Definition"
summary: "Ready for Billing is the state a Load enters after delivery and document verification, making it eligible for invoice creation."
status: "Draft"
version: "v1.0"
last_updated: "2025-12-04"
related_docs:
  - load
  - load_statuses
  - billing_workflow
  - document_handling_requirements
---

# Ready for Billing

## Summary
Ready for Billing indicates that a Load has completed delivery, all required documents have been received, and the load is ready for invoice generation.

---

## Body

### What is Ready for Billing?
**Ready for Billing** is a financial workflow state for a Load.  
It appears *after* delivery is completed and the supporting documents are verified.

A Load enters Ready for Billing when:

- Delivery is marked complete  
- Required documents (POD, BOL, Rate Confirmation) are uploaded  
- Load details are verified and accurate  
- Exceptions, if any, are resolved  

### Why Ready for Billing Matters
This state ensures billing accuracy and prevents premature invoicing.  
Once a Load reaches Ready for Billing:

- Operational edits may be locked  
- Billing staff can generate an invoice  
- The Load appears in Billing queues/workflows  

### Required Documents (depending on carrier)
- **POD** — Proof of Delivery  
- **BOL** — Bill of Lading  
- **Rate Confirmation** — customer pricing  
- **Accessorials** — detention, TONU, layover if applicable  

### Related Concepts
- **Load Statuses** — Delivered → Ready_for_Billing  
- **Billing Workflow** — Ready_for_Billing → Invoiced  
- **Document Handling Requirements**  

---

## Metadata

**Domain:** Billing & Finance  
**Doc Type:** Definition  
**Status:** Draft  
**Last Updated:** 2025-12-04  
**Version:** v1.0  
**Related Docs:**  
- load  
- load_statuses  
- billing_workflow  
- document_handling_requirements  
