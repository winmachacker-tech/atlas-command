---
title: "Load Statuses"
domain: "Core Workflows"
doc_type: "Reference"
summary: "Load Statuses represent each operational stage of a Load from creation through billing and payment."
status: "Draft"
version: "v1.0"
last_updated: "2025-12-04"
related_docs:
  - load
  - load_lifecycle
  - billing_workflow
  - ready_for_billing
---

# Load Statuses

## Summary
Load Statuses represent each stage a Load moves through during operational and billing workflows. They ensure consistency and visibility throughout the lifecycle of a shipment.

---

## Body

### Status Definitions

#### **AVAILABLE**
Load is created and ready for driver assignment.  
No driver is attached.

#### **DISPATCHED**
A driver has been assigned.  
Driver is preparing for pickup or in transit to origin.

#### **IN_TRANSIT**
Driver is moving the shipment toward delivery.

#### **DELIVERED**
Load is successfully delivered.  
Documents may still be pending.

#### **READY_FOR_BILLING**
Documents are verified and the load is ready for invoicing.

#### **INVOICED**
An invoice has been created.  
Load is now in accounts receivable.

#### **PAID**
Payment has been recorded.  
Load is financially complete.

### Typical Transitions
- AVAILABLE → DISPATCHED  
- DISPATCHED → IN_TRANSIT  
- IN_TRANSIT → DELIVERED  
- DELIVERED → READY_FOR_BILLING  
- READY_FOR_BILLING → INVOICED  
- INVOICED → PAID  

Some backwards transitions may require Admin permissions.

## Load Statuses (Authoritative List)

Atlas currently uses **only** the following load statuses:

## Authoritative Load Status List

Atlas currently uses **only** the following load statuses:

- AVAILABLE
- PENDING_PICKUP
- IN_TRANSIT
- DELIVERED
- READY_FOR_BILLING
- PROBLEM
- CANCELLED

These are the **only** valid load statuses in Atlas.

Atlas does **NOT** use the following as load statuses:

- DISPATCHED
- INVOICED
- PAID
- OPEN
- CLOSED
- COMPLETED

Those words may appear in conversations or billing flows, but they are **not** load status values in the system.


---

## Metadata

**Domain:** Core Workflows  
**Doc Type:** Reference  
**Status:** Draft  
**Last Updated:** 2025-12-04  
**Version:** v1.0  
**Related Docs:**  
- load  
- load_lifecycle  
- billing_workflow  
- ready_for_billing  
