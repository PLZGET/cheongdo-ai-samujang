---
version: 1
slug: "web-src-app-tsx"
primary_target: "web/src/App.tsx"
related_targets: ["web/src/Orders.tsx","web/src/styles.css","web/src/Sidebar.tsx","web/src/workspace.css","web/src/orders.css"]
---

# 주문 작업함 리디자인

Mode: Operate. Scope: web/src, public guest entry and six work screens. User selected B on 2026-11-05 after requesting a Naver-like service. Preserve real processing, approval, input consent, records and exports.

## Direction contract

THESIS: A farmer reviews one customer's evidence and decisions at a time in a familiar inbox. Replace the warm card dashboard with a precise, white working surface.

OWN-WORLD: Pretendard, neutral gray navigation, white panels, thin separators, bright green identity and dark green actions. Customer rows carry names, summaries and statuses; the detail pane carries the work. No Naver trademark or affiliation.

STORY: Select a customer, read original messages and calculated facts, answer questions, then explicitly approve the shipment plan. Synthetic examples remain labeled.

FIRST VIEWPORT: A 64px product bar spans the screen above a 184px navigation rail, a 300px customer list and a flexible detail pane. Search and filters belong to the list. Actions sit beside task context. Mobile switches between list and detail with explicit back navigation and restored focus. The selected row and detail update together with a short, reduced-motion-aware transition.

FORM: B, 주문 작업함, second presented option; dealt form 6. Code-led. SEED REFERENCE: seed:36ce73d5a6afb3d2. Reference: .impeccable/mocks/decision/naver-inbox.html.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
