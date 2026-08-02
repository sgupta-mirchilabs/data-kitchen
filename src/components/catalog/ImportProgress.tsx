import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2 } from "lucide-react";

type Stage = "uploading" | "parsing" | "persisting" | "complete";

const STAGES: { key: Stage; label: string }[] = [
  { key: "uploading", label: "Uploading file" },
  { key: "parsing", label: "Parsing and normalizing" },
  { key: "persisting", label: "Persisting products" },
  { key: "complete", label: "Import complete" },
];

interface Props {
  isComplete: boolean;
}

export function ImportProgress({ isComplete }: Props) {
  const [stage, setStage] = useState<Stage>("uploading");

  useEffect(() => {
    if (isComplete) {
      setStage("complete");
      return;
    }

    const timers = [
      setTimeout(() => setStage("parsing"), 600),
      setTimeout(() => setStage("persisting"), 1400),
    ];
    return () => timers.forEach(clearTimeout);
  }, [isComplete]);

  return (
    <div style={{
      padding: "40px 24px", display: "flex", flexDirection: "column",
      alignItems: "center", gap: 32,
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 340 }}>
        {STAGES.map(({ key, label }) => {
          const stageIndex = STAGES.findIndex((s) => s.key === key);
          const currentIndex = STAGES.findIndex((s) => s.key === stage);
          const isDone = stageIndex < currentIndex || stage === "complete";
          const isCurrent = stageIndex === currentIndex && stage !== "complete";

          return (
            <motion.div
              key={key}
              initial={{ opacity: 0.4 }}
              animate={{ opacity: isDone || isCurrent ? 1 : 0.4 }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px", borderRadius: 6,
                background: isCurrent ? "var(--mirchi-dim)" : isDone ? "var(--green-dim)" : "var(--surface)",
                border: `1px solid ${isCurrent ? "var(--mirchi-glow)" : isDone ? "rgba(34,197,94,0.15)" : "var(--border-subtle)"}`,
              }}
            >
              {isDone && <CheckCircle2 size={14} color="var(--green)" />}
              {isCurrent && (
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                  <Loader2 size={14} color="var(--mirchi)" />
                </motion.div>
              )}
              {!isDone && !isCurrent && (
                <div style={{ width: 14, height: 14, borderRadius: "50%", border: "1.5px solid var(--border)", background: "transparent" }} />
              )}
              <span style={{
                fontSize: 12, fontWeight: isCurrent ? 600 : 400,
                color: isDone ? "var(--green)" : isCurrent ? "var(--mirchi)" : "var(--text-muted)",
              }}>
                {label}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
