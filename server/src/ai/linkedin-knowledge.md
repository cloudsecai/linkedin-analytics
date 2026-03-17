# LinkedIn Platform Knowledge Base (2026)

Curated non-obvious facts for AI analysis. Confidence levels noted.

---

## HIGH CONFIDENCE (LinkedIn Engineering papers + large-scale studies)

### Feed Retrieval Architecture
- LinkedIn uses a fine-tuned LLaMA 3 dual encoder that generates **text-only embeddings** for both members and content. Image-only posts with thin captions are nearly invisible to candidate retrieval — the system literally cannot "see" them.
- Raw engagement counts have **-0.004 correlation with relevance** internally. LinkedIn converts all metrics to **percentile buckets (1–100)**. A post at the 90th percentile in a niche topic scores equivalently to the 90th percentile in a popular topic.
- The **Interest Graph layer can distribute up to 30% of reach** outside the creator's direct network, based on professional topic affinity. Reach beyond network is not guaranteed.
- There is **no "test audience" batch**. Feed ranking is per-viewer, per-request — every feed refresh evaluates all candidate content against that specific member's profile.

### Dwell Time
- The **P(skip) model is content-type-relative** (percentile-based, not absolute seconds). It asks: "did this hold attention longer than similar posts of its type?"
- **Clicking "see more" is a positive engagement signal** that starts/extends the dwell time clock. Posts earning the click AND holding attention past ~15 seconds get a reach multiplier.
- **Content completion rate matters more than raw engagement.** A 5-slide carousel viewed completely outperforms a 100-slide carousel with more likes.

### Comments
- Comment quality is scored via NLP/ML (XGBoost for triage, 360Brew 150B-parameter LLM for substance/lexical diversity), **not word-count heuristics**. A 5-word specific question may score higher than a 50-word generic response.
- **Threaded conversations** (replies to comments) boost reach **~2.4× vs top-level-only** comments (AuthoredUp, 621K posts).
- **Commenter identity matters.** LinkedIn's Qwen3 0.6B model generates profile embeddings encoding professional identity. Comments from people whose expertise semantically matches the post topic carry more weight.
- **Pod-like behavior** (repetitive phrasing across multiple comments) is specifically detected and devalued via lexical diversity analysis.

### Content Format
- **Single-image posts dropped 30% below text-only in 2026** — because the text-only retrieval system can't see images. Substantial captions compensate.
- Carousel optimal length: **6–9 slides** (down from 12–13 in 2024). Below 35% slide click-through, posts get a visibility penalty.
- **External links lose ~60% reach** vs native content.
- **Video views declined 36% YoY** despite increased posting. Text-only retrieval disadvantages video without rich captions/transcripts.
- Newsletters **bypass the algorithm entirely** (triple notification: email + push + in-app). Accounts with newsletters get **2.1× reach on regular posts** (halo effect).

### Topic Authority
- 360Brew requires **60–90 days of consistent posting on 2–3 focused topics** before recognizing expertise and optimizing distribution. Topic-hopping causes depressed reach.
- The system cross-references post content against the author's profile (headline, about, experience). Content misaligned with stated expertise gets suppressed.
- **80%+ of content should be within 2–3 core topics** for proper classification.

### Posting Frequency
- **Higher posting frequency = better per-post performance** (Buffer, 2M+ posts, fixed-effects regression). No cannibalization effect. The jump from 1 to 2–5 posts/week is the biggest marginal lift.
- Hashtags are essentially irrelevant for distribution in the 2026 algorithm.

---

## MEDIUM CONFIDENCE (single practitioner source or inferred)

- **Creator reply within 15 minutes gives ~90% boost** (GrowLeads). Mechanism confirmed: fresh interaction signals during the highest-weight window of the Feed SR model's recency-weighted loss function.
- **Comments are ~15× more valuable than likes** for distribution (Postiv AI, 2M posts). Mechanism confirmed but exact multiplier uncertain.
- **Quality signals (saves, thoughtful comments) are 4–6× more important than likes** under the new algorithm.
- **Peak engagement shifted to 3–8 PM** in 2026 (Buffer, 4.8M posts).
- Content can distribute for **1–3 weeks** (not just 48–72 hours) under the 2026 percentile-based freshness system.

---

## LOW CONFIDENCE (widely cited but no primary source)

- "15+ words = 2.5× comment weight" — no primary source. Likely a gradient based on semantic analysis, not a step function.
- "3+ exchanges between different participants = 5.2× amplification" — unverifiable.
- AI text detection/deprioritization — no confirmed system. LinkedIn detects GAN-generated faces (99.6% TPR) but not text.

---

## Engagement Rate Benchmarks (2026)

- Below 2%: Underperforming
- 2–3.5%: Solid / average
- 3.5–5%: Good
- Above 5%: Exceptional
- Smaller accounts (1–5K followers) typically see 4–8%
- Larger accounts (10K+) see 1–3%
- Platform-wide average: ~5.2% (inflated by carousel-heavy pages)

---

## Anti-Gaming Signals

- LinkedIn's spam system achieves 98.7% automated removal rate (LinkedIn Transparency Report, Jan–Jun 2025).
- Engagement pods explicitly prohibited. Detection uses temporal velocity analysis and network graph patterns.
