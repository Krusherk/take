import { AlertTriangle, Check, CircleHelp, Minus } from "lucide-react";
import type { EligibilityCategoryScore, IntegrityStatus } from "../../types/mechanism";

export function EligibilityEvidenceSummary({ categories }: { categories: EligibilityCategoryScore[] }) {
  return (
    <div className="eligibility-evidence-list">
      {categories.map((category) => (
        <article className="eligibility-category" key={category.categoryId}>
          <header>
            <div><span>{category.label}</span><strong>{category.earnedPoints}/{category.maximumPoints}</strong></div>
            <meter min="0" max={category.maximumPoints} value={category.earnedPoints} aria-label={`${category.label}: ${category.earnedPoints} of ${category.maximumPoints}`} />
          </header>
          <div className="eligibility-rule-list">
            {category.rules.map((rule) => (
              <div className={`eligibility-rule eligibility-rule--${rule.status.toLowerCase()}`} key={rule.ruleId}>
                {rule.status === "VERIFIED" ? <Check size={15} /> : rule.status === "PENDING_REVIEW" ? <CircleHelp size={15} /> : <Minus size={15} />}
                <span><strong>{rule.label}</strong><small>{rule.explanation}</small></span>
                <em>{rule.status === "NO_DATA" ? "NO DATA" : rule.status === "PENDING_REVIEW" ? "REVIEW" : `+${rule.pointsAwarded}`}</em>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

export function IntegritySummary({ status, reasons }: { status: IntegrityStatus; reasons: string[] }) {
  const label = status === "NO_MATERIAL_CONCERN" ? "No material concern"
    : status === "REVIEW_RECOMMENDED" ? "Review recommended"
      : status === "HIGH_CONFIDENCE_ISSUE" ? "High-confidence issue"
        : "No data";
  return (
    <section className={`integrity-summary integrity-summary--${status.toLowerCase()}`}>
      <header><span>INTEGRITY REVIEW</span><strong>{status === "NO_MATERIAL_CONCERN" ? <Check size={17} /> : <AlertTriangle size={17} />}{label}</strong></header>
      {reasons.map((reason) => <p key={reason}>{reason}</p>)}
      <small>Social closeness is context. Repeated advantageous coordination requires corroborating evidence.</small>
    </section>
  );
}
