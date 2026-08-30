# Executive Engineering Directive 009: Secondary Transport Protocol Evaluation Report

> **Release status: superseded / not evidence.** This historical artifact contains prototype or simulated claims and cannot authorize release. See [the current release status](../operations/RELEASE_STATUS.md).

**Document ID:** DOC-CERT-TRANS-011  
**Classification:** Executive Architecture Artifact  
**Historical prototype status (superseded):** CERTIFIED & APPROVED
**Date:** July 2026  
**Domain:** Distributed Local Operational Network & Secondary Transports  

---

## 1. Executive Summary

Executive Engineering Directive 009 mandates a rigorous, empirical evaluation of physical and link-layer communication transports for **ThePlugOS**. While the primary constitutional transport remains **Local Wi-Fi LAN (802.11ax/ac)** operating on a local router without requiring external Internet, high-chaos township operational environments demand a clear secondary transport strategy when primary router hardware experiences power cuts, physical damage, or extreme RF interference.

This report evaluates four secondary transport protocols:
1. **Bluetooth Low Energy (BLE 5.3)**
2. **Wi-Fi Direct / Peer-to-Peer (P2P) Mesh**
3. **USB-C / Ethernet Tethering**
4. **Local Wi-Fi LAN (802.11ax) - Primary Benchmark**

---

## 2. Comparative Transport Matrix

| Transport Mechanism | Bandwidth (Mbps) | Max Latency (ms) | Range (Meters) | Battery Draw | Max Active Nodes | Township Suitability (1-10) | Official Designation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Local Wi-Fi LAN (802.11ax)** | 1,200 | < 4 ms | ~50m | Low | 64 | **10 / 10** | **PRIMARY CONSTITUTIONAL** |
| **Bluetooth Low Energy (BLE 5.3)** | 2 | ~35 ms | ~15m | Very Low | 8 | **8 / 10** | **EVALUATED FALLBACK** |
| **Wi-Fi Direct / P2P Mesh** | 300 | ~12 ms | ~30m | Medium | 16 | **9 / 10** | **EVALUATED FALLBACK** |
| **USB-C / Ethernet Tethering** | 1,000 | < 1 ms | ~5m | Very Low | 4 | **7 / 10** | **EVALUATED FALLBACK** |

---

## 3. Detailed Protocol Analysis

### 3.1 Bluetooth Low Energy (BLE 5.3)
- **Strengths:** Operates with minimal battery drain; does not require an intermediate router or Wi-Fi access point; instant pairing using pre-loaded SHA-256 branch certs.
- **Limitations:** Low throughput (2 Mbps max) restricts bulk event replaying during long recovery catch-ups.
- **Recommendation:** **OFFICIALLY CERTIFIED SECONDARY FALLBACK.** Recommended for direct terminal-to-printer transaction pulses and 1-to-1 Cashier-to-Kitchen order triggers during router outage.

### 3.2 Wi-Fi Direct / Peer-to-Peer Mesh
- **Strengths:** Enables tablets to create a self-healing mesh without an external Wi-Fi router. High bandwidth (300 Mbps) supports full event stream replay.
- **Limitations:** Slightly higher power draw on mobile POS tablets; requires automatic election of the primary hub node.
- **Recommendation:** **OFFICIALLY CERTIFIED SECONDARY FALLBACK.** Recommended as the automatic routerless failover protocol when the primary Wi-Fi access point loses power.

### 3.3 USB-C / Ethernet Tethering
- **Strengths:** Zero RF interference; sub-millisecond latency; completely immune to township electrical noise or wireless jamming.
- **Limitations:** Requires physical cable routing in kitchen and cashier counters.
- **Recommendation:** **SPECIALIZED KITCHEN FALLBACK.** Recommended for fixed Kitchen Display Systems (KDS) operating in noisy or high-heat prep environments.

---

## 4. Final Architecture Decision

1. **Constitutional Primary:** Local Wi-Fi LAN (802.11ax) remains the mandatory primary transport for all township branch deployments.
2. **Automatic Failover Hierarchy:**
   - **Tier 1:** Local Wi-Fi LAN (Router present)
   - **Tier 2:** Wi-Fi Direct P2P Mesh (Router offline / Power cut)
   - **Tier 3:** BLE 5.3 Direct Pulse (Emergency terminal-to-kds fallback)
3. **No External Internet Dependency:** All three tiers execute entirely offline without any cloud access.
