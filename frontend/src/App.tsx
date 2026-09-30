import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DashboardStreamProvider } from "./api/DashboardStreamContext";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import RiskMapPage from "./pages/RiskMapPage";
import ForecastsPage from "./pages/ForecastsPage";
import ExplainPage from "./pages/ExplainPage";
import WhatIfPage from "./pages/WhatIfPage";
import AlertsPage from "./pages/AlertsPage";
import HealthPage from "./pages/HealthPage";

export default function App() {
  return (
    <DashboardStreamProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="map" element={<RiskMapPage />} />
            <Route path="forecasts" element={<ForecastsPage />} />
            <Route path="explain" element={<ExplainPage />} />
            <Route path="what-if" element={<WhatIfPage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="health" element={<HealthPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </DashboardStreamProvider>
  );
}
