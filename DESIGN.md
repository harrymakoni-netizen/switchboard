# Switchboard design

## Purpose and use scene

A buyer uses a normal browser, often on a phone in daylight, to compare home-repair quotes and control a booking. This is an Operate interface: familiar controls, clear states, and readable money come first.

## Built visual system

- Public Sans variable, self-hosted with OFL license. Body 15px; home title scales 38–66px; job title 28–34px; data uses tabular figures.
- Cobalt header `#1837a0`; primary action `#1e44bb`; text `#192b44`; secondary text `#59697a`; cool ground `#f1f5f8`; white work surfaces.
- Green is reserved for progress and selected business; amber marks uncertain quotes; red marks errors and cancellation.
- Header includes a compact authored switchboard connection mark. The progress line is the signature connection motif, carrying actual job state.
- The request form has a single clear action. The quote board is the main job workspace; the payment panel sits alongside it on desktop and below it on mobile.
- AG Grid retains full comparison columns with horizontal scrolling. Actions are unpinned on compact screens so business and price remain readable.
- Hover, focus, loading, disabled, empty, and error states are explicit. The drawer supports Escape, focused close control, and focus return. Reduced motion is respected.

## Verification

Production build; browser checks for request→quotes→approval, completion, cancellation, not-done, and session isolation. Desktop and 375px screenshots were reviewed. The mechanical detector flagged the original Arial choice; it was replaced by self-hosted Public Sans. No stock imagery is needed for this utility interface. Shipping screenshots show synthetic mock data.

Final rendered review: desktop home and completed-job screens, plus the 375px quote board, were inspected. Mobile keeps business and price visible and scrolls the remaining grid columns. Verdict: ready for the M6 mock-demo scope; real-service and hosted acceptance remain open.

## Hackathon refinement — 5 November 2026

The incumbent cobalt, Public Sans, light workspace, and restrained green state feedback are preserved. The demo notice states the actual configured simulation/payment modes and links to a dedicated walkthrough. Synthetic ratings and transcripts are identified as demo content.

On screens up to 650px, a complete provider list replaces horizontal grid scrolling: price, appointment, inclusions, guarantee, time-window conflicts, transcript, and booking controls stay together. Desktop retains AG Grid, including user-selected sorting with uncertain quotes kept last. After choosing a provider, the mobile payment panel precedes the comparison list. All seven progress steps fit on a 375px screen.

The booking summary repeats the chosen provider, quote, and confirmed appointment. Payment copy presents the two explicit approvals; provider references remain available under Payment activity rather than dominating the panel. Transcript request failures have a retry action, Escape works after recovery, and focus returns to the opener.

Verification uses ten browser scenarios and rendered desktop/mobile captures. The manual design detector reported no findings. The captures use fully mocked provider mode and do not imply fresh PayPal/Gemini availability or working live phone conversations.
