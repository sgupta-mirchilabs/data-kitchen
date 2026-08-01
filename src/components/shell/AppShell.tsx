import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--background)" }}>
      <Sidebar />
      <main style={{ flex: 1, marginLeft: 220, display: "flex", flexDirection: "column", minHeight: "100vh", overflow: "auto" }}>
        {children}
      </main>
    </div>
  );
}
