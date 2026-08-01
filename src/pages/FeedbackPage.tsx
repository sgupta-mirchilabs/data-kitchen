import { AppShell } from "../components/shell/AppShell";
export function FeedbackPage() {
  return (
    <AppShell>
      <div style={{ padding: "24px 28px" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: 8 }}>
          Feedback
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Building this next — placeholder.</div>
      </div>
    </AppShell>
  );
}
