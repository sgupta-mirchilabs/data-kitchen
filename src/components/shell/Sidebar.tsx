import { Link, useLocation } from "react-router-dom";
import {
  UploadCloud, ShoppingBag, GitMerge, AlertTriangle,
  Send, MessageSquareWarning, Settings, ChevronRight, Flame,
} from "lucide-react";

const NAV = [
  { href: "/intake", label: "Catalog Intake", Icon: UploadCloud, badge: null, badgeColor: "" },
  { href: "/readiness", label: "Retailer Readiness", Icon: ShoppingBag, badge: null, badgeColor: "" },
  { href: "/mapping", label: "Mapping Studio", Icon: GitMerge, badge: "3", badgeColor: "default" },
  { href: "/validation", label: "Validation & Exceptions", Icon: AlertTriangle, badge: "5", badgeColor: "red" },
  { href: "/delivery", label: "Delivery", Icon: Send, badge: null, badgeColor: "" },
  { href: "/feedback", label: "Retail Feedback", Icon: MessageSquareWarning, badge: "2", badgeColor: "amber" },
];

export function Sidebar() {
  const { pathname } = useLocation();

  return (
    <aside style={{
      width: 220, minWidth: 220, background: "var(--surface)",
      borderRight: "1px solid var(--border)", display: "flex",
      flexDirection: "column", height: "100vh", position: "fixed",
      top: 0, left: 0, zIndex: 50,
    }}>
      {/* Logo */}
      <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 28, height: 28, background: "var(--mirchi)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Flame size={14} color="white" strokeWidth={2.5} />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: "0.08em", color: "var(--text-primary)", textTransform: "uppercase" }}>Data Kitchen</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em" }}>Mirchi Labs</div>
        </div>
      </div>

      {/* Session */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-raised)" }}>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, letterSpacing: "0.06em", textTransform: "uppercase" }}>Active Session</div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Product360_Export_2026-07-31.xlsx</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>6 products · Walmart schema</div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
        {NAV.map(({ href, label, Icon, badge, badgeColor }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link key={href} to={href} style={{ textDecoration: "none", display: "block" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "7px 12px", margin: "1px 8px", borderRadius: 6,
                background: active ? "var(--mirchi-dim)" : "transparent",
                border: active ? "1px solid var(--mirchi-glow)" : "1px solid transparent",
                color: active ? "var(--mirchi)" : "var(--text-secondary)",
                cursor: "pointer", transition: "all 0.1s ease",
              }}>
                <Icon size={14} strokeWidth={active ? 2.5 : 2} />
                <span style={{ flex: 1, fontSize: 12, fontWeight: active ? 600 : 400, letterSpacing: "0.01em" }}>{label}</span>
                {badge && (
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 10, minWidth: 18, textAlign: "center",
                    background: badgeColor === "red" ? "var(--red-dim)" : badgeColor === "amber" ? "var(--amber-dim)" : "var(--surface-overlay)",
                    color: badgeColor === "red" ? "var(--red)" : badgeColor === "amber" ? "var(--amber)" : "var(--text-muted)",
                  }}>{badge}</span>
                )}
                {active && <ChevronRight size={10} style={{ opacity: 0.6 }} />}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--surface-overlay)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600, color: "var(--text-secondary)" }}>SG</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: "var(--text-primary)", fontWeight: 500 }}>Sudu Gupta</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Mirchi Labs</div>
        </div>
        <Settings size={12} color="var(--text-muted)" style={{ cursor: "pointer" }} />
      </div>
    </aside>
  );
}
