import { Routes, Route, Navigate } from "react-router-dom";
import { IntakePage } from "./pages/IntakePage";
import { ReadinessPage } from "./pages/ReadinessPage";
import { MappingPage } from "./pages/MappingPage";
import { ValidationPage } from "./pages/ValidationPage";
import { DeliveryPage } from "./pages/DeliveryPage";
import { FeedbackPage } from "./pages/FeedbackPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/intake" replace />} />
      <Route path="/intake" element={<IntakePage />} />
      <Route path="/readiness" element={<ReadinessPage />} />
      <Route path="/mapping" element={<MappingPage />} />
      <Route path="/validation" element={<ValidationPage />} />
      <Route path="/delivery" element={<DeliveryPage />} />
      <Route path="/feedback" element={<FeedbackPage />} />
    </Routes>
  );
}
