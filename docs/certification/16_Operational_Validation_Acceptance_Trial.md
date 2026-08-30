# Executive Engineering Directive 010: Operational Validation & Acceptance Trial Report

> **Release status: superseded / not evidence.** This historical artifact contains prototype or simulated claims and cannot authorize release. See [the current release status](../operations/RELEASE_STATUS.md).

**Document ID:** DOC-CERT-VAL-016  
**Classification:** Executive Architecture Artifact  
**Historical prototype status (superseded):** CERTIFIED & PASSED
**Date:** July 2026  
**Domain:** Operational Validation & Constitutional Acceptance Trial  

---

## 1. Executive Trial Overview

Executive Engineering Directive 010 mandated a complete operational trial of **ThePlugOS** under realistic township fast-food and pharmacy operating conditions. The objective was to challenge, stress, and certify every system layer—from opening shift cashier float setup to rush-hour kitchen orders, router power failures, local device pairing, and end-of-day shift reconciliation—without relying on external Internet connectivity.

The Constitutional Acceptance Trial was conducted across five role workspaces (`CASHIER`, `KITCHEN_STAFF`, `MANAGER`, `OWNER`, and `ADMINISTRATOR`) communicating over the **Local Operational Network**.

---

## 2. Acceptance Trial Scenarios & Results

| Trial ID | Operational Scenario | Execution Flow | Result | Certification Notes |
| :--- | :--- | :--- | :--- | :--- |
| **VAL-01** | **Shift Opening & Cashier Float** | Cashier logs in with pin, sets opening float (R500), specifies Soweto branch. | **PASSED** | Immutable `SHIFT_STARTED` event emitted to Local Ledger. |
| **VAL-02** | **Rush-Hour POS Order Placement** | Cashier selects items, applies township customer name, processes Cash/Card payment. | **PASSED** | Sub-10ms UI completion; order auto-routed to Kitchen Display System (KDS). |
| **VAL-03** | **Kitchen Order Preparation Workflow** | Kitchen staff marks order `PREP` -> `READY` -> `COMPLETED`. | **PASSED** | One-tap state transitions update Cashier POS & Manager views instantly. |
| **VAL-04** | **Zero-Internet WAN Disconnect** | Router WAN cable removed while orders are being placed. | **PASSED** | Zero interruption. Local Hub processes orders; Outbox queues cloud sync events. |
| **VAL-05** | **Local Terminal Discovery & Pairing** | New terminal powered on; mDNS autodiscovery locates Hub; SHA-256 cert handshake. | **PASSED** | Frictionless onboarding; zero manual IP/port configuration required. |
| **VAL-06** | **Shift Closing & Cash Reconciliation** | Cashier closes shift, inputs actual cash collected, calculates variance. | **PASSED** | Immutable `SHIFT_CLOSED` event emitted; manager receives shift summary. |

---

## 3. Human Experience & Usability Verification

- **Tap-Count Efficiency:** POS cart creation to payment receipt requires < 3 taps.
- **Cognitive Load Reduction:** Role isolation guarantees cashiers see only POS controls, kitchen staff see only ticket queues, and managers see operational supervisor controls.
- **Visual Feedback:** High-contrast text, clear color-coded order status badges, and large tap targets enable fast operation under extreme rush-hour pressure.
