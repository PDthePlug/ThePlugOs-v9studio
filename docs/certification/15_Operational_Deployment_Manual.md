# Executive Engineering Directive 009: Township Operational Deployment & Pilot Manual

> **Release status: superseded / not evidence.** This historical artifact contains prototype or simulated claims and cannot authorize release. See [the current release status](../operations/RELEASE_STATUS.md).

**Document ID:** DOC-CERT-DEPLOY-015  
**Classification:** Executive Architecture Artifact  
**Historical prototype status (superseded):** CERTIFIED & APPROVED
**Date:** July 2026  

---

## 1. Branch Hardware Setup Guide

To establish a resilient Local Operational Network at a township fast-food or pharmacy hub:

1. **Local Hub Placement:** Position the Primary Cashier Hub tablet on the main counter with direct Ethernet or 5GHz Wi-Fi access to the local router.
2. **Kitchen Display System (KDS):** Mount the Kitchen tablet in the food preparation area and connect to the local Wi-Fi SSID (`PlugOS-Branch-LAN`).
3. **Power Resilience (UPS/Battery Backups):** Connect the local router and Local Hub terminal to a 12V DC mini-UPS to guarantee continuous operation during township load shedding or grid power cuts.

---

## 2. Pilot Verification Checklist

Prior to opening shift:
- [x] Verify Local Hub IP is assigned (`192.168.1.100`).
- [x] Power on Cashier POS and Kitchen KDS tablets.
- [x] Confirm automatic device discovery and SHA-256 handshake.
- [x] Execute Test Transaction while WAN Internet cable is disconnected.
- [x] Verify Kitchen KDS receives test order instantly (< 5ms).
- [x] Verify Manager tablet reflects updated shift float and stock balance.
- [x] Reconnect Internet and verify outbox events synchronize automatically to Cloud.

---

## 3. Network Troubleshooting Matrix

| Symptom | Probable Cause | Corrective Action |
| :--- | :--- | :--- |
| **Kitchen KDS not receiving orders** | Local Wi-Fi router channel interference | Switch router Wi-Fi channel to 5GHz or enable BLE fallback on Cashier terminal. |
| **Device shows "DEGRADED" status** | Weak Wi-Fi signal or high packet loss | Reposition tablet closer to Local Hub or enable Wi-Fi Direct Mesh mode. |
| **Cloud Outbox depth increasing** | Township Internet drop / SIM card out of data | No action required. Operations continue offline indefinitely. Outbox flushes automatically when Internet resumes. |
