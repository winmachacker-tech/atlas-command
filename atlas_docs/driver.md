---
title: "Driver"
domain: "Drivers"
doc_type: "Definition"
summary: "A Driver represents the individual responsible for hauling freight in Atlas Command. Driver profiles store identity, equipment, documents, and status information."
status: "Draft"
version: "v1.0"
last_updated: "2025-12-04"
related_docs:
  - load
  - assignment
  - load_statuses
  - billing_workflow
---

# Driver

## Summary
A Driver in Atlas Command represents the person responsible for transporting freight. Driver profiles include identity details, equipment, compliance documents, and information required for dispatching and billing operations.

---

## Body

### What is a Driver?
A **Driver** is an operational entity representing an individual who hauls loads.  
The Driver record contains:

- Name  
- Contact information  
- Assigned truck (optional)  
- Documents (CDL, medical card, W9, insurance, etc.)  
- Availability  
- Status  
- Assignment history  

### Where Drivers Are Used
Drivers interact with many key parts of Atlas Command:

- **Assignments**  
- **Load Lifecycle**  
- **HOS / Movement tracking**  
- **Dispatch operations**  
- **Ready for Billing workflow**  
- **Document handling**  

### Related Concepts
- **Load** — the shipment the driver hauls  
- **Assignment** — the link between a driver and their load  
- **Truck** — the unit they operate (if applicable)  
- **Documents** — compliance requirements for carriers  

---

## Metadata

**Domain:** Drivers  
**Doc Type:** Definition  
**Status:** Draft  
**Last Updated:** 2025-12-04  
**Version:** v1.0  
**Related Docs:**  
- load  
- assignment  
- load_statuses  
- billing_workflow  
