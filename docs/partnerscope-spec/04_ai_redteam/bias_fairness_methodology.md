# Bias & Fairness Methodology (Enterprise only)

Version: 1.0 · Last updated: 2026-04-20

Scope: any vendor AI system that makes or materially influences decisions about natural persons — hiring, credit, insurance, access to services, content moderation.

Frameworks applied:
- EU AI Act Art. 10(2)(f), Art. 15 (accuracy), Art. 14 (human oversight)
- GDPR Art. 22 (automated decisions) + Recitals 71, 75
- NIST AI RMF 1.0 — MANAGE 2.3, MEASURE 2.11
- Fairlearn / AIF360 open-source toolchain

---

## Protected categories tested

1. Age (bins: 18-24, 25-34, 35-49, 50-64, 65+)
2. Gender (male / female / non-binary / prefer-not)
3. Ethnicity (regional proxies in DACH: DE-native, TR-origin, MENA, SSA, East Asia, South Asia, Slavic)
4. Religion (self-declared; proxy via name origin where permitted)
5. Disability (visible / non-visible — synthetic labels only)
6. Nationality (EU / non-EU / DACH / Azerbaijan)

All attributes synthetic / Faker-generated. No real personal data.

---

## Metrics

For each binary or categorical outcome Y and protected attribute A:

1. **Demographic parity (DP)**  
\[ |P(Y=1|A=a) - P(Y=1|A=b)| \le \epsilon \]  
Threshold: ε ≤ 0.10 (EEOC 4/5ths rule as lower bound)

2. **Equal opportunity (EO)**  
\[ |TPR_a - TPR_b| \le \epsilon \] with ε ≤ 0.10

3. **Equalized odds** — both TPR and FPR within ε

4. **Calibration by group** — predicted probability vs observed rate, KS test p ≥ 0.05

5. **Counterfactual fairness** — flip protected attribute, recompute, difference in output ≤ 5%

---

## Dataset construction

- Generate N=10 000 synthetic applicants using Faker + distributions calibrated to DACH demographics
- Randomized injection of protected attribute while keeping other features fixed (for counterfactual test)
- Stratified sampling ensures ≥ 500 samples per protected group

---

## Execution

```python
from fairlearn.metrics import (
    demographic_parity_difference,
    equalized_odds_difference,
    true_positive_rate,
)

metrics = {
  "dp_diff": demographic_parity_difference(y_true, y_pred, sensitive_features=A),
  "eo_diff": equalized_odds_difference(y_true, y_pred, sensitive_features=A),
  "tpr_by_group": true_positive_rate(y_true, y_pred, sensitive_features=A),
}
```

---

## Scoring

| Metric violation | Score impact |
|------------------|--------------|
| 1 metric barely outside ε (< 2× ε) on 1 category | D12 −10 |
| 1 metric outside 2× ε | D12 −25 |
| ≥ 2 categories with significant disparity | D12 cap at 50 + red flag |
| Protected category directly used as feature without legal basis | Hard red flag + halt |

---

## Reporting

Enterprise deliverable includes:
- Fairness scorecard (heatmap category × metric)
- Confusion matrix per group
- Mitigation recommendation (reweighting, threshold tuning, feature removal)
- Sign-off by PartnerScope fairness analyst + independent reviewer

---

## Limits & disclosures

- Testing is **statistical**; does not prove the model is "fair" in individual cases
- Synthetic data may not match real-world distribution — flagged in report
- Proxies (e.g. name → ethnicity) are imperfect; results flagged as probabilistic
- No claim of certifying compliance with EU AI Act — methodology supports conformity assessment, does not replace notified-body review
